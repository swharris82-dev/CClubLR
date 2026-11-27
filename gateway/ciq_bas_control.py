"""
Clubhouse IQ BAS control program (writes setpoints and overrides).

Runs on the CCLR-HVAC PC beside the plant gateway and the BAS scanner, on its
own BACnet port (47813). Every 10 seconds it asks Clubhouse IQ for changes
that a signed-in admin, manager or tech requested on the Plant > Controls
screen, writes them to the BAS, reads the point back, and reports the result.
Once a minute it reads the current value of every control point so the app
shows what the BAS really holds.

Safety
- "allow_writes": false in bas_control.json stops all writes at once. The
  program still reads and reports values.
- Only devices in "allow_devices" (default: plant controller 120) can be written.
- Numbers outside the app's limits are refused here too.
- Outputs (AO/BO) are written at priority 8 (manual operator). "Auto"
  relinquishes priority 8 so the BAS program takes back control. Setpoint
  AVs are written to present value, the same way Compass changes them.

Usage (from C:\\ClubhouseIQ\\Gateway with the gateway's venv):
    python ciq_bas_control.py test          read every control point once, print, write nothing
    python ciq_bas_control.py run           keep running (what the scheduled task runs)
"""
import asyncio
import json
import logging
import logging.handlers
import os
import ssl
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

from bacpypes3.argparse import SimpleArgumentParser  # noqa: E402
from bacpypes3.app import Application  # noqa: E402
from bacpypes3.pdu import Address  # noqa: E402
from bacpypes3.primitivedata import ObjectIdentifier, Null  # noqa: E402

try:
    from bacpypes3.settings import settings as _settings
    _settings.route_aware = True
except Exception:
    pass

# Windows: when a request goes to a host that isn't running BACnet, it answers
# "port unreachable" and Windows then reports WSAECONNRESET on the UDP socket.
# After that, replies stop arriving (the 11/27 sweep found 0 devices this way).
# Turn that reporting off right after bacpypes3 opens its socket.
if os.name == "nt":
    try:
        from bacpypes3.ipv4 import IPv4DatagramServer as _IDS

        _orig_set_local = _IDS.set_local_transport_protocol

        def _set_local_no_connreset(self, address, task):
            _orig_set_local(self, address, task)
            try:
                import ctypes
                from ctypes import wintypes
                sk = self.local_transport.get_extra_info("socket")
                ws2 = ctypes.WinDLL("ws2_32")
                ws2.WSAIoctl.argtypes = [ctypes.c_size_t, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                         ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                                         ctypes.c_void_p, ctypes.c_void_p]
                flag, ret = wintypes.BOOL(False), wintypes.DWORD(0)
                ws2.WSAIoctl(sk.fileno(), 0x9800000C, ctypes.byref(flag), ctypes.sizeof(flag), None, 0,
                             ctypes.byref(ret), None, None)  # SIO_UDP_CONNRESET off
            except Exception:  # noqa: BLE001
                pass

        _IDS.set_local_transport_protocol = _set_local_no_connreset
    except Exception:  # noqa: BLE001
        pass

VERSION = "ctl-2026-11-27"
LOG = os.path.join(HERE, "bas_control.log")
DEFAULTS = {
    "server_url": "",
    "plant_key": "",
    "port": 47813,
    "device_instance": 3999913,
    "allow_writes": True,
    "allow_devices": [120],
    "addresses": {"120": "192.168.1.198"},
    "poll_sec": 10,
    "read_every_sec": 60,
    "read_timeout": 6.0,
    "priority": 8,
}
LONG = {"AI": "analog-input", "AO": "analog-output", "AV": "analog-value", "BI": "binary-input",
        "BO": "binary-output", "BV": "binary-value", "MSV": "multi-state-value", "MSO": "multi-state-output"}

log = logging.getLogger("bas_control")


def setup_log(verbose):
    log.setLevel(logging.INFO)
    h = logging.handlers.RotatingFileHandler(LOG, maxBytes=2_000_000, backupCount=2, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(h)
    if verbose:
        s = logging.StreamHandler(sys.stdout)
        s.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(s)


def find_in(obj, test):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and test(k.lower(), v):
                return v
        for v in obj.values():
            r = find_in(v, test)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_in(v, test)
            if r:
                return r
    return None


def load_settings():
    cfg = dict(DEFAULTS)
    gw = {}
    if os.path.exists("config.json"):
        try:
            with open("config.json", encoding="utf-8") as f:
                gw = json.load(f)
        except Exception as e:  # noqa: BLE001
            print("Could not read config.json:", e)
    over = {}
    if os.path.exists("bas_control.json"):
        with open("bas_control.json", encoding="utf-8") as f:
            over = json.load(f)
    cfg["server_url"] = find_in(gw, lambda k, v: v.startswith("http") and ("url" in k or "server" in k or "app" in k or "api" in k)) or ""
    cfg["plant_key"] = find_in(gw, lambda k, v: "key" in k and len(v) >= 16 and not v.startswith("http")) or ""
    gw_addr = find_in(gw, lambda k, v: k == "address" and "/" in v and v.count(".") == 3) or ""
    for k, v in over.items():
        if not k.startswith("_"):
            cfg[k] = v
    if not over.get("bacnet_address"):
        ip = gw_addr.split(":")[0] if gw_addr else ""
        cfg["bacnet_address"] = f"{ip}:{cfg['port']}" if ip else ""
    # device addresses the BAS scanner already found
    try:
        with open("bas_scan_cache.json", encoding="utf-8") as f:
            for d, info in json.load(f).get("devices", {}).items():
                if info.get("address") and d not in cfg["addresses"]:
                    cfg["addresses"][d] = info["address"]
    except Exception:
        pass
    cfg["server_url"] = (os.environ.get("CIQ_SERVER") or cfg["server_url"]).rstrip("/")
    cfg["plant_key"] = os.environ.get("CIQ_PLANT_KEY") or cfg["plant_key"]
    return cfg


def oid_of(obj):
    t, n = obj.split()
    return ObjectIdentifier(f"{LONG[t]},{int(n)}")


def num(v):
    s = str(v)
    if s in ("active", "inactive"):
        return 1.0 if s == "active" else 0.0
    try:
        return float(v)
    except Exception:
        return None


async def guarded(coro, timeout):
    try:
        return await asyncio.wait_for(coro, timeout), None
    except (KeyboardInterrupt, SystemExit):
        raise
    except asyncio.CancelledError:
        return None, "cancelled"
    except BaseException as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"[:160]


class Controller:
    def __init__(self, cfg):
        self.cfg = cfg
        if not cfg["bacnet_address"]:
            raise SystemExit("No BACnet address. Set bacnet_address in bas_control.json, e.g. 192.168.1.108/24:47813")
        args = SimpleArgumentParser().parse_args([
            "--name", "CIQ-BAS-CONTROL", "--instance", str(cfg["device_instance"]), "--address", cfg["bacnet_address"]])
        self.app = Application.from_args(args)
        log.info("BAS control %s on %s, writes %s, devices %s", VERSION, cfg["bacnet_address"],
                 "ALLOWED" if cfg["allow_writes"] else "OFF", cfg["allow_devices"])

    def addr(self, dev):
        a = self.cfg["addresses"].get(str(dev))
        if not a:
            raise ValueError(f"No address for device {dev}. Add it to addresses in bas_control.json")
        return Address(a)

    async def read(self, dev, obj):
        a = self.addr(dev)
        v, err = await guarded(self.app.read_property(a, oid_of(obj), "present-value"), self.cfg["read_timeout"])
        if err:
            return None, None, err
        return num(v), str(v)[:40], None

    async def write(self, c, limits):
        dev, obj = int(c["device"]), c["object"]
        if not self.cfg["allow_writes"]:
            return False, "Writes are turned off on the HVAC PC (allow_writes in bas_control.json).", None
        if dev not in [int(x) for x in self.cfg["allow_devices"]]:
            return False, f"Device {dev} is not in allow_devices on the HVAC PC.", None
        kind = obj.split()[0]
        pri = c.get("priority")
        if c["action"] == "release":
            if pri is None:
                return False, "Nothing to release on a setpoint.", None
            value = Null(())
            what = f"released priority {pri}"
        else:
            lim = limits.get(c["key"])
            v = float(c["value"])
            if lim and not (lim[0] <= v <= lim[1]):
                return False, f"{v} is outside {lim[0]} to {lim[1]}. Refused on the HVAC PC.", None
            if kind in ("BO", "BV"):
                value = "active" if v >= 0.5 else "inactive"
            else:
                value = v
            what = f"wrote {value}" + (f" at priority {pri}" if pri else "")
        resp, err = await guarded(self.app.write_property(self.addr(dev), oid_of(obj), "present-value", value, None, pri),
                                  self.cfg["read_timeout"] + 4)
        if err or resp is not None:  # bacpypes3 returns error/reject/abort PDUs instead of raising
            return False, f"BAS refused the write: {err or resp}"[:200], None
        await asyncio.sleep(3)
        rb, txt, e2 = await self.read(dev, obj)
        log.info("Command %s %s %s: %s, read back %s", c["id"], dev, obj, what, txt)
        if c["action"] == "write" and rb is not None and abs(rb - float(c["value"])) > 0.6 and kind not in ("BO", "BV"):
            return True, f"Written ({what}) but the BAS reads back {txt}. A higher priority may be holding it.", rb
        if c["action"] == "write" and kind in ("BO", "BV") and rb is not None and int(rb) != int(float(c["value"]) >= 0.5):
            return True, f"Written ({what}) but the BAS reads back {txt}. A higher priority may be holding it.", rb
        return True, f"{what[0].upper() + what[1:]}. BAS now reads {txt}.", rb


def call(cfg, body):
    req = urllib.request.Request(cfg["server_url"] + "/api/plant/gateway/commands", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Plant-Key": cfg["plant_key"]})
    with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as r:
        return json.loads(r.read().decode())


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "test"
    setup_log(verbose=(mode != "run"))
    cfg = load_settings()
    if mode != "run" and "--port" in sys.argv:
        cfg["bacnet_address"] = cfg["bacnet_address"].rsplit(":", 1)[0] + ":" + sys.argv[sys.argv.index("--port") + 1]
    if not cfg["server_url"] or not cfg["plant_key"]:
        raise SystemExit("No server URL or plant key in config.json")
    ctl = Controller(cfg)
    await asyncio.sleep(1)
    results, values, last_read = [], {}, 0
    while True:
        try:
            body = {"allow_writes": bool(cfg["allow_writes"]), "version": VERSION, "results": results}
            if values:
                body["values"] = values
            resp = await asyncio.to_thread(call, cfg, body)
            results, values = [], {}
            limits = resp.get("limits", {})
            if mode == "test":
                print(f"Server answered. Remote control in the app is {'ON' if resp.get('enabled') else 'OFF'}.")
                print(f"Writes on this PC are {'ALLOWED' if cfg['allow_writes'] else 'OFF'}.\n")
                for w in resp.get("watch", []):
                    v, txt, err = await ctl.read(w["device"], w["object"])
                    print(f"  {w['key']:<16} {w['device']} {w['object']:<9} {txt if err is None else 'no answer: ' + err}")
                    if err is None:
                        values[w["key"]] = {"value": v, "text": txt}
                if values:
                    await asyncio.to_thread(call, cfg, {"allow_writes": bool(cfg["allow_writes"]), "version": VERSION, "values": values})
                print("\nTest only: nothing was written.")
                return
            for c in resp.get("commands", []):
                try:
                    ok, msg, rb = await ctl.write(c, limits)
                except Exception as e:  # noqa: BLE001
                    ok, msg, rb = False, f"Error on the HVAC PC: {e}"[:200], None
                results.append({"id": c["id"], "ok": ok, "message": msg, "readback": rb})
                if ok:
                    values[c["key"]] = {"value": rb, "text": None}
            if results:
                continue  # report right away
            if time.time() - last_read > cfg["read_every_sec"]:
                last_read = time.time()
                for w in resp.get("watch", []):
                    try:
                        v, txt, err = await ctl.read(w["device"], w["object"])
                    except Exception as e:  # noqa: BLE001
                        v, txt, err = None, None, str(e)
                    if err is None:
                        values[w["key"]] = {"value": v, "text": txt}
        except Exception as e:  # noqa: BLE001
            log.info("Cycle failed: %s", e)
            if mode == "test":
                print("Could not reach the app:", e)
                return
        await asyncio.sleep(cfg["poll_sec"])


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
