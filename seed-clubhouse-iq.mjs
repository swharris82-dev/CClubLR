#!/usr/bin/env node
/*
  Seeds Clubhouse IQ with the club's equipment list.

  Creates one entry per piece of equipment, with its building and system type.
  It does NOT fill in model numbers, serials, install dates or service history.
  Those come off the nameplates when you walk the property.

  Run:
    CIQ_EMAIL="you@example.com" CIQ_PASS="yourpassword" node seed-clubhouse-iq.mjs

  Safe to run more than once. Existing entries get updated, not duplicated.
*/

const BASE = process.env.CIQ_URL || 'https://clubhouse-iq.onrender.com';
const EMAIL = process.env.CIQ_EMAIL;
const PASS = process.env.CIQ_PASS;

if (!EMAIL || !PASS) {
  console.error('Set CIQ_EMAIL and CIQ_PASS first. See the comment at the top of this file.');
  process.exit(1);
}

/* name, building, and the kind of system it is (matched loosely against
   whatever system types the server defines) */
const EQUIPMENT = [
  // Central plant: the water loop
  ['BLR-1',            'Central Plant',        'boiler'],
  ['BLR-2',            'Central Plant',        'boiler'],
  ['CT-1',             'Central Plant',        'cooling tower'],
  ['LOOP PUMP P-1',    'Central Plant',        'loop pump'],
  ['LOOP PUMP P-2',    'Central Plant',        'loop pump'],
  ['CHEM FEED',        'Central Plant',        'treatment'],

  // Clubhouse water source heat pumps, one per space
  ['WSHP BALLROOM',    'Clubhouse',            'water source heat pump'],
  ['WSHP MAIN DINING', 'Clubhouse',            'water source heat pump'],
  ['WSHP GRILL',       'Clubhouse',            'water source heat pump'],
  ['WSHP MENS LOCKER', 'Clubhouse',            'water source heat pump'],
  ['WSHP LADIES LOCKER','Clubhouse',           'water source heat pump'],
  ['WSHP ADMIN',       'Clubhouse',            'water source heat pump'],

  // Kitchen
  ['WALK-IN COOLER',   'Clubhouse',            'walk-in'],
  ['WALK-IN FREEZER',  'Clubhouse',            'walk-in'],
  ['ICE MACHINE',      'Clubhouse',            'ice machine'],
  ['KITCHEN MUA-1',    'Clubhouse',            'make-up air'],
  ['HOOD EXHAUST EF-1','Clubhouse',            'exhaust fan'],

  // Outlying buildings
  ['TENNIS RTU-1',     'Indoor Tennis Center', 'rooftop'],
  ['TENNIS RTU-2',     'Indoor Tennis Center', 'rooftop'],
  ['PRO SHOP SPLIT-1', 'Pro Shop',             'split'],
  ['POOL HEATER',      'Pool House',           'pool'],
  ['POOL PUMP',        'Pool House',           'pool'],
];

let TOKEN = null;

async function api(path, opts = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: 'Bad response' }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* Pick the server's closest system type for a plain-English hint.
   Matches on the head noun first, then any significant word, and falls
   back to "Other" rather than guessing wrong. */
function matchType(hint, types) {
  const names = types.map(t => t.name);
  const other = names.find(n => /^other$/i.test(n)) || names.find(n => /other/i.test(n)) || names[0];
  const words = hint.toLowerCase().split(/\s+/).filter(Boolean);
  const shortest = list => list.sort((a, b) => a.length - b.length)[0];

  const full = names.filter(n => n.toLowerCase().includes(hint.toLowerCase()));
  if (full.length) return shortest(full);

  const head = words[words.length - 1];
  const byHead = names.filter(n => n.toLowerCase().includes(head));
  if (byHead.length) return shortest(byHead);

  const byAny = names.filter(n => words.some(w => w.length > 4 && n.toLowerCase().includes(w)));
  if (byAny.length) return shortest(byAny);

  return other;
}

async function main() {
  console.log(`Signing in to ${BASE}`);
  const auth = await api('/login', { method: 'POST', body: { email: EMAIL, password: PASS } });
  TOKEN = auth.token;
  console.log(`Signed in as ${auth.user.name || EMAIL}\n`);

  const { types } = await api('/system-types');
  console.log('System types the app offers:');
  types.forEach(t => console.log('  - ' + t.name));
  console.log('');

  let added = 0, failed = 0;
  for (const [name, building, hint] of EQUIPMENT) {
    const system_type = matchType(hint, types);
    try {
      const existing = await api('/unit/' + encodeURIComponent(name));
      const u = existing.unit;
      await api('/unit/' + encodeURIComponent(name), {
        method: 'PUT',
        body: {
          system_type,
          building,
          manufacturer: u.manufacturer || '',
          system_meta: u.system_meta || {},
          drain_design: u.drain_design || '',
          switch_present: u.switch_present || 'unk',
          switch_functioning: u.switch_functioning || 'unk',
          switch_notes: u.switch_notes || '',
          notes: u.notes || '',
        },
      });
      console.log(`  ok   ${name.padEnd(22)} ${building.padEnd(22)} ${system_type}`);
      added++;
    } catch (e) {
      console.log(`  FAIL ${name.padEnd(22)} ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${added} entries in place, ${failed} failed.`);
  console.log('Next: walk the property and fill in manufacturer, model, serial and install date');
  console.log('from the nameplates, then log the jobs you have actually done.');
}

main().catch(e => {
  console.error('\nStopped: ' + e.message);
  if (/sign|credential|password|invalid/i.test(e.message)) {
    console.error('Check CIQ_EMAIL and CIQ_PASS.');
  }
  process.exit(1);
});
