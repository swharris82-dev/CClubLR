"""
Clubhouse IQ BAS scanner (read only).

Runs next to the plant gateway on the CCLR-HVAC PC. Finds every BACnet
controller on the club's BAS (air handlers, fan coils, exhaust fans, zones,
walk-in temps, the plant controllers), reads every point it has (name,
present value, units) and posts them to Clubhouse IQ at /api/plant/bas.
The app maps the points to equipment by name, trends them and raises alarms.

This program never writes to the BAS.

Usage (from C:\\ClubhouseIQ\\Gateway with the gateway's venv):
    python ciq_bas_scan.py test         one discovery + one scan, prints a summary
    python ciq_bas_scan.py test --send  same, and posts the results to the app
    python ciq_bas_scan.py discover     only find devices and save them
    python ciq_bas_scan.py run          keep scanning (what the scheduled task runs)

Settings come from the gateway's config.json (server URL, plant key, BACnet
address) and can be overridden in bas_scan.json next to this file.
"""
import asyncio
import json
import re
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
from bacpypes3.primitivedata import ObjectIdentifier  # noqa: E402

try:
    from bacpypes3.settings import settings as _settings
    _settings.route_aware = True  # needed for net:mac@router addresses
except Exception:  # older bacpypes3
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

VERSION = "2026-11-27c"
CACHE = os.path.join(HERE, "bas_scan_cache.json")
LOG = os.path.join(HERE, "bas_scan.log")

DEFAULTS = {
    # Where to post. Normally read from config.json; set here to override.
    "server_url": "",
    "plant_key": "",
    # This program's own BACnet port and device instance. The plant gateway
    # uses 47809 and its tests 47810, so the scanner takes 47811 (47812 for
    # a test while the scheduled task is running).
    "port": 47811,
    "device_instance": 3999911,
    # Plant controllers the gateway already reads point by point. The VLX
    # has 3,112 points with generic names, so only these objects are read.
    "device_objects": {"120": ["AI 2009", "BO 2009"]},
    "skip_devices": [0, 5001, 505002],  # 0 = Compass workstation on this PC
    # IP routers to MS/TP trunks. Found 11/27: only the VLX (.198) routes, to
    # network 102 (chiller 5001, tower drive 505002, read by the gateway).
    "routers": ["192.168.1.198"],
    # MS/TP networks to sweep MAC by MAC. Empty by default: a blind sweep loads
    # the VLX router and starves the gateway's chiller reads.
    "networks": [],
    "max_mac": 127,
    # Also look for IP controllers on the BAS subnet (.1 to .254).
    "ip_sweep": True,
    # Any device you already know: {"201099": "201:99@192.168.1.198"}
    "extra_devices": {},
    "interval_sec": 300,           # values every 5 minutes
    "names_every_hours": 24,       # re-read object names once a day
    "discover_every_hours": 24,
    "device_budget_sec": 75,       # MS/TP is slow; cap time per device per cycle
    "max_objects": 3000,
    "read_timeout": 6.0,
    "concurrency": 6,
    "probe_timeout": 3.0,
    "probe_concurrency": 8,
}

GENERIC = re.compile(r"^(AI|AO|AV|BI|BO|BV|MI|MO|MV|MSI|MSO|MSV)[\s-]*\d+$", re.I)

UNITS = {
    "degreesFahrenheit": "°F", "degreesCelsius": "°C", "percent": "%",
    "percentRelativeHumidity": "%RH", "cubicFeetPerMinute": "cfm",
    "usGallonsPerMinute": "gpm", "inchesOfWater": "in. wc", "hertz": "Hz",
    "amperes": "A", "kilowatts": "kW", "kilowattHours": "kWh", "hours": "hr",
    "minutes": "min", "seconds": "s", "volts": "V", "poundsForcePerSquareInch": "psi",
    "btusPerPoundDryAir": "btu/lb", "partsPerMillion": "ppm", "noUnits": "",
}
SHORT = {
    "analog-input": "AI", "analog-output": "AO", "analog-value": "AV",
    "binary-input": "BI", "binary-output": "BO", "binary-value": "BV",
    "multi-state-input": "MSI", "multi-state-output": "MSO", "multi-state-value": "MSV",
}
LONG = {v: k for k, v in SHORT.items()}
_UNITS_N = {k.lower(): v for k, v in UNITS.items()}


def unit_str(u):
    k = str(u)
    return _UNITS_N.get(k.replace("-", "").replace("_", "").lower(), k)

log = logging.getLogger("bas_scan")


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
    """Search a nested config for the first string value whose key passes test."""
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
        except Exception as e:
            print("Could not read config.json:", e)
    over = {}
    if os.path.exists("bas_scan.json"):
        with open("bas_scan.json", encoding="utf-8") as f:
            over = json.load(f)
    # server and key from the gateway config
    cfg["server_url"] = find_in(gw, lambda k, v: v.startswith("http") and ("url" in k or "server" in k or "app" in k or "api" in k)) or ""
    cfg["plant_key"] = find_in(gw, lambda k, v: "key" in k and len(v) >= 16 and not v.startswith("http")) or ""
    gw_addr = find_in(gw, lambda k, v: k == "address" and "/" in v and v.count(".") == 3) or ""
    # routers the gateway already knows (anything like 102:9@192.168.1.198)
    known_routers = set()

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str) and "@" in o:
            known_routers.add(o.split("@", 1)[1].split(":")[0])
    walk(gw)
    for k, v in over.items():
        cfg[k] = v
    cfg["routers"] = list(dict.fromkeys(list(cfg["routers"]) + sorted(known_routers)))
    if not over.get("bacnet_address"):
        ip = gw_addr.split(":")[0] if gw_addr else ""
        cfg["bacnet_address"] = f"{ip}:{cfg['port']}" if ip else ""
    cfg["server_url"] = (os.environ.get("CIQ_SERVER") or cfg["server_url"]).rstrip("/")
    cfg["plant_key"] = os.environ.get("CIQ_PLANT_KEY") or cfg["plant_key"]
    return cfg


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"devices": {}, "discovered_at": 0}


def save_cache(c):
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=1)
    os.replace(tmp, CACHE)


def short_obj(oid):
    t = str(oid[0])
    return f"{SHORT.get(t, t)} {int(oid[1])}"


def to_value(v):
    if v is None:
        return None
    s = str(v)
    if s in ("active", "inactive"):
        return 1 if s == "active" else 0
    if isinstance(v, bool):
        return 1 if v else 0
    try:
        return round(float(v), 3)
    except Exception:
        return s[:60]


async def guarded(coro, timeout):
    """Await a BACnet request; bacpypes3 raises aborts/rejects as BaseException."""
    try:
        return await asyncio.wait_for(coro, timeout), None
    except (KeyboardInterrupt, SystemExit):
        raise
    except asyncio.CancelledError:
        return None, "cancelled"
    except BaseException as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"[:120]


class Scanner:
    def __init__(self, cfg, port=None):
        self.cfg = cfg
        self.cache = load_cache()
        addr = cfg["bacnet_address"]
        if port:
            addr = addr.rsplit(":", 1)[0] + f":{port}"
        if not addr:
            raise SystemExit("No BACnet address. Set bacnet_address in bas_scan.json, e.g. 192.168.1.108/24:47811")
        args = SimpleArgumentParser().parse_args([
            "--name", "CIQ-BAS-SCAN", "--instance", str(cfg["device_instance"]), "--address", addr])
        self.app = Application.from_args(args)
        self.sem = asyncio.Semaphore(cfg["concurrency"])
        self.psem = asyncio.Semaphore(cfg["probe_concurrency"])
        log.info("BAS scanner %s on %s", VERSION, addr)

    async def rp(self, address, oid, prop, idx=None):
        async with self.sem:
            return await guarded(self.app.read_property(Address(address), oid, prop, idx), self.cfg["read_timeout"])

    async def rpm(self, address, plist):
        async with self.sem:
            return await guarded(self.app.read_property_multiple(Address(address), plist), self.cfg["read_timeout"] + 4)

    # ---------- discovery ----------
    async def probe(self, address, guess=None):
        """Ask whoever is at address for its device number (wildcard device read).
        If the wildcard isn't supported, try the Alerton numbering guess."""
        for inst in ([4194303] + ([guess] if guess else [])):
            async with self.psem:
                v, err = await guarded(self.app.read_property(Address(address), ObjectIdentifier(f"device,{inst}"), "object-identifier"),
                                       self.cfg["probe_timeout"])
            if v is not None:
                try:
                    return int(v[1])
                except Exception:
                    return inst
        return None

    async def discover(self):
        cfg, found = self.cfg, {}
        # 1. Who-Is (works where devices answer the scanner's port directly)
        try:
            i_ams, err = await guarded(self.app.who_is(address=Address("*:*"), timeout=8), 15)
            for ia in i_ams or []:
                found[int(ia.iAmDeviceIdentifier[1])] = str(ia.pduSource)
            log.info("Who-Is: %d replies", len(found))
        except Exception as e:
            log.info("Who-Is failed: %s", e)
        # 2. IP controllers on the BAS subnet
        routers = list(cfg["routers"])
        if cfg.get("ip_sweep") and cfg["bacnet_address"]:
            base = cfg["bacnet_address"].split("/")[0].split(":")[0].rsplit(".", 1)[0]
            ips = [f"{base}.{i}" for i in range(1, 255)]
            res = await asyncio.gather(*[self.probe(ip) for ip in ips])
            for ip, dev in zip(ips, res):
                if dev is not None:
                    found.setdefault(dev, ip)
                    if ip not in routers:
                        routers.append(ip)
            log.info("IP sweep: %d controllers", sum(1 for r in res if r is not None))
        # 3. MS/TP trunks through each router
        for net in cfg["networks"]:
            router = None
            for r in routers:
                # quick check: any of the first few MACs answer through this router?
                macs = (1, 2, 3, 5, 9, 31, 50, 84, 91, 99, 101, 105)
                tries = [f"{net}:{m}@{r}" for m in macs]
                hits = await asyncio.gather(*[self.probe(a, net * 1000 + m) for a, m in zip(tries, macs)])
                if any(h is not None for h in hits):
                    router = r
                    for a, h in zip(tries, hits):
                        if h is not None:
                            found.setdefault(h, a)
                    break
            if not router:
                log.info("Network %s: no router answered", net)
                continue
            addrs = [f"{net}:{m}@{router}" for m in range(0, cfg["max_mac"] + 1)]
            res = await asyncio.gather(*[self.probe(a, net * 1000 + m) for m, a in enumerate(addrs)])
            n = 0
            for a, dev in zip(addrs, res):
                if dev is not None:
                    found.setdefault(dev, a)
                    n += 1
            log.info("Network %s via %s: %d devices", net, router, n)
        for k, v in (cfg.get("extra_devices") or {}).items():
            found[int(k)] = v
        for d in cfg["skip_devices"]:
            found.pop(int(d), None)
        devs = self.cache.setdefault("devices", {})
        for dev, addr in found.items():
            devs.setdefault(str(dev), {})["address"] = addr
        self.cache["discovered_at"] = time.time()
        save_cache(self.cache)
        return found

    # ---------- per device ----------
    async def object_list(self, addr, dev):
        oid = ObjectIdentifier(f"device,{dev}")
        v, err = await self.rp(addr, oid, "object-list")
        if v is not None:
            return list(v)
        n, err = await self.rp(addr, oid, "object-list", 0)
        if n is None:
            raise RuntimeError(f"object-list: {err}")
        # MS/TP controllers (480-byte APDU, no segmentation) can't send the whole
        # list at once; read the entries several at a time instead of one by one.
        idx = list(range(1, min(int(n), self.cfg["max_objects"]) + 1))
        res = await asyncio.gather(*[self.rp(addr, oid, "object-list", i) for i in idx])
        return [o for o, _err in res if o is not None]

    async def read_names(self, dev, info):
        addr = info["address"]
        oid = ObjectIdentifier(f"device,{dev}")
        only = self.cfg["device_objects"].get(str(dev))
        for prop, key in (("object-name", "name"), ("model-name", "model"), ("vendor-name", "vendor")):
            v, _ = await self.rp(addr, oid, prop)
            if v is not None:
                info[key] = str(v)
        if only:
            objs = [ObjectIdentifier(f"{LONG[o.split()[0]]},{o.split()[1]}") for o in only]
        else:
            objs = [o for o in await self.object_list(addr, dev) if str(o[0]) in SHORT][: self.cfg["max_objects"]]
        pts = {}

        def props(o):
            return ["object-name", "description", "units"] if str(o[0]).startswith("analog") else ["object-name", "description"]

        def take(res):
            for o, prop, _, val in res:
                p = pts.setdefault(short_obj(o), {"name": "", "units": ""})
                if str(prop) == "object-name" and val is not None:
                    p["name"] = str(val)
                elif str(prop) == "description" and val is not None:
                    p["desc"] = str(val).strip()
                elif str(prop) == "units" and val is not None:
                    p["units"] = unit_str(val)

        async def one(o):
            res, _ = await self.rpm(addr, [o, props(o)])
            if res is not None:
                take(res)
                return
            p = pts.setdefault(short_obj(o), {"name": "", "units": ""})
            v, _ = await self.rp(addr, o, "object-name")
            if v is not None:
                p["name"] = str(v)
            d, _ = await self.rp(addr, o, "description")
            if d is not None:
                p["desc"] = str(d).strip()
            if str(o[0]).startswith("analog"):
                u, _ = await self.rp(addr, o, "units")
                if u is not None:
                    p["units"] = unit_str(u)

        async def chunk(c):
            # small RPM chunks fit an MS/TP reply; on failure fall back per object
            plist = []
            for o in c:
                plist += [o, props(o)]
            res, _ = await self.rpm(addr, plist)
            if res is not None:
                take(res)
            else:
                await asyncio.gather(*[one(o) for o in c])

        await asyncio.gather(*[chunk(objs[i:i + 4]) for i in range(0, len(objs), 4)])
        # Alerton VLC object names are generic ("AI 00"); Compass puts the real
        # label in the description ("Supply Air Temperature"). Use it when set.
        for p in pts.values():
            d = p.pop("desc", "")
            if d and not GENERIC.match(d):
                p["name"] = d
        info["points"] = pts
        info["names_at"] = time.time()

    async def read_values(self, dev, info):
        addr, pts = info["address"], info.get("points") or {}
        objs = list(pts.keys())
        out = {}
        t0 = time.time()
        use_rpm = info.get("rpm", True)
        step = 20 if info.get("ip") else 10
        for i in range(0, len(objs), step):
            if time.time() - t0 > self.cfg["device_budget_sec"]:
                log.info("Device %s: time budget hit after %d of %d points", dev, len(out), len(objs))
                break
            chunk = objs[i:i + step]
            ids = [ObjectIdentifier(f"{LONG[o.split()[0]]},{o.split()[1]}") for o in chunk]
            res = None
            if use_rpm:
                plist = []
                for o in ids:
                    plist += [o, ["present-value"]]
                res, err = await self.rpm(addr, plist)
            if res is not None:
                for o, prop, _, val in res:
                    out[short_obj(o)] = to_value(val)
            else:
                vals = await asyncio.gather(*[self.rp(addr, o, "present-value") for o in ids])
                for o, (v, err) in zip(chunk, vals):
                    if v is not None:
                        out[o] = to_value(v)
        return out

    async def scan(self, names_due):
        devs = self.cache.get("devices", {})
        report = []
        for dev_s, info in sorted(devs.items(), key=lambda kv: int(kv[0])):
            dev = int(dev_s)
            if dev in self.cfg["skip_devices"] or not info.get("address"):
                continue
            try:
                if names_due or not info.get("points"):
                    await self.read_names(dev, info)
                vals = await self.read_values(dev, info)
                info["ok"], info["err"] = True, ""
                report.append({
                    "dev": dev, "name": info.get("name", ""), "model": info.get("model", ""),
                    "vendor": info.get("vendor", ""), "address": info["address"],
                    "points": [[o, p["name"], vals.get(o), p["units"]] for o, p in info["points"].items() if o in vals],
                })
            except Exception as e:  # noqa: BLE001
                info["ok"], info["err"] = False, str(e)[:120]
                log.info("Device %s at %s: %s", dev, info.get("address"), e)
        save_cache(self.cache)
        return report


def post(cfg, report):
    if not cfg["server_url"] or not cfg["plant_key"]:
        log.info("No server URL or plant key; not sending")
        return False
    ok = True
    for i in range(0, len(report), 20):
        body = json.dumps({"devices": report[i:i + 20], "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode()
        req = urllib.request.Request(cfg["server_url"] + "/api/plant/bas", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "X-Plant-Key": cfg["plant_key"]})
        try:
            with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context()) as r:
                log.info("Sent %d devices: %s", len(report[i:i + 20]), r.read()[:200].decode(errors="replace"))
        except Exception as e:  # noqa: BLE001
            ok = False
            log.info("Send failed: %s", e)
    return ok


def summary(report, cache):
    lines = [f"Clubhouse IQ BAS scanner {VERSION}", time.strftime("%Y-%m-%d %H:%M:%S"), ""]
    devs = cache.get("devices", {})
    lines.append(f"Devices found: {len(devs)}   read this pass: {len(report)}   points: {sum(len(r['points']) for r in report)}")
    lines.append("")
    for r in report:
        named = [p for p in r["points"] if p[2] is not None][:6]
        lines.append(f"{r['dev']:>7}  {r['name'][:28]:<28} {len(r['points']):>4} pts  {r['address']}")
        for p in named:
            lines.append(f"           {p[0]:<8} {p[1][:34]:<34} {p[2]} {p[3]}")
    bad = [(k, v) for k, v in devs.items() if v.get("ok") is False]
    if bad:
        lines.append("")
        lines.append("Could not read:")
        for k, v in bad:
            lines.append(f"  {k} at {v.get('address')}: {v.get('err')}")
    return "\n".join(lines)


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "test"
    send = "--send" in sys.argv
    setup_log(verbose=(mode != "run"))
    cfg = load_settings()
    log.info("Server %s, key %s, routers %s, networks %s", cfg["server_url"] or "(none)",
             "set" if cfg["plant_key"] else "MISSING", cfg["routers"], cfg["networks"])
    port = None
    if mode != "run" and "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    sc = Scanner(cfg, port=port)
    await asyncio.sleep(1)
    if mode in ("discover", "test") or not sc.cache.get("devices") or \
            time.time() - sc.cache.get("discovered_at", 0) > cfg["discover_every_hours"] * 3600:
        found = await sc.discover()
        log.info("Found %d devices", len(found))
        if mode == "discover":
            for d, a in sorted(found.items()):
                print(f"{d:>8}  {a}")
            return
    if mode == "test":
        rep = await sc.scan(names_due=True)
        text = summary(rep, sc.cache)
        print(text)
        os.makedirs(os.path.join(HERE, "..", "update", "results"), exist_ok=True)
        try:
            with open(os.path.join(HERE, "..", "update", "results", "bas_scan_test.txt"), "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            pass
        if send:
            print("Sent to Clubhouse IQ" if post(cfg, rep) else "Could not send (see bas_scan.log)")
        return
    # run forever
    last_names = 0
    while True:
        t0 = time.time()
        try:
            if t0 - sc.cache.get("discovered_at", 0) > cfg["discover_every_hours"] * 3600:
                await sc.discover()
            due = t0 - last_names > cfg["names_every_hours"] * 3600
            rep = await sc.scan(names_due=due)
            if due:
                last_names = t0
            post(cfg, rep)
        except Exception as e:  # noqa: BLE001
            log.exception("Scan cycle failed: %s", e)
        await asyncio.sleep(max(15, cfg["interval_sec"] - (time.time() - t0)))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
