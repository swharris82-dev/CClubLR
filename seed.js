/**
 * Seeds realistic sample data so the app can be opened and evaluated without
 * entering anything by hand. Safe to run repeatedly — it skips units that
 * already exist.
 *
 *   node seed.js
 */

const { db, getOrCreateUnit, unitFull } = require('./db');

const SAMPLE = [
  {
    apt: '7A-204',
    system_type: 'Ceiling mount air handler',
    manufacturer: 'Goodman',
    system_meta: { access_notes: 'Hall ceiling access panel, need 6ft ladder', pan_type: 'Secondary pan present, no secondary drain', filter_size: '16x25x1' },
    drain_design: 'Gravity drain. Two tees with both vents left open and a cleanout at the head. Long horizontal run above the hall ceiling with almost no pitch before it ties into the stack.',
    switch_present: 'yes',
    switch_functioning: 'no',
    switch_notes: 'Float switch mounted on the opposite end of the pan from the drain, so the pan overflows into the ceiling before the float ever lifts. Non-protective as installed.',
    notes: 'Unit above the hallway. Any overflow lands on the ceiling outside the bedroom, not in a closet. Treat water complaints here as urgent.',
    equipment: [
      { component: 'Air handler', manufacturer: 'Goodman', model: 'ARUF37C14', serial: '1809123456', install_date: '2019-06-15', warranty_years: 10, refrigerant: 'R-410A' },
      { component: 'Condenser', manufacturer: 'Goodman', model: 'GSX140361', serial: '1811998877', install_date: '2019-06-15', warranty_years: 10, refrigerant: 'R-410A' }
    ],
    jobs: [
      { job_date: '2026-04-18', reported: 'Small water spot on hallway ceiling', diagnosis: 'Condensate overflow, primary drain restricted', work_performed: 'Blew out drain line with nitrogen, flushed pan', vendor_cost_avoided: 285, cost_basis: 'Typical contractor call-out plus labor', hours: 1.0 },
      { job_date: '2026-06-02', reported: 'Ceiling stain spreading, water dripping', diagnosis: 'Condensate overflow again, same primary drain', work_performed: 'Cleared drain, added cleanout, tested float — float did not trip before overflow', vendor_cost_avoided: 320, cost_basis: 'Contractor drain clearing rate', hours: 1.5 },
      { job_date: '2026-08-12', reported: 'Water dripping from hallway ceiling, AC still cooling', diagnosis: 'Clogged primary condensate drain', work_performed: 'Cleared drain, replaced float switch and relocated to low end of pan', parts_used: 'Float switch, 3/4 PVC, cleanout tee', vendor_cost_avoided: 385, cost_basis: 'Contractor call-out plus part markup', hours: 2.0 }
    ]
  },
  {
    apt: '7A-206',
    system_type: 'Ceiling mount air handler',
    manufacturer: 'Goodman',
    system_meta: { access_notes: 'Hall ceiling panel', filter_size: '16x25x1' },
    drain_design: 'Same gravity configuration as the rest of building 7. Two tees, vents open, minimal pitch.',
    switch_present: 'no',
    switch_functioning: 'unk',
    switch_notes: 'No float switch installed at all. Nothing to stop an overflow.',
    equipment: [
      { component: 'Air handler', manufacturer: 'Goodman', model: 'ARUF37C14', serial: '1809445566', install_date: '2019-06-15', warranty_years: 10, refrigerant: 'R-410A' }
    ],
    jobs: [
      { job_date: '2026-07-08', reported: 'Ceiling looks wet near bedroom door', diagnosis: 'Condensate overflow', work_performed: 'Cleared drain, noted missing float switch for follow-up', vendor_cost_avoided: 300, cost_basis: 'Contractor drain service', hours: 1.25 }
    ]
  },
  {
    apt: '7B-301',
    system_type: 'Ceiling mount air handler',
    manufacturer: 'Goodman',
    drain_design: 'Gravity, same building 7 configuration.',
    switch_present: 'yes',
    switch_functioning: 'no',
    switch_notes: 'Switch present but mounted high on the pan wall, same defect as 7A-204.',
    notes: 'Third unit in building 7 with the float mounted wrong. This is an install defect across the building, not a coincidence.'
  },
  {
    apt: '12B-301',
    system_type: 'VRF / VRV',
    manufacturer: 'Mitsubishi Electric',
    system_meta: { outdoor_id: 'OU-3 (roof, north end)', branch_ctrl: 'BC-2, port 4', indoor_addr: '07', last_error: '6607', piping_notes: 'Long riser from 1st floor mechanical, 6 floors' },
    switch_present: 'yes',
    switch_functioning: 'yes',
    notes: 'Ceiling cassette. Shares BC-2 with 302, 303 and 304. Shutting down for service affects all four.',
    equipment: [
      { component: 'Indoor cassette', manufacturer: 'Mitsubishi Electric', model: 'PLFY-P12NFMU', serial: '7A012345', install_date: '2022-03-10', warranty_years: 7, refrigerant: 'R-410A' },
      { component: 'Branch controller', manufacturer: 'Mitsubishi Electric', model: 'CMB-P108NU', serial: '7B554433', install_date: '2022-03-10', warranty_years: 7 }
    ],
    jobs: [
      { job_date: '2026-08-11', reported: 'Head not cooling, display showing a code', error_code: '6607', diagnosis: 'No communication received — transmission wiring fault', work_performed: 'Found shield not terminated at BC-2. Retermed shield, verified M-NET voltage, fault cleared.', parts_used: 'Shielded transmission wire', vendor_cost_avoided: 900, cost_basis: 'VRF specialist call-out, 2hr minimum plus travel', hours: 2.5 }
    ]
  },
  {
    apt: '12B-302',
    system_type: 'VRF / VRV',
    manufacturer: 'Mitsubishi Electric',
    system_meta: { outdoor_id: 'OU-3', branch_ctrl: 'BC-2, port 5', indoor_addr: '08' },
    switch_present: 'yes',
    switch_functioning: 'yes',
    jobs: [
      { job_date: '2026-08-10', reported: 'Intermittent no cooling', error_code: '6607', diagnosis: 'Comms fault, same branch controller as 301', work_performed: 'Cleared after BC-2 shield repair on 301', vendor_cost_avoided: 450, cost_basis: 'Second unit on same trip', hours: 0.5 }
    ]
  },
  {
    apt: '3A-102',
    system_type: 'Ductless mini-split',
    manufacturer: 'LG',
    system_meta: { indoor_model: 'LSN120HSV5', outdoor_model: 'LSU120HSV5', drain_type: 'Gravity to exterior', last_error: 'CH 05' },
    switch_present: 'unk',
    switch_functioning: 'unk',
    notes: 'Converted office space. Single head, wall mount above the window.',
    equipment: [
      { component: 'Indoor head', manufacturer: 'LG', model: 'LSN120HSV5', serial: '204KAQR12345', install_date: '2021-09-22', warranty_years: 10, refrigerant: 'R-410A' }
    ],
    jobs: [
      { job_date: '2026-05-14', reported: 'Water spitting out of the indoor unit onto the floor', diagnosis: 'Fouled blower wheel — misreported as a refrigerant leak', work_performed: 'Pulled and cleaned blower wheel, cleaned coil, flushed drain', vendor_cost_avoided: 425, cost_basis: 'Ductless deep clean, contractor rate', hours: 2.0 }
    ]
  },
  {
    apt: '2A-105',
    system_type: 'Split system / air handler',
    manufacturer: 'Carrier',
    system_meta: { breaker_loc: 'Panel in laundry closet, breaker 14', filter_size: '20x25x1', tstat_model: 'Honeywell T4 Pro' },
    drain_design: 'Vertical air handler in the laundry closet. Gravity drain with trap, terminates at the exterior wall. Secondary pan under the unit with a pan switch.',
    switch_present: 'yes',
    switch_functioning: 'yes',
    switch_notes: 'Pan switch under the air handler, tested and trips correctly.',
    equipment: [
      { component: 'Air handler', manufacturer: 'Carrier', model: 'FV4CNF003', serial: '3418A55512', install_date: '2024-05-02', warranty_years: 10, refrigerant: 'R-410A' },
      { component: 'Condenser', manufacturer: 'Carrier', model: '24ABC636', serial: '3418A99123', install_date: '2024-05-02', warranty_years: 10, refrigerant: 'R-410A' }
    ],
    jobs: [
      { job_date: '2026-07-22', reported: 'Not cooling well, running constantly', diagnosis: 'Dirty filter and restricted return', work_performed: 'Replaced filter, cleaned return grille, verified delta-T at 18 degrees', parts_used: 'Filter', vendor_cost_avoided: 150, cost_basis: 'Minimum contractor service call', hours: 0.5 }
    ]
  }
];

function seed() {
  let created = 0, skipped = 0;
  for (const s of SAMPLE) {
    const existing = db.prepare('SELECT id FROM units WHERE apt=?').get(s.apt);
    const unit = getOrCreateUnit(s.apt);
    if (existing) {
      const hasJobs = db.prepare('SELECT COUNT(*) c FROM jobs WHERE unit_id=?').get(unit.id).c;
      if (hasJobs) { skipped++; continue; }
    }

    db.prepare(`UPDATE units SET system_type=?, manufacturer=?, system_meta=?, drain_design=?,
                switch_present=?, switch_functioning=?, switch_notes=?, notes=?,
                updated_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(s.system_type, s.manufacturer || '', JSON.stringify(s.system_meta || {}),
           s.drain_design || '', s.switch_present || 'unk', s.switch_functioning || 'unk',
           s.switch_notes || '', s.notes || '', 'Seed data', unit.id);

    (s.equipment || []).forEach(e => {
      db.prepare(`INSERT INTO equipment (unit_id,component,manufacturer,model,serial,install_date,warranty_years,refrigerant)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(unit.id, e.component, e.manufacturer || '', e.model || '', e.serial || '',
             e.install_date || '', e.warranty_years || 0, e.refrigerant || '');
    });

    (s.jobs || []).forEach(j => {
      db.prepare(`INSERT INTO jobs (unit_id,job_date,reported,category,priority,diagnosis,
                  work_performed,parts_used,vendor_cost_avoided,cost_basis,hours,logged_by,error_code)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(unit.id, j.job_date, j.reported || '', 'HVAC', j.priority || 'normal',
             j.diagnosis || '', j.work_performed || '', j.parts_used || '',
             j.vendor_cost_avoided || 0, j.cost_basis || '', j.hours || 0,
             'Seed data', j.error_code || '');
    });
    created++;
  }
  return { created, skipped };
}

if (require.main === module) {
  const r = seed();
  console.log(`Seeded ${r.created} unit(s), skipped ${r.skipped} that already had history.`);
  const total = db.prepare('SELECT COUNT(*) c FROM units').get().c;
  const jobs = db.prepare('SELECT COUNT(*) c FROM jobs').get().c;
  const saved = db.prepare('SELECT COALESCE(SUM(vendor_cost_avoided),0) s FROM jobs').get().s;
  console.log(`Database now has ${total} units, ${jobs} jobs, $${saved} cost avoided.`);
}

module.exports = { seed };
