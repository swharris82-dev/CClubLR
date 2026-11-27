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


Clubhouse IQ BAS control (setpoints and overrides)
==================================================

What it does
- Lets an admin, manager or tech change plant setpoints and override
  pumps, fans and valves from Plant > Controls in the app.
- Runs on the HVAC PC as its own task, "Clubhouse IQ BAS Control", on
  BACnet port 47813. The plant gateway and the BAS scanner are not touched.
- Every 10 seconds it asks the app for requested changes, writes them,
  reads the point back and reports. Once a minute it reads every control
  point so the app shows what the BAS really holds.

How writes work
- Pumps, fans, valves and the tower fan speed (BO/AO): written at
  priority 8, the same level as a manual override in Compass. "Auto" in
  the app releases priority 8 and the BAS program takes back control.
- Setpoints (AV): the new value is written to the point, like changing it
  in Compass. There is no Auto for a setpoint; change it back to undo.

Safety switches
1. In the app: remote control is OFF until an admin or manager turns it
   on at the top of Plant > Controls. Turning it off cancels anything waiting.
2. On this PC: "allow_writes": false in C:\ClubhouseIQ\Gateway\bas_control.json
   stops every write. Restart the task after changing it.
3. Only devices in "allow_devices" (plant controller 120) can be written,
   and values outside the app's limits are refused here too.
4. A request not picked up within 10 minutes expires and is never written.
Every request is logged in the app with who, when, why, the old value
and what the BAS read back.

Setpoints that still need their BAS object
- Chilled water setpoint, tower approach, minimum condenser water, PHX-1
  enable wet bulb, hot water setpoint, hot water pump and boiler enable
  are not on the Compass graphic map yet. Find each one in Compass (the
  object, like AV 23) and enter it with "Set BAS point" on the Controls
  screen. Until then those controls are shown but can't be changed.

Install (on the CCLR-HVAC PC)
1. Copy install_bas_control.bat, ciq_bas_control.py and bas_control.json
   into C:\ClubhouseIQ\update
2. Double-click install_bas_control.bat and click Yes.
3. Results: C:\ClubhouseIQ\update\results\bas_control_test.txt
   Log:     C:\ClubhouseIQ\Gateway\bas_control.log
