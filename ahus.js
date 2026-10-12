/**
 * The club's air handling units, from the "CCLR Air Handling Units" sheet
 * Bruce handed over (photographed Oct 2026).
 *
 * Each entry lists the rooms the unit serves and where to find it, exactly as
 * the sheet has them. Make, model, serial, filter and belt sizes are not on the
 * sheet. Fill those in from the nameplate on the first walk.
 *
 * loadAhus() runs on every server start. It only ADDS units that are not in the
 * database yet, so anything edited in the app is never overwritten.
 */

const { db, getOrCreateUnit } = require('./db');

const TYPE = 'Air handling unit (AHU)';
const SRC = 'From the CCLR Air Handling Units sheet.';

const AHUS = [
  {
    tag: 'AHU-1', building: 'Clubhouse',
    serves: 'Ballroom',
    location: 'Attic, right side. Turn left, then through the door.'
  },
  {
    tag: 'AHU-2', building: 'Clubhouse',
    serves: 'Reception, Library, Member Restrooms, Main Level Hall, GM Office, Parlor, Admin Office, Accounting Office',
    location: 'Attic, left side.'
  },
  {
    tag: 'AHU-3', building: 'Clubhouse',
    serves: 'AWJ',
    location: 'Attic, right side.',
    extra: 'Sheet lists the area as "AWJ". Confirm the full room name.'
  },
  {
    tag: 'AHU-4', building: 'Clubhouse',
    serves: 'Garden Room, Centennial Bar, Presidents Lounge',
    location: 'Attic, right side, in the back.',
    mau: 'Yes. Handwritten "+ MAU" next to this unit on the sheet. Confirm which make-up air unit.',
    extra: 'Garden Room is also listed under AHU-9.'
  },
  {
    tag: 'AHU-5', building: 'Clubhouse',
    serves: 'Veg Prep / Purchasing, Ladies Locker Room, Mens Locker Room, Ladies Card Room, Mens Grill, Mixed Grill',
    location: 'Boiler room.'
  },
  {
    tag: 'AHU-6', building: 'Golf Shop',
    serves: 'Pro Shop',
    location: 'Back of the bag room.'
  },
  {
    tag: 'AHU-7', building: 'Clubhouse',
    serves: 'Kitchen',
    location: 'Attic, on the right, in the back.'
  },
  {
    tag: 'AHU-8', building: 'Clubhouse',
    serves: '',
    location: '',
    extra: 'Sheet lists AHU 8 with no area served and no location. Find it and fill both in.'
  },
  {
    tag: 'AHU-9', building: 'Clubhouse',
    serves: 'Garden Room',
    location: '',
    extra: 'No location on the sheet. Garden Room is also listed under AHU-4.'
  },
  {
    tag: 'AHU-10', building: 'Clubhouse',
    serves: 'Mens Card Room (back), Mixed Grill (back)',
    location: 'Hallway into the Mens Grill, near the door to the Pro Shop.'
  },
  {
    tag: 'AHU-11', building: 'Clubhouse',
    serves: 'Terrace Room',
    location: 'Bottom level, near the maintenance shop.'
  },
  {
    tag: 'YC-AHU-1', building: 'Family & Teen Center',
    serves: 'Youth Center',
    location: 'Across from the laundry.',
    extra: 'Listed on the sheet as "AHU 1, Youth Center". Tagged YC-AHU-1 here so it is not confused with the Ballroom AHU-1.'
  }
];

function loadAhus() {
  const has = db.prepare('SELECT id FROM units WHERE apt=?');
  const newIds = [];
  const tx = db.transaction(() => {
    for (const a of AHUS) {
      if (has.get(a.tag)) continue;
      const unit = getOrCreateUnit(a.tag);
      const meta = {};
      if (a.serves) meta.serves = a.serves;
      if (a.location) meta.location = a.location;
      if (a.mau) meta.mau = a.mau;
      const notes = [
        a.location ? 'Find it: ' + a.location : 'Location not on the sheet yet.',
        a.extra || '',
        SRC + ' Make, model, serial, filter and belt sizes still need to come off the nameplate.'
      ].filter(Boolean).join('\n');
      db.prepare(`UPDATE units SET building=?, system_type=?, manufacturer='', system_meta=?, drain_design='',
                  switch_present='unk', switch_functioning='unk', switch_notes='', notes=?,
                  updated_by='AHU sheet', updated_at=datetime('now') WHERE id=?`)
        .run(a.building, TYPE, JSON.stringify(meta), notes, unit.id);
      newIds.push(unit.id);
    }
  });
  tx();

  // Put the new units on the PM schedule (filters, belts, coils).
  if (newIds.length && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pm_tasks'").get()) {
    try { require('./workorders').addStarterPMs(newIds); } catch (e) { console.log('  AHU PM setup skipped: ' + e.message); }
  }
  return newIds.length;
}

module.exports = { AHUS, loadAhus, AHU_TYPE: TYPE };
