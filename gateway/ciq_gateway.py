"""
Clubhouse IQ plant gateway.

Reads the central plant points from the club's BAS over BACnet/IP (read only)
and sends them to Clubhouse IQ every minute. If the internet drops, readings
are saved to disk and sent when the connection comes back.

    python ciq_gateway.py run              keep running (what the Windows task does)
    python ciq_gateway.py test             read every point once and print it, send nothing
    python ciq_gateway.py test --send      same, then send that one reading to the app
    python ciq_gateway.py discover         list every BACnet device that answers
    python ciq_gateway.py discover 120     list the points in device 120 (names, values)
    python ciq_gateway.py discover 120 --find chw,cond,walk   only points whose name matches

Settings live in config.json next to this file (see config.example.json).
This program never writes to the BAS. It only sends Who-Is and ReadProperty.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import logging.handlers
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from bacpypes3 import settings as bacnet_settings
from bacpypes3.app import Application
from bacpypes3.pdu import Address

# Lets a device address name its router, like 2001:12@192.168.1.43, so MS/TP
# devices behind the BCM can be read without broadcasts (needed when Compass
# runs on the same PC and owns port 47808).
bacnet_settings.route_aware = True

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
OUTBOX = HERE / "outbox.jsonl"
LOG = HERE / "gateway.log"
VERSION = "1.0"

log = logging.getLogger("ciq")


# ---------------------------------------------------------------- settings

def load_config() -> dict:
    if not CONFIG.exists():
        sys.exit(f"Missing {CONFIG}. Copy config.example.json to config.json and fill it in, or run install.cmd.")
    with open(CONFIG, encoding="utf-8-sig") as f:  # tolerates the BOM Notepad and PowerShell add
        cfg = json.load(f)
    cfg.setdefault("interval_seconds", 60)
    cfg.setdefault("timeout_seconds", 6)
    cfg.setdefault("devices", {})
    cfg.setdefault("fault_codes", {})
    b = cfg.setdefault("bacnet", {})
    b.setdefault("instance", 3999001)
    b.setdefault("address", "")
    b.setdefault("foreign_bbmd", "")
    b.setdefault("ttl", 300)
    cfg["key"] = os.environ.get("PLANT_INGEST_KEY") or cfg.get("key", "")
    cfg["server"] = cfg.get("server", "https://clubhouse-iq.onrender.com").rstrip("/")
    return cfg


def setup_logging(console: bool = True) -> None:
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    fh = logging.handlers.RotatingFileHandler(LOG, maxBytes=1_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    if console and sys.stdout:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        log.addHandler(sh)


# ---------------------------------------------------------------- BACnet

def make_app(cfg: dict) -> Application:
    b = cfg["bacnet"]
    ns = argparse.Namespace(
        vendoridentifier=999,
        instance=int(b["instance"]),
        name="ClubhouseIQ-Gateway",
        address=b["address"] or None,          # e.g. 192.168.1.50/24 (this PC on the BAS network)
        foreign=b["foreign_bbmd"] or None,     # only if the BAS is on another subnet behind a BBMD
        ttl=int(b["ttl"]),
        network=0,
        bbmd=None,
    )
    return Application.from_args(ns)


class Bas:
    """Finds devices by instance number and reads their points."""

    def __init__(self, app: Application, cfg: dict):
        self.app = app
        self.cfg = cfg
        self.addr: dict[int, Address] = {}
        for inst, d in cfg["devices"].items():
            if isinstance(d, dict) and d.get("address"):
                self.addr[int(inst)] = Address(d["address"])

    async def locate(self, inst: int) -> Address | None:
        if inst in self.addr:
            return self.addr[inst]
        for _ in range(3):
            found = await self.app.who_is(inst, inst, timeout=3)
            if found:
                self.addr[inst] = found[0].pduSource
                log.info("Found device %s at %s", inst, self.addr[inst])
                return self.addr[inst]
        log.warning("Device %s did not answer Who-Is", inst)
        return None

    def forget(self, inst: int) -> None:
        dev = self.cfg["devices"].get(str(inst))
        if not (isinstance(dev, dict) and dev.get("address")):
            self.addr.pop(inst, None)

    async def read(self, inst: int, obj: str, prop: str = "present-value"):
        a = await self.locate(inst)
        if a is None:
            raise LookupError(f"device {inst} not found")
        v = await asyncio.wait_for(self.app.read_property(a, obj, prop), self.cfg["timeout_seconds"])
        if isinstance(v, Exception) or type(v).__name__ in ("ErrorRejectAbortNack", "Error", "RejectPDU", "AbortPDU"):
            raise RuntimeError(str(v))
        return v


def to_number(v):
    """BACnet value -> float or 0/1. Enumerations like active/inactive become 1/0."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower()
    if s in ("active", "on", "true", "running", "run"):
        return 1.0
    if s in ("inactive", "off", "false", "stopped", "stop"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


async def read_points(bas: Bas, cfg: dict) -> tuple[list[dict], list[str]]:
    """Read every configured point. Returns (readings, problems)."""
    ts = datetime.now(timezone.utc).isoformat()
    out, problems = [], []
    bad_devices: set[int] = set()
    for p in cfg["points"]:
        key, dev = p.get("key"), p.get("device")
        objs = p.get("objects") or ([p["object"]] if p.get("object") else [])
        if not key or not dev or not objs:
            continue  # not filled in yet
        if int(dev) in bad_devices:
            problems.append(f"{key}: device {dev} not answering")
            continue
        try:
            if p.get("type") == "fault":
                # York OptiView fault codes: 0 = none. Codes can be named in fault_codes.
                text = ""
                for o, label in zip(objs, p.get("labels") or ["FAULT"] * len(objs)):
                    code = to_number(await bas.read(int(dev), o))
                    if code and code > 0:
                        c = str(int(code))
                        text = cfg["fault_codes"].get(c) or f"{label} FAULT CODE {c}"
                        break
                out.append({"key": key, "value": text, "ts": ts})
                continue
            v = await bas.read(int(dev), objs[0], p.get("property", "present-value"))
            n = to_number(v)
            if n is None:
                problems.append(f"{key}: value '{v}' is not a number")
                continue
            if p.get("type") == "bool":
                n = 1.0 if n else 0.0
            n = n * float(p.get("scale", 1)) + float(p.get("offset", 0))
            out.append({"key": key, "value": round(n, 3), "ts": ts})
        except asyncio.TimeoutError:
            problems.append(f"{key}: no answer from device {dev}")
            bas.forget(int(dev))
            bad_devices.add(int(dev))
        except LookupError as e:
            problems.append(f"{key}: {e}")
            bad_devices.add(int(dev))
        except Exception as e:  # unknown object, property error, etc.
            problems.append(f"{key}: {e}")
    return out, problems


# ---------------------------------------------------------------- sending

def post(cfg: dict, readings: list[dict]) -> tuple[bool, str]:
    body = json.dumps({"readings": readings}).encode()
    req = urllib.request.Request(cfg["server"] + "/api/plant/ingest", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-Plant-Key": cfg["key"],
                                          "User-Agent": "ClubhouseIQ-Gateway/" + VERSION})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read() or b"{}")
            if d.get("skipped"):
                log.warning("Server skipped unknown points: %s", ", ".join(d["skipped"]))
            return True, f"stored {d.get('stored')}"
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:200]
        if e.code == 401:
            return False, "Server refused the plant key. Check PLANT_INGEST_KEY in Render matches config.json."
        if e.code == 400:
            return True, "Server rejected this batch: " + msg  # bad data; don't keep retrying it
        return False, f"HTTP {e.code} {msg}"
    except Exception as e:
        return False, str(e)


def save_outbox(readings: list[dict]) -> None:
    with open(OUTBOX, "a", encoding="utf-8") as f:
        f.write(json.dumps(readings) + "\n")
    # keep about a week at one batch a minute
    try:
        lines = OUTBOX.read_text(encoding="utf-8").splitlines()
        if len(lines) > 10080:
            OUTBOX.write_text("\n".join(lines[-10080:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def flush_outbox(cfg: dict) -> None:
    if not OUTBOX.exists():
        return
    lines = [l for l in OUTBOX.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not lines:
        return
    log.info("Sending %d saved batches from while the connection was down", len(lines))
    sent = 0
    for line in lines:
        try:
            batch = json.loads(line)
        except ValueError:
            sent += 1
            continue
        ok, msg = True, ""
        for i in range(0, len(batch), 500):
            ok, msg = post(cfg, batch[i:i + 500])
            if not ok:
                break
        if not ok:
            log.warning("Still can't send saved readings: %s", msg)
            break
        sent += 1
    rest = lines[sent:]
    OUTBOX.write_text(("\n".join(rest) + "\n") if rest else "", encoding="utf-8")


# ---------------------------------------------------------------- commands

async def cmd_run(cfg: dict) -> None:
    if not cfg["key"]:
        sys.exit("No plant key. Put it in config.json as \"key\".")
    app = make_app(cfg)
    bas = Bas(app, cfg)
    log.info("Clubhouse IQ gateway %s started. Sending to %s every %ss", VERSION, cfg["server"], cfg["interval_seconds"])
    last_problems = None
    while True:
        started = time.monotonic()
        try:
            readings, problems = await read_points(bas, cfg)
            if problems != last_problems:
                for p in problems:
                    log.warning(p)
                last_problems = problems
            if readings:
                ok, msg = post(cfg, readings)
                if ok:
                    flush_outbox(cfg)
                else:
                    log.warning("Send failed, saved for later: %s", msg)
                    save_outbox(readings)
            else:
                log.warning("No points could be read this round")
        except Exception:
            log.exception("Round failed")
        await asyncio.sleep(max(5, cfg["interval_seconds"] - (time.monotonic() - started)))


async def cmd_test(cfg: dict, send: bool) -> None:
    app = make_app(cfg)
    bas = Bas(app, cfg)
    readings, problems = await read_points(bas, cfg)
    keys = {p["key"]: p for p in cfg["points"]}
    print(f"\n{len(readings)} points read:")
    for r in readings:
        p = keys.get(r["key"], {})
        print(f"  {r['key']:<14} {str(r['value']):>10}   device {p.get('device')}  {', '.join(p.get('objects') or [p.get('object', '')])}")
    blank = [p["key"] for p in cfg["points"] if not (p.get("object") or p.get("objects"))]
    if blank:
        print(f"\nNot set up yet (no object in config.json): {', '.join(blank)}")
    if problems:
        print("\nProblems:")
        for p in problems:
            print("  " + p)
    if send:
        if not readings:
            print("\nNothing to send.")
        else:
            ok, msg = post(cfg, readings)
            print("\nSent to Clubhouse IQ: " + msg if ok else "\nSend failed: " + msg)
    app.close()


async def cmd_discover(cfg: dict, device: int | None, find: str) -> None:
    app = make_app(cfg)
    if device is None:
        print("Asking every BACnet device to answer (about 10 seconds)...")
        found = await app.who_is(timeout=10)
        print(f"\n{len(found)} devices answered:")
        for i_am in sorted(found, key=lambda x: x.iAmDeviceIdentifier[1]):
            inst = i_am.iAmDeviceIdentifier[1]
            name = ""
            try:
                name = await asyncio.wait_for(app.read_property(i_am.pduSource, f"device,{inst}", "object-name"), 4)
            except Exception:
                pass
            print(f"  device {inst:<9} at {str(i_am.pduSource):<22} {name}")
        app.close()
        return
    bas = Bas(app, cfg)
    a = await bas.locate(device)
    if a is None:
        print(f"Device {device} did not answer.")
        app.close()
        return
    words = [w.strip().lower() for w in find.split(",") if w.strip()]
    try:
        objs = await asyncio.wait_for(app.read_property(a, f"device,{device}", "object-list"), 20)
    except Exception:
        # large lists may need reading one index at a time
        n = await app.read_property(a, f"device,{device}", "object-list", 0)
        objs = [await app.read_property(a, f"device,{device}", "object-list", i) for i in range(1, int(n) + 1)]
    rows = []
    for oid in objs:
        otype, inst = oid[0], oid[1]
        t = str(otype)
        if t in ("device", "network-port", "program", "trend-log", "schedule", "calendar", "notification-class", "file"):
            continue
        try:
            name = str(await asyncio.wait_for(app.read_property(a, oid, "object-name"), 4))
        except Exception:
            name = ""
        if words and not any(w in name.lower() for w in words):
            continue
        try:
            val = await asyncio.wait_for(app.read_property(a, oid, "present-value"), 4)
        except Exception:
            val = ""
        try:
            units = str(await asyncio.wait_for(app.read_property(a, oid, "units"), 3)) if "analog" in t else ""
        except Exception:
            units = ""
        rows.append((f"{t},{inst}", name, str(val), units))
        print(f"  {t + ',' + str(inst):<22} {name:<36} {str(val):>12} {units}")
    out = HERE / f"device-{device}-points.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["object", "name", "value", "units"])
        w.writerows(rows)
    print(f"\n{len(rows)} points. Saved to {out}")
    print('Put the object (like "analog-value,12") into config.json for each point you want.')
    app.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Clubhouse IQ plant gateway")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("run")
    t = sub.add_parser("test")
    t.add_argument("--send", action="store_true")
    d = sub.add_parser("discover")
    d.add_argument("device", nargs="?", type=int)
    d.add_argument("--find", default="")
    args = ap.parse_args()
    cfg = load_config()
    cmd = args.cmd or "run"
    setup_logging(console=cmd != "run" or bool(sys.stdout and sys.stdout.isatty()))
    if cmd == "run":
        asyncio.run(cmd_run(cfg))
    elif cmd == "test":
        asyncio.run(cmd_test(cfg, args.send))
    else:
        asyncio.run(cmd_discover(cfg, args.device, args.find))


if __name__ == "__main__":
    main()
