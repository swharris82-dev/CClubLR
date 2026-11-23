# Clubhouse IQ plant gateway (Windows)

Reads the central plant from the club's BAS over BACnet/IP and sends it to the
Plant page in Clubhouse IQ every minute.

- **Read only.** It sends Who-Is and ReadProperty requests, never writes. Nothing it does can change a setpoint or start or stop equipment.
- **Survives internet drops.** Readings are saved on the PC (up to about a week) and sent when the connection is back.
- **Runs by itself.** Starts at boot, even when nobody is signed in, and restarts itself if it stops.

## Install

1. In **Render > clubhouse-iq > Environment**, add `PLANT_INGEST_KEY` with any random text of 24 characters or more. Save (Render redeploys).
2. Copy this folder to the mini PC and double-click **install.cmd**. Approve the administrator prompt.
3. Paste the same key when asked, then pick the network connection that's on the BAS network (same network as the BCM, 192.168.1.43).
4. The installer reads the plant once and sends it. Open the **Plant** page in the app: it should say **Live from the BAS**.

It installs to `C:\ClubhouseIQ\Gateway`. Run install.cmd again any time to update; your settings are kept.

## Fill in the plant controller points (device 120)

The chiller (5001) and tower drive (505002) points are already set from the trend log plan. The plant controller points need their object numbers once:

1. Open the desktop shortcut **Clubhouse IQ Gateway** and choose **4 Find points in a device**.
2. Enter `120`, then words to match, like `chw,cond,oa,walk,phx,pump,tower`.
3. It lists each point's object (like `analog-value,12`), name and current value, and saves the list to `device-120-points.csv`.
4. Choose **6 Edit settings** and paste each object into the matching `"object": ""` in `config.json`:

| key | what to look for |
| --- | --- |
| tower_signal | signal to the tower fan, % |
| chws / chwr | chilled water supply to / return from the building |
| chw_gpm | chilled water flow |
| oa_db / oa_wb | outside air temperature / wet bulb |
| cw_pump / chw_pump | condenser water pump / building CHW pump (on/off) |
| phx_on, phx_chw_in, phx_chw_out | PHX-1 status and its CHW temperatures |
| walkin_temp | walk-in cooler box temperature |

Saving and closing Notepad restarts the gateway. Then use **1 Test** to check.

## If it runs on the Compass PC

Only one program on a PC can use the standard BACnet port (UDP 47808), and Compass already has it. The installer notices this and uses **47809**. Compass is not affected.

On that port, the gateway can't count on broadcast replies, so give each device its address in `config.json` under `devices`:

- `120`: the BCM's IP, `"192.168.1.43"`.
- `5001` and `505002` (on the MS/TP trunk behind the BCM): `"NETWORK:MAC@192.168.1.43"`, for example `"2001:12@192.168.1.43"`. Compass's device list shows each device's network number and MAC. Northwest Controls can read them off too.

On its own PC, leave those blank: the gateway finds the devices by itself.

## Fault messages

The chiller's safety and cycling fault codes (AV 402, 403) arrive as "SAFETY FAULT CODE 21" and so on. To show the York panel message instead, add it under `fault_codes` in `config.json`, for example `"21": "LEAVING CHILLED LIQUID - LOW TEMPERATURE"`.

## Troubleshooting

- **Gateway tools > 5 Show the log** shows what happened each round.
- *"device 5001 not answering"*: check the network cable or Wi-Fi is on the BAS network, the device numbers, and the device addresses if on the Compass PC.
- *"Server refused the plant key"*: the key in config.json doesn't match `PLANT_INGEST_KEY` in Render.
- The Plant page's **Gateway** tab shows each point's latest value and how old it is.

## Commands

```
venv\Scripts\python.exe ciq_gateway.py test            read once, send nothing
venv\Scripts\python.exe ciq_gateway.py test --send     read once and send it
venv\Scripts\python.exe ciq_gateway.py discover        list BACnet devices
venv\Scripts\python.exe ciq_gateway.py discover 120 --find chw,walk
```
Stop the gateway first (Gateway tools > 8) so the port is free, then restart it (7).

## Remove

Double-click **uninstall.cmd**.
