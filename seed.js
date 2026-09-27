/**
 * Sample data for the Country Club of Little Rock.
 *
 * Buildings come from the club's published amenities (clubhouse and dining
 * rooms, indoor and outdoor tennis, fitness center, pool pavilion, family and
 * teen center, golf). Equipment models, serials, and counts are PLACEHOLDERS
 * to show how the app works. Replace them with the real data plates on the
 * first walk of the plant.
 *
 * Job dates are relative to today so the demo always looks current.
 *
 *   node seed.js
 */

const { db, getOrCreateUnit } = require('./db');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const PLANT = 'Central Plant';
const CLUB = 'Clubhouse';
const TENNIS = 'Indoor Tennis Center';
const FIT = 'Fitness Center';
const POOL = 'Pool Pavilion';
const TEEN = 'Family & Teen Center';
const GOLF = 'Golf Shop';

const SAMPLE = [
  /* ================= CENTRAL PLANT ================= */
  {
    apt: 'BLR-1', building: PLANT,
    system_type: 'Boiler (loop heat)', manufacturer: 'Lochinvar',
    system_meta: { input_mbh: '1,500 MBH natural gas', boiler_style: 'Condensing', setpoint: 'Loop minimum 65 F', lead_lag: 'Lead', lwco_type: 'Probe type, tested monthly', state_cert: 'Verify on certificate posted in plant', last_combustion: 'Verify' },
    drain_design: 'Primary/secondary piping off the heat pump loop. Condensate runs through a neutralizer to the floor drain.',
    switch_present: 'yes', switch_functioning: 'yes',
    switch_notes: 'LWCO probe tested with the boiler firing, shut down correctly.',
    notes: 'SAMPLE DATA. Replace model, serial, and install date from the data plate.',
    equipment: [
      { component: 'Boiler', manufacturer: 'Lochinvar', model: 'Crest (verify)', serial: 'SAMPLE-BLR1', install_date: '2016-10-01', warranty_years: 10 },
      { component: 'Boiler pump', manufacturer: 'Grundfos', model: 'verify', serial: 'SAMPLE-BP1', install_date: '2016-10-01', warranty_years: 1 }
    ],
    jobs: [
      { d: 290, reported: 'Boiler 1 locked out, loop dropping overnight', error_code: 'Flame failure', category: 'Boiler', diagnosis: 'Fouled flame sensor', work_performed: 'Cleaned flame sensor, checked igniter gap, cleaned condensate trap. Relit and verified flame signal.', parts_used: '', vendor_cost_avoided: 650, cost_basis: 'Boiler contractor call-out, 2 hr minimum', hours: 2 }
    ]
  },
  {
    apt: 'BLR-2', building: PLANT,
    system_type: 'Boiler (loop heat)', manufacturer: 'Lochinvar',
    system_meta: { input_mbh: '1,500 MBH natural gas', boiler_style: 'Condensing', lead_lag: 'Lag', lwco_type: 'Probe type', state_cert: 'Verify' },
    switch_present: 'yes', switch_functioning: 'unk',
    switch_notes: 'LWCO not tested yet this season.',
    notes: 'SAMPLE DATA. Lag boiler. Run it on rotation so it is not the one that fails on the first cold night.',
    equipment: [
      { component: 'Boiler', manufacturer: 'Lochinvar', model: 'Crest (verify)', serial: 'SAMPLE-BLR2', install_date: '2016-10-01', warranty_years: 10 }
    ],
    jobs: [
      { d: 320, reported: 'Boiler 2 would not fire on call from lead/lag', error_code: 'Ignition lockout', category: 'Boiler', diagnosis: 'Igniter worn, second repeat on this boiler', work_performed: 'Replaced igniter and gasket. Fired and verified.', parts_used: 'Igniter, gasket', vendor_cost_avoided: 800, cost_basis: 'Contractor call-out plus part markup', hours: 2.5 },
      { d: 250, reported: 'Boiler 2 lockout again', error_code: 'Ignition lockout', category: 'Boiler', diagnosis: 'Condensate trap plugged, backing up into the heat exchanger', work_performed: 'Cleaned trap and neutralizer, flushed drain.', vendor_cost_avoided: 550, cost_basis: 'Contractor call-out', hours: 1.5 }
    ]
  },
  {
    apt: 'CT-1', building: PLANT,
    system_type: 'Cooling tower / fluid cooler', manufacturer: 'BAC (Baltimore Aircoil)',
    system_meta: { tower_type: 'Open tower with plate heat exchanger (verify)', fan_drive: 'Belt drive, VFD (verify HP)', basin_heater: 'Electric basin heater', chem_vendor: 'Verify', last_clean: 'Verify' },
    drain_design: 'Makeup through a mechanical float valve. Bleed controlled by the conductivity controller on WT-1.',
    switch_present: 'yes', switch_functioning: 'no',
    switch_notes: 'Vibration switch found jumpered out. Needs to be replaced and put back in the circuit.',
    notes: 'SAMPLE DATA. Tower fan failure in August took down cooling across the clubhouse. Keep a spare belt on the shelf.',
    equipment: [
      { component: 'Cooling tower', manufacturer: 'BAC', model: 'Series 3000 (verify)', serial: 'SAMPLE-CT1', install_date: '2008-05-01', warranty_years: 1 },
      { component: 'Fan motor', manufacturer: 'Baldor', model: 'verify HP', serial: 'SAMPLE-FM1', install_date: '2008-05-01', warranty_years: 1 },
      { component: 'Fan VFD', manufacturer: 'ABB', model: 'verify', serial: 'SAMPLE-VFD1', install_date: '2019-06-01', warranty_years: 2 }
    ],
    jobs: [
      { d: 40, reported: 'Heat pumps tripping all over the clubhouse, loop at 98 F', category: 'Cooling tower', priority: 'emergency', diagnosis: 'Tower fan belt broken, fan not turning', work_performed: 'Replaced belt set, tensioned and aligned sheaves. Loop back to 85 F within two hours. Reset locked-out heat pumps.', parts_used: 'Belt set', vendor_cost_avoided: 1200, cost_basis: 'After-hours contractor call on a Saturday', hours: 3 },
      { d: 12, reported: 'Tower fan vibrating, loud at high speed', category: 'Cooling tower', diagnosis: 'Fan bearing wearing, vibration switch jumpered so it never tripped', work_performed: 'Greased bearings, tightened set screws. Found vibration switch jumpered. Ordered new bearing and switch.', vendor_cost_avoided: 450, cost_basis: 'Contractor diagnostic call', hours: 1.5 }
    ]
  },
  {
    apt: 'HX-1', building: PLANT,
    system_type: 'Plate heat exchanger', manufacturer: 'Other / Unknown',
    system_meta: { hx_model: 'Verify plate count', design_temps: 'Verify from submittal', last_opened: 'Unknown' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Separates the open tower water from the clean loop.',
    jobs: [
      { d: 35, reported: 'Loop still running warm after tower repair', category: 'Cooling tower', diagnosis: 'HX approach 9 F above design, tower side fouled', work_performed: 'Backflushed tower side. Approach improved 3 F. Recommend opening and cleaning plates this winter.', vendor_cost_avoided: 300, cost_basis: 'Contractor labor', hours: 2 }
    ]
  },
  {
    apt: 'P-1', building: PLANT,
    system_type: 'Loop / condenser pump', manufacturer: 'Bell & Gossett',
    system_meta: { hp_gpm: 'Verify from nameplate', pump_style: 'Base-mounted end suction', lead_lag: 'Lead', vfd: 'Across the line (verify)', seal: 'Verify' },
    drain_design: 'Suction strainer upstream. Isolation valves both sides.',
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Loop pump 1.',
    equipment: [{ component: 'Pump', manufacturer: 'Bell & Gossett', model: 'e-1510 (verify)', serial: 'SAMPLE-P1', install_date: '2008-05-01', warranty_years: 1 }],
    jobs: [
      { d: 150, reported: 'Water on mechanical room floor under loop pump 1', category: 'Plumbing', diagnosis: 'Mechanical seal leaking', work_performed: 'Swapped to P-2, isolated P-1, replaced seal kit.', parts_used: 'Seal kit', vendor_cost_avoided: 950, cost_basis: 'Contractor seal replacement quote', hours: 4 }
    ]
  },
  {
    apt: 'P-2', building: PLANT,
    system_type: 'Loop / condenser pump', manufacturer: 'Bell & Gossett',
    system_meta: { pump_style: 'Base-mounted end suction', lead_lag: 'Standby' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Loop pump 2, standby. Rotate lead monthly.'
  },
  {
    apt: 'P-3', building: PLANT,
    system_type: 'Loop / condenser pump', manufacturer: 'Other / Unknown',
    system_meta: { pump_style: 'Tower condenser water pump (verify)' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Moves tower water through HX-1.'
  },
  {
    apt: 'ET-1', building: PLANT,
    system_type: 'Loop accessory (expansion tank, air separator, makeup)', manufacturer: 'Bell & Gossett',
    system_meta: { fill_psi: 'Verify', tank_type: 'Bladder (verify)', prv: 'Verify' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Expansion tank, air separator, and loop makeup.'
  },
  {
    apt: 'WT-1', building: PLANT,
    system_type: 'Water treatment system', manufacturer: 'Other / Unknown',
    system_meta: { vendor: 'Verify', cond_setpoint: 'Verify', last_test: 'Verify', biocide: 'Verify' },
    drain_design: 'Conductivity controller drives the tower bleed solenoid. Inhibitor and biocide on metering pumps.',
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA.',
    jobs: [
      { d: 20, reported: 'Controller alarm, high conductivity', category: 'Water treatment', diagnosis: 'Bleed solenoid stuck closed', work_performed: 'Cleaned solenoid, verified bleed opens at setpoint. Called treatment vendor for a test.', vendor_cost_avoided: 250, cost_basis: 'Vendor service call', hours: 1 }
    ]
  },
  {
    apt: 'BAS-1', building: PLANT,
    system_type: 'Building controls / BAS', manufacturer: 'Other / Unknown',
    system_meta: { platform: 'Verify', panel: 'Central plant', vendor: 'Verify' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Enter the controls platform and vendor once confirmed.'
  },

  /* ================= CLUBHOUSE ================= */
  {
    apt: 'HP-CH-01', building: CLUB,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: 'Mixed Grill dining', tons: '5 (verify)', access: 'Above ceiling, service panel in corridor', filter_size: 'Verify', last_fault: 'HP lockout' },
    drain_design: 'Gravity condensate to the kitchen drain. Hose kit with strainer and ball valves.',
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Busy dining room, schedule work before lunch service.',
    equipment: [{ component: 'Heat pump', manufacturer: 'ClimateMaster', model: 'verify', serial: 'SAMPLE-CH01', install_date: '2022-01-15', warranty_years: 5, refrigerant: 'R-410A' }],
    jobs: [
      { d: 40, reported: 'Mixed Grill hot, unit not cooling', error_code: 'HP lockout', category: 'HVAC', priority: 'same-day', diagnosis: 'High pressure lockout from hot loop, tower fan down', work_performed: 'Reset after tower repair. Verified entering water 86 F and normal operation.', vendor_cost_avoided: 200, cost_basis: 'Contractor call-out', hours: 0.5 }
    ]
  },
  {
    apt: 'HP-CH-02', building: CLUB,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: "President's Dining Room", access: 'Above ceiling', last_fault: 'Condensate' },
    drain_design: 'Gravity condensate, long flat run above the ceiling. No cleanout.',
    switch_present: 'yes', switch_functioning: 'no',
    switch_notes: 'Condensate switch mounted high in the pan. Pan overflows before it trips.',
    notes: "SAMPLE DATA. Water on the President's Dining Room ceiling is a member-facing problem. Treat water calls here as urgent.",
    jobs: [
      { d: 90, reported: 'Ceiling tile stained in President\'s Dining Room', category: 'HVAC', diagnosis: 'Condensate drain clogged', work_performed: 'Cleared drain, replaced stained tile.', vendor_cost_avoided: 300, cost_basis: 'Contractor drain service', hours: 1.5 },
      { d: 25, reported: 'Water dripping from ceiling during a private event', category: 'HVAC', priority: 'emergency', diagnosis: 'Condensate overflow again, switch mounted too high to trip', work_performed: 'Cleared drain, added cleanout. Switch still needs to be relocated to the low end of the pan.', parts_used: '3/4 PVC, cleanout tee', vendor_cost_avoided: 400, cost_basis: 'After-hours contractor', hours: 2 }
    ]
  },
  {
    apt: 'HP-CH-03', building: CLUB,
    system_type: 'Water-source heat pump', manufacturer: 'Florida Heat Pump (FHP)',
    system_meta: { serves: 'Garden Room', access: 'Closet', last_fault: 'HP lockout' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Older unit. Water coil likely scaled.',
    jobs: [
      { d: 40, reported: 'Garden Room warm', error_code: 'HP lockout', category: 'HVAC', diagnosis: 'High pressure lockout, same day as tower failure', work_performed: 'Reset after tower repair.', vendor_cost_avoided: 150, cost_basis: 'Second unit on same call', hours: 0.25 },
      { d: 8, reported: 'Garden Room warm again in the afternoon', error_code: 'HP lockout', category: 'HVAC', diagnosis: 'High pressure lockout with loop at normal temperature', work_performed: 'Water temperature rise across the coil 16 F, too high. Low flow at the unit. Cleaned hose kit strainer, rise down to 11 F.', vendor_cost_avoided: 300, cost_basis: 'Contractor call-out', hours: 1.5 }
    ]
  },
  {
    apt: 'HP-CH-04', building: CLUB,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: 'Centennial Lounge', access: 'Above ceiling' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA.'
  },
  {
    apt: 'HP-CH-05', building: CLUB,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: 'Administrative offices', access: 'Closet' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA.'
  },
  {
    apt: 'KIT-WIC-1', building: CLUB,
    system_type: 'Walk-in cooler / freezer', manufacturer: 'Heatcraft',
    system_meta: { box: 'Main kitchen walk-in cooler', setpoint: '36 F', condensing: 'Roof (verify)', defrost: 'Off-cycle' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Condenser loads up with kitchen grease. Clean it every quarter.',
    jobs: [
      { d: 60, reported: 'Walk-in at 45 F, kitchen moving product', category: 'Refrigeration', priority: 'emergency', diagnosis: 'Condenser coil plugged with grease and cottonwood', work_performed: 'Cleaned condenser coil, verified box pulled down to 36 F in two hours.', vendor_cost_avoided: 500, cost_basis: 'Refrigeration contractor emergency call', hours: 1.5 }
    ]
  },
  {
    apt: 'KIT-ICE-1', building: CLUB,
    system_type: 'Ice machine', manufacturer: 'Hoshizaki',
    system_meta: { head_bin: 'Verify', cooling: 'Air cooled', filter: 'Verify', last_clean: 'Verify' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Bar and kitchen ice.',
    jobs: [
      { d: 100, reported: 'Ice machine making thin, cloudy ice', category: 'Refrigeration', diagnosis: 'Evaporator scaled, filter overdue', work_performed: 'Descaled and sanitized, replaced water filter.', parts_used: 'Water filter, descaler', vendor_cost_avoided: 275, cost_basis: 'Ice machine service rate', hours: 1.5 }
    ]
  },
  {
    apt: 'DHW-1', building: CLUB,
    system_type: 'Water heater', manufacturer: 'Lochinvar',
    system_meta: { capacity: 'Verify', fuel: 'Natural gas', serves: 'Kitchen and locker rooms' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA.'
  },

  /* ================= INDOOR TENNIS ================= */
  {
    apt: 'RTU-TN-1', building: TENNIS,
    system_type: 'Rooftop / package unit', manufacturer: 'Trane',
    system_meta: { serves: 'Indoor courts', tons: 'Verify', roof_access: 'Roof hatch, verify', econo: 'Verify' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Replace with the actual court heating and cooling equipment once walked.',
    jobs: [
      { d: 30, reported: 'Courts humid and warm during evening clinic', category: 'HVAC', diagnosis: 'Dirty filters, economizer damper stuck open', work_performed: 'Replaced filters, freed and adjusted damper linkage.', parts_used: 'Filters', vendor_cost_avoided: 350, cost_basis: 'Contractor call-out', hours: 2 }
    ]
  },

  /* ================= FITNESS ================= */
  {
    apt: 'HP-FC-01', building: FIT,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: 'Fitness floor', access: 'Above ceiling' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Verify whether the fitness center is on the loop.'
  },

  /* ================= POOL ================= */
  {
    apt: 'POOL-1', building: POOL,
    system_type: 'Pool equipment', manufacturer: 'Pentair',
    system_meta: { pump_hp: 'Verify', filter_type: 'Sand (verify)', heater: 'Verify', chem: 'Verify' },
    switch_present: 'yes', switch_functioning: 'yes',
    notes: 'SAMPLE DATA. Main pool pump and filter.',
    jobs: [
      { d: 70, reported: 'Pool pump losing prime', category: 'Pool', diagnosis: 'Air leak at pump lid O-ring', work_performed: 'Replaced lid O-ring, lubricated, reprimed.', parts_used: 'Lid O-ring', vendor_cost_avoided: 225, cost_basis: 'Pool service call', hours: 0.75 }
    ]
  },
  {
    apt: 'HP-PP-01', building: POOL,
    system_type: 'Split system / air handler', manufacturer: 'Carrier',
    system_meta: { serves: 'Poolside Cafe & Bar' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA.'
  },

  /* ================= FAMILY & TEEN ================= */
  {
    apt: 'HP-FT-01', building: TEEN,
    system_type: 'Water-source heat pump', manufacturer: 'ClimateMaster',
    system_meta: { serves: 'Family and Teen Center' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA. Verify whether this building is on the loop.'
  },

  /* ================= GOLF ================= */
  {
    apt: 'SS-GS-1', building: GOLF,
    system_type: 'Split system / air handler', manufacturer: 'Trane',
    system_meta: { serves: 'Golf shop sales floor' },
    switch_present: 'unk', switch_functioning: 'unk',
    notes: 'SAMPLE DATA.'
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

    db.prepare(`UPDATE units SET building=?, system_type=?, manufacturer=?, system_meta=?, drain_design=?,
                switch_present=?, switch_functioning=?, switch_notes=?, notes=?,
                updated_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(s.building || null, s.system_type, s.manufacturer || '', JSON.stringify(s.system_meta || {}),
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
        .run(unit.id, daysAgo(j.d), j.reported || '', j.category || 'HVAC', j.priority || 'normal',
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
  console.log(`Seeded ${r.created} asset(s), skipped ${r.skipped} that already had history.`);
  const total = db.prepare('SELECT COUNT(*) c FROM units').get().c;
  const jobs = db.prepare('SELECT COUNT(*) c FROM jobs').get().c;
  const saved = db.prepare('SELECT COALESCE(SUM(vendor_cost_avoided),0) s FROM jobs').get().s;
  console.log(`Database now has ${total} assets, ${jobs} jobs, $${saved} cost avoided.`);
}

module.exports = { seed };
