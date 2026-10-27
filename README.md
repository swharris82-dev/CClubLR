# Clubhouse IQ

**Facilities, equipment, and maintenance management for The Country Club of Little Rock.**

Clubhouse IQ is a phone-first web app (with an Android app) that puts every building, every piece of equipment, every work order, and every vendor at the club in one place. It is built around how the club actually runs: a central plant with a water-cooled chiller, cooling tower, plate heat exchanger for free cooling, and boilers, feeding chilled water and hot water to air handlers and fan coils across older buildings. Add the kitchens, a pool, indoor tennis, and the golf operation, and that's the club.

Live app: https://clubhouse-iq.onrender.com
Repository: github.com/swharris82-dev/CClubLR

---

## Why Clubhouse IQ

| Problem today | What Clubhouse IQ does |
|---|---|
| Equipment history lives in people's heads, binders, and old emails | Every asset has a record: tag, nameplate data, location, age, condition, and full service history |
| Issues get reported by phone, text, or in passing and get lost | Department staff submit requests from their phone; nothing falls through |
| Troubleshooting a plant problem means checking one unit at a time | AI diagnosis understands the central plant, so it looks across connected equipment, not just the unit that's complaining |
| Health inspections mean scrambling for temperature logs and service records | Kitchen temps, hood, grease trap, and fire suppression records are logged and printable as an inspector binder |
| PM is a checkbox, so nobody sees a chiller or air handler drifting until it fails | PM takes readings with normal ranges. A bad number opens a repair on the spot, and every reading is charted over time |
| Units are spread across attics, the boiler room, and back rooms | PM is grouped into walks by location, and a QR tag on each unit opens the PM due on it |
| A filter change stalls because the filters aren't on the shelf | Each PM carries its parts kit, and the app builds the shopping list before the work comes due |
| Replacement costs surprise the budget | A 10-year capital plan projects replacements from equipment age, condition, and inflation |
| Vendor insurance and contracts expire without anyone noticing | Insurance, W-9s, and contract renewals are tracked with alerts |
| No easy way to show leadership what maintenance accomplished | A printable monthly facilities report, with an optional AI-written summary |

---

## Features

### Property map
- Schematic map of the club's buildings: Central Plant, Clubhouse, Indoor Tennis Center, Fitness Center, Pool Pavilion, Family & Teen Center, Golf Shop
- Each building is colored by status: **critical**, **warning**, **busy**, or **OK**
- Managers can drag buildings to arrange the map

### Equipment registry
- Club-specific equipment types: boilers, cooling tower, pumps, plate heat exchanger, water treatment, air handling units, rooftop units, walk-in coolers, ice machines, commercial kitchen equipment, pool equipment
- Asset tags (AHU-1, BLR-1, CT-1, P-1, and so on)
- Manufacturer library includes the brands on site: Lochinvar, BAC, ClimateMaster, FHP, WaterFurnace, Bell & Gossett, Hoshizaki, Pentair, and more
- **Air handlers preloaded:** all 12 units from the club's AHU sheet (AHU-1 through AHU-11 in the Clubhouse and Golf Shop, plus YC-AHU-1 at the Youth Center), each with the rooms it serves and where to find it. Make, model, serial, filter, and belt sizes get filled in from the nameplate on the first walk.
  - New air handlers go on the PM schedule automatically (filters, belts, coils).
  - The sheet loads on every server start but only adds units that aren't already in the app, so edits made in the app are never overwritten.
  - The Youth Center unit is tagged YC-AHU-1 so it isn't confused with the Ballroom's AHU-1.
- **Data plate scanner:** photograph a nameplate and the model, serial, and specs fill in automatically

### AI diagnosis
- Describe the symptom and get a likely cause and next steps
- Plant-aware: knows that a comfort complaint can start at the chiller, boiler, cooling tower, pumps, or heat exchanger, and checks the related equipment's recent history

### Work orders
- Create, assign, and close work orders by building and equipment
- Before and after photos
- Signature sign-off on completion
- Parts used are deducted from inventory automatically

### Preventive maintenance
The PM schedule has five views: **Schedule**, **Rounds**, **Parts**, **Scorecard**, and **Club hours**.

- **Standard plan:** one tap builds PM for every piece of equipment on file, by type: chiller daily log, monthly check, and annual service; tower inspection and spring startup; boiler LWCO tests and fall combustion test; pump inspection and lead/lag rotation; PHX-1 free cooling test; air handler filters, belts, and semiannual PM; fan coils, walk-ins, ice machines, pool, water treatment, and BAS review
- **Readings, not just checkboxes:** a checklist step can take a number with a normal range (cold deck 50 to 60°F, filter pressure drop under 1.0 in. w.c., chilled water leaving 42 to 50°F). A reading outside the range opens a high-priority repair work order by itself
- **Trends:** every reading is saved and charted on the equipment record against its normal band, with a flag when a value is drifting
- **Rounds:** open PM grouped into walks by location (Clubhouse attic right side, attic left side, boiler room), in stop order, with the parts to pull before you go
- **QR tags:** print a tag for every unit. Scan it with the in-app scanner or the phone camera and the PM due on that unit opens
- **Parts kits:** each PM can carry the parts it uses. The kit pre-fills the close-out form, and the Parts view adds up everything due in the next 14 to 90 days against what's on the shelf, grouped by vendor, ready to copy as an order. Filter and belt kits can be set up in one tap from the sizes typed on each record
- **Three ways to come due:** every so many days, the same date every year (tower startup in March, boiler service in September, free cooling test in October), or by run hours on the meter with a day limit as a backstop
- **Shutdown windows:** PM that needs a unit off is moved off no-work event days and tells you the hours it can come down, based on each building's club hours
- **Scorecard:** PM on-time rate, planned work vs. repairs (by count and hours), readings out of range and the repairs they caught, overdue PM, and a six-month trend. The same numbers go on the dashboard and in the monthly report

### Parts and inventory
- Stock levels for filters, belts, chemicals, and common parts
- Reorder list grouped by vendor

### Vendors and contracts
- Vendor directory with insurance and W-9 tracking
- Contract renewal alerts
- Invoices require manager approval

### Kitchen compliance
- AM and PM temperature logging for coolers and freezers
- An out-of-range reading automatically opens a maintenance work order
- Tracks scheduled services: hood cleaning, grease trap, fire suppression
- One-tap printable inspector binder

### Events calendar
- Club events alongside PM, work orders, and vendor visits
- Conflict detection (for example, a vendor visit scheduled during a tournament)
- Optional import of an existing calendar feed (.ics)

### Capital planning
- 10-year replacement forecast based on age, condition, and inflation
- Useful for budget meetings and board requests

### Alerts and reports
- Email and text alerts for critical issues
- Printable monthly facilities report with optional AI summary

### Works offline
- Keeps working in a mechanical room or basement with no signal
- Changes are queued on the phone and sync when the connection returns

### Android app
- Installs like any other app
- Camera and gallery access for photos and data plate scans
- Tap-to-call, email, and text links open the phone's own apps
- Reports can be printed or saved as PDF from inside the app

---

## User roles

| Role | Can do |
|---|---|
| **Admin** | Everything, including adding users and setting roles |
| **Manager** | Approve invoices, arrange the map, view reports and capital plan, assign work, set club hours |
| **Technician** | Work orders, PM, readings, hour meters, kits, equipment records, diagnosis, inventory |
| **Department staff** | Submit requests and log kitchen temperatures (kitchen, tennis, golf, pool staff) |
| **View-only** | See status, PM scorecard, and reports, change nothing |

Permissions are enforced on the server, not just hidden in the screen.

---

## How-to guide

### First login
1. Open https://clubhouse-iq.onrender.com or the Android app.
2. Sign in with the email and temporary password your admin gave you.
3. Set your own password when prompted.

### Add a user (admin)
1. Open the **Team** tab.
2. Tap **Add person**, enter name and email, and pick a role.
3. Share the temporary password with them.

### Fill in an air handler from its nameplate
1. Open the unit (for example, AHU-2) from the building list.
2. Tap **Scan data plate** and photograph the nameplate.
3. Add the filter size and count and the belt number, then save.

### Add equipment
1. Go to the building, then tap **Add equipment**.
2. Tap **Scan data plate** and photograph the nameplate.
3. Check the fields that filled in, add the asset tag and location, and save.

### Report a problem (any staff)
1. Tap **New request**.
2. Pick the building and, if you know it, the equipment.
3. Describe what's wrong and add a photo.
4. Submit. Maintenance is notified.

### Diagnose an issue (technician)
1. Open the equipment record and tap **Diagnose**.
2. Describe the symptom (for example, "AHU-4 zones running warm, chilled water valve 100% open").
3. Review the suggested causes. If it points to the plant, check the linked chiller, boiler, tower, or pump records it lists.

### Work a work order
1. Open the work order and tap **Start**.
2. Add a **before** photo.
3. Log parts used (inventory updates on its own).
4. Add an **after** photo, notes, and get a signature.
5. Tap **Complete**.

### Close out a PM with readings
1. Open the PM work order and tap **Complete**.
2. Enter each reading. A value outside the normal range turns red before you save.
3. Check off the other steps. Parts from the kit are already filled in; change them if you used something different.
4. Tap **Mark complete**. Any out-of-range reading opens its own repair work order, and the next PM is scheduled.

### Add a reading to a PM checklist
End the checklist line with the unit and range in brackets:
- `Cold deck temp [°F 50-60]` takes a reading with a normal range
- `Filter pressure drop [in. w.c. max 1.0]` has an upper limit only (use `min` for a lower limit)
- `Blower motor amps [A]` takes a reading with no range

### Walk a PM round
1. Open **Work**, then **PM schedule**, then **Rounds**.
2. Pick the window (due now, 7, 14, or 30 days).
3. Pull the parts listed for the walk, then work the stops in order.
4. At each unit, tap **Scan a tag** and photograph its QR tag, or tap the task in the list.

### Print QR tags
1. Open **Rounds** and tap **Print QR tags** for every unit, or **Tags** on one walk.
2. Tap **Print or Save PDF**. Laminate them and mount each one where the unit is serviced.

### Order parts for upcoming PM
1. Open **PM schedule**, then **Parts**.
2. The first time, tap **Set up kits from records**. It reads the filter size and count and the belt size on each record and lists any units still missing them.
3. Pick the window and tap **Copy order list** to paste into an email or text to the vendor.

### Log an hour meter
1. Open the equipment record and scroll to **Readings and run hours**.
2. Enter the meter reading and tap **Log**. If the meter was replaced, check **Meter was reset or replaced** first.
3. Run-hour PM on that unit comes due when its hours run out.

### Set club hours (manager)
1. Open **PM schedule**, then **Club hours**.
2. Add or edit each building's open days and hours. Shutdown PM is planned outside them.
3. Use **When can it come down?** to see the next clear days for a building.

### Log kitchen temperatures
1. Open **Kitchen**, then **Temp log**.
2. Enter the AM or PM reading for each unit.
3. If a reading is out of range, a work order opens automatically.

### Print the inspector binder
1. Open **Kitchen**, then **Inspector binder**.
2. Tap **Print or Save PDF**.

### Run the monthly report (manager)
1. Open **Reports**, then **Monthly facilities report**.
2. Turn on **AI summary** if you want a written overview.
3. Tap **Print or Save PDF**.

### Working without signal
Keep working as normal. A banner shows you're offline. Your changes save on the phone and upload when you reconnect. Don't log out while offline or queued changes are lost.

---

## Setup (for developers)

**Stack:** Node.js server, single-page web front end, hosted on Render with a persistent disk. Android app is a WebView wrapper (`org.cclr.clubhouseiq`).

### Main files
| File | What it does |
|---|---|
| `server.js` | Server, login, equipment records, AI diagnosis |
| `profiles.js` | Equipment types and the AI diagnosis rules for each |
| `workorders.js` | Work orders, PM schedule, standard PM plan, staff requests, dashboard |
| `pm2.js` | PM readings, rounds and QR tags, parts kits, triggers, shutdown windows, scorecard |
| `ops.js` | Users, parts, vendors, alerts, monthly report |
| `round2.js` | Map, kitchen compliance, events, capital plan, photos, signatures |
| `ahus.js` | The club's 12 air handlers from the AHU sheet |
| `public/` | The app screens (`index.html`, `ops-ui.js`, `round2-ui.js`, `pm-ui.js`) |

### Run locally
```bash
git clone https://github.com/swharris82-dev/CClubLR.git
cd CClubLR
npm install
npm start
```

### Environment variables
| Variable | Purpose |
|---|---|
| `DATA_DIR` | Where data is stored (`/data` on Render) |
| `JWT_SECRET` | Signs login tokens |
| `ANTHROPIC_API_KEY` | AI diagnosis, data plate scanning, report summaries |
| `GEMINI_API_KEY` | Gemini AI features |
| `PROPERTY_NAME` / `PROPERTY_CITY` | Branding |
| `DEMO_MODE` | Loads sample data when on |
| SMTP settings | Email alerts |
| Twilio settings | Text alerts |

See `SETUP.md` for the full list and step-by-step configuration.

### Deploy on Render
- Build: `npm install`
- Start: `npm start`
- Plan: Starter (the free tier sleeps and loses data)
- Disk: mount at `/data`, 1 GB

### Android build
Keep the signing keystore (`.jks`) and its password somewhere safe. Every future update to the app must be signed with the same key, and Google Play will reject an update signed with anything else.

---

## Roadmap
- Google Play release
- Pull hour meters and readings straight from the Alerton BAS instead of typing them
- Live video and voice diagnosis through Gemini
- Club-owned domain

---

Built by Stephen Harris for The Country Club of Little Rock.
