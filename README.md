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
- Scheduled PM tasks by equipment
- PM shows up on the events calendar so it doesn't collide with club events

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
| **Manager** | Approve invoices, arrange the map, view reports and capital plan, assign work |
| **Technician** | Work orders, PM, equipment records, diagnosis, inventory |
| **Department staff** | Submit requests and log kitchen temperatures (kitchen, tennis, golf, pool staff) |
| **View-only** | See status and reports, change nothing |

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
- Live video and voice diagnosis through Gemini
- Club-owned domain

---

Built by Stephen Harris for The Country Club of Little Rock.
