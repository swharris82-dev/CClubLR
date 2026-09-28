# Clubhouse IQ Setup

Equipment tracking, work history, and AI diagnostics for the Country Club of Little Rock.
Node + SQLite. One codebase, no external database to configure. Forked from Unit IQ.

## What it does

- **Equipment directory.** Every piece of equipment has a tag (BLR-1, CT-1, P-1, HP-CH-01) and a building (Central Plant, Clubhouse, Indoor Tennis Center, Pool Pavilion, and so on).
- **Diagnose.** Describe the problem, get ranked causes with odds, the check that confirms each one, a truck list, and a message for the staff member who reported it. Runs with the equipment's history AND the water loop status, so a heat pump lockout gets tied to a tower or pump problem when that is the real cause.
- **Record.** Equipment type, manufacturer, type-specific details (boiler certificate dates, tower fan drive, pump lead/lag), the safety device for that type (low water cutoff, vibration switch, flow switch, condensate switch), and a registry with model, serial, install date, and warranty.
- **History.** Every job, who logged it, and vendor cost avoided.
- **Work orders.** Every request and repair is a work order with a priority, due date, assignee, notes timeline, and photo. Tie one to a piece of equipment and closing it writes the job into that equipment's service history automatically. Filters for Open, New requests, Mine, PM due, and Done.
- **PM schedule.** Recurring preventive maintenance by equipment: LWCO tests, tower inspections, pump rotation, filter changes, water tests. "Load standard plan" builds the whole schedule from the equipment on file. Each task opens its own work order before it comes due, with a checklist, and closing it rolls the next due date forward.
- **Staff request page.** `/request` is a no-login page any employee can open on their phone to report a problem, with building, location, urgency, and a photo. It lands in New requests. They can check status from the same phone. `/signs` prints a QR sign per building that opens the page with that building already picked.
- **Dashboard.** Open repairs, new requests, overdue work, PM on-time rate, what needs attention, opened vs closed by week, how long work has been waiting, open work by building, labor hours, and vendor cost avoided this month and year.
- **Reports.** Cost avoided by month, water loop activity, safety devices out of service, repeat problems, work by building, and warranty watch.

## Sample data

`seed.js` loads the club's buildings with a central plant (2 boilers, cooling tower, plate heat exchanger, 3 pumps, expansion tank, water treatment, controls) and heat pumps and kitchen, pool, and tennis equipment. Models, serials, and counts are placeholders. Replace them from the data plates.

## Put a demo on your phone

Deploy it to Render with demo mode on. You get a URL that works anywhere, on
any phone, with no login and no laptop.

1. Push this folder to a GitHub repo (private is fine).
2. Render → **New** → **Web Service** → connect the repo.
3. Build command `npm install` · Start command `npm start`
4. Instance type: **Free**.
5. Environment variables:
   - `DEMO_MODE` = `true`
   - `ANTHROPIC_API_KEY` = your key
   - `JWT_SECRET` = any long random string
6. Deploy. You get a URL like `clubhouse-iq.onrender.com`.

Open it on your phone. It loads straight into the app with the sample property
already populated — no signup, nothing to type. In demo mode the app reseeds
itself on every boot, so the free tier wiping its disk doesn't matter.

**Add it to your home screen** (Share → Add to Home Screen) and it opens full
screen with no browser chrome. That's what sells it — it looks like an app, not
a website.

**One trap:** the free tier sleeps after 15 minutes idle, and a cold start takes
around 50 seconds. If you're about to show someone, pull the URL up on your
phone a minute before you walk in so it's already awake. Nothing kills a demo
like a white screen.

For the real thing later, deploy a second service with `DEMO_MODE` unset, a disk
at `/var/data`, and `DATA_DIR=/var/data`. Keep the demo and the live data
completely separate.

### Or just run it on your laptop and open it from your phone

If both are on the same wifi, run `npm start` on the laptop, find its local IP
(`ipconfig getifaddr en0` on a Mac, `hostname -I` on Linux), and open
`http://THAT-IP:3000` on your phone. Faster to set up, but only works on that
network.

## Try it without creating a login

```bash
npm install
node seed.js                                    # loads sample units
DEMO_MODE=true ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000 and you're in — no signup screen, signed in
automatically as Demo Tech, with a yellow banner so nobody mistakes it for the
real thing.

`node seed.js` loads seven realistic units: building 7 with three float switches
mounted wrong (so the building-defect report has something to show), a
Mitsubishi VRF pair on the same branch controller both throwing 6607, an LG
ductless with a fouled blower wheel, and a clean Carrier split for contrast.
About $3,200 in cost avoided across eight jobs, so the Reports tab looks like a
property that's actually been worked.

It's safe to run seed.js more than once — it skips units that already have
history.

**Turn DEMO_MODE off before this touches real data.** With it on, anyone who
reaches the URL is signed in as a manager. It's for local evaluation and for
walking someone through the app, not for the field.

## Run it locally

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000. The first account created becomes the manager.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | From console.anthropic.com. Server-side only, never exposed to the browser. |
| `JWT_SECRET` | yes in production | Any long random string. Sessions break if it changes. |
| `DATA_DIR` | on Render | Set to `/var/data` so the database survives restarts. |
| `ALLOW_SIGNUP` | optional | Set to `false` to close signups once your techs have accounts. |
| `DEMO_MODE` | optional | `true` skips the login screen entirely. Local evaluation only — never with real data. |
| `PROPERTY_NAME` | optional | Defaults to The Villa at River Pointe. |
| `PROPERTY_CITY` | optional | Defaults to Maumelle, AR. |

## Deploy to Render

1. Push this folder to a GitHub repo.
2. Render → New → **Web Service**, point it at the repo.
3. Build command: `npm install` · Start command: `npm start`
4. Add the environment variables above.
5. **Important:** Render → Disks → add a disk mounted at `/var/data`, then set
   `DATA_DIR=/var/data`. Without a disk, the free tier wipes the database on
   every restart and you lose everything.

## System type routing

The diagnostic changes based on what's actually installed, not just the symptom.
Each system type in `profiles.js` controls three things:

- **What the Unit Record asks for.** A VRF unit asks for outdoor system ID,
  branch controller and port, indoor address, and piping notes. A ceiling mount
  asks about access and secondary pan. Fields swap live when you change the type.
- **How the diagnosis reasons.** VRF guidance forbids split-system logic — no
  contactor, no run capacitor, never "top off" the charge — and pushes toward
  branch controller, transmission wiring, EEV, and address conflicts. Ceiling
  mount guidance ranks condensate first on any water complaint because overflow
  becomes a drywall claim. Split guidance orders checks cheapest-first.
- **Whether a fault code is demanded.** VRF and ductless self-report. On those,
  a Fault Code field appears on the Diagnose tab, and if you leave it blank the
  model is instructed to make retrieving the code the first step and say plainly
  that its ranking is low confidence without it.

VRF gets one extra behavior: the server passes in other VRF units in the same
building, so a fault that's really a branch controller or riser problem gets
flagged as systemic rather than diagnosed as a single bad head. That call is the
most valuable one on this equipment and the one most often missed.

To add or tune a system type, edit `profiles.js`. Nothing else needs to change —
the form fields, the prompt, and the fault-code behavior all read from it.

## Manufacturer logic

Once a system type is chosen, the Manufacturer dropdown shows only brands that
make that kind of equipment — Mitsubishi and LG on a VRF, Goodman and Carrier on
a split. Picking one loads that brand's rules into the diagnosis and shows the
tech where codes are read on that equipment.

Covered: Carrier, Bryant, Payne, Trane, American Standard, Lennox, Goodman,
Amana, Rheem, Ruud, York, Coleman, Heil/ICP, Nortek/Nordyne, Bosch, Mitsubishi
Electric, LG, Daikin, Fujitsu, Samsung, Panasonic, Toshiba-Carrier, Hitachi,
Gree, Midea, Pioneer.

Each carries its real code convention and known weak points — LG CH-codes and
blower-wheel water spray, Mitsubishi M-NET addressing and 6607 comms faults,
Goodman's pre-2015 coil warranty issue, Trane's Spine Fin coils, Lennox's
dealer-restricted parts. Rebadges are flagged so parts cross-reference correctly
(Carrier/Bryant, Trane/American Standard, Goodman/Amana, Rheem/Ruud).

Edit `manufacturers.js` to add brands or tune the rules.

## The unit brief

The panel under the nameplate is a written summary of what a tech needs to know
before opening the door. It regenerates automatically whenever the record,
equipment, or job history changes, and is cached until then so it costs nothing
to reopen a unit. "Regenerate" forces a fresh one.

If `ANTHROPIC_API_KEY` isn't set the panel hides itself rather than erroring.

## Accounts

Each tech taps "Need an account? Create one." The first account created is the
manager; everyone after is a tech. Once everyone is in, set
`ALLOW_SIGNUP=false` so nobody outside the team can register.

Every save records who did it. Unit records show last-updated-by, and each job
shows who logged it.

## Using it on the truck

Add to home screen (Share → Add to Home Screen) and it runs full screen like a
native app.

## The two habits that make this worth anything

1. **Log the cost avoided on every job.** Date, unit, what you did, what it
   would have billed contracted out. That number on the Reports tab is what you
   show a regional manager. Without it you have a tool; with it you have a
   business case.
2. **Fill in equipment install dates.** Warranty watch is the feature techs
   open the app for on their own, because it stops them buying parts that are
   already covered.

## Notes

- Data lives in `unitiq.db` in your `DATA_DIR`. Back it up periodically.
- The Export button on Reports copies everything as plain text for emailing.
- Triage costs a fraction of a cent per run through the Anthropic API.


## Optional environment variables for the request page

- `MAINT_PHONE` = the maintenance phone number. Shown on the request page when someone picks Emergency, as a tap-to-call link.
- `PUBLIC_URL` = the address staff should use, like `https://clubhouse-iq.onrender.com`. The QR signs use it. If it is not set, the signs use whatever address you opened `/signs` from.
