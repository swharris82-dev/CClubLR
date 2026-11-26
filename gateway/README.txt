Clubhouse IQ BAS scanner
========================

What it does
- Finds every controller on the club's BAS: air handlers, fan coils, exhaust
  fans, zone boxes, the walk-in temperature points, and the plant controller.
- Reads every point on each one (name, live value, units) every 5 minutes and
  sends them to Clubhouse IQ. The app maps them to equipment, trends them and
  raises alarms (fan failures, failed sensors, coils not cooling, warm boxes).
- Read only. It never writes to the BAS.
- Runs beside the plant gateway on its own port (47811). The plant gateway is
  not changed.

Install (on the CCLR-HVAC PC)
1. Copy install_bas_scan.bat, ciq_bas_scan.py and bas_scan.json into
   C:\ClubhouseIQ\update
2. Double-click install_bas_scan.bat and click Yes.
3. Leave the window open for the first scan (10 to 20 minutes). It shows
   what it found and sends it to the app.
4. In the app: Plant > All BAS lists every device. Fan coils, Exhaust fans,
   Walk-ins and Zones fill in with live values.

Results and log
- C:\ClubhouseIQ\update\results\bas_scan_test.txt   first scan summary
- C:\ClubhouseIQ\Gateway\bas_scan.log              background log
- C:\ClubhouseIQ\Gateway\bas_scan_cache.json       devices found and point names

If a trunk isn't found
- The scanner reaches the MS/TP trunks (networks 101, 102 and 201) through
  the VLX at 192.168.1.198 and any other BACnet router it finds on the
  subnet. If the New Wing devices (2010xx) don't show up, find the router for
  network 201 in Compass and add its IP to "routers" in
  C:\ClubhouseIQ\Gateway\bas_scan.json, then run the installer again.
- A single device can be added by hand in "extra_devices", for example
  {"201099": "201:99@192.168.1.198"}.
