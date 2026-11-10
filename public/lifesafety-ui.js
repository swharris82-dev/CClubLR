/* Clubhouse IQ: Life safety tab (see lifesafety.js on the server).
   The monthly fire and life safety walk: extinguishers, emergency lights,
   exit signs, fire doors, exit doors, pull stations, alarm panel, sprinkler
   valves, hood suppression, AEDs, eyewash, plus a general walk of each area.
   Loaded after the main page script and shares its globals
   ($, api, esc, ME, sheet, closeSheet, toast, canWork, sel, inp, F, val, showErr, openHtml). */

let LS = null, LSVIEW = 'walk', LSKIND = '', LSQ = '';
const LSNAV = [['walk', 'Walk'], ['areas', 'Areas'], ['service', 'Service due'], ['missing', 'Missing'], ['print', 'Paper sheet']];
const LSMON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
try { QUEUEABLE.push(/^\/ls\/checks$/); } catch (e) {}

const lsKind = k => (LS && LS.kinds.find(x => x.key === k)) || { label: k, checks: [], prefix: 'X' };
const lsYm = s => { if (!s) return '—'; const [y, m] = String(s).split('-'); return m ? m + '/' + y : y; };
const lsWhere = d => [d.area, d.location].filter(Boolean).join(' · ');

async function loadSafety() {
  const b = $('safetyBody');
  if (!LS) b.innerHTML = '<div class="panel"><span class="spin"></span><span class="dim">Loading the walk</span></div>';
  try { LS = await api('/ls'); drawSafety(); }
  catch (e) { b.innerHTML = '<div class="panel"><div class="note n-safe"><b>Failed</b>' + esc(e.message) + '</div></div>'; }
}

function drawSafety() {
  const s = LS.summary, monthName = new Date(LS.month + '-15T12:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  let h = '<div class="panel"><div class="eyebrow">Monthly life safety walk · ' + esc(monthName) + '</div><div class="stats">' +
    '<div class="stat"><div class="n">' + s.done + '/' + s.devices + '</div><div class="l">checked</div></div>' +
    '<div class="stat"><div class="n" style="color:' + (s.attention ? 'var(--rose)' : 'var(--text)') + '">' + s.attention + '</div><div class="l">failed</div></div>' +
    '<div class="stat"><div class="n" style="color:' + (s.service ? 'var(--sulfur)' : 'var(--text)') + '">' + s.service + '</div><div class="l">service due</div></div>' +
    '<div class="stat"><div class="n" style="color:' + (s.gaps ? 'var(--rose)' : 'var(--text)') + '">' + s.gaps + '</div><div class="l">missing</div></div></div>' +
    '<div class="dim" style="margin-top:8px;font-size:12px">Areas walked this month: ' + s.areas_done + ' of ' + s.areas + '. A failed item opens a work order.</div></div>';
  h += '<div class="filters" id="lsNav">' + LSNAV.map(([k, l]) => '<div data-v="' + k + '" class="' + (LSVIEW === k ? 'on' : '') + '">' + l + '</div>').join('') + '</div><div id="lsBody"></div>';
  $('safetyBody').innerHTML = h;
  $('lsNav').querySelectorAll('div').forEach(d => d.onclick = () => { LSVIEW = d.dataset.v; drawSafety(); });
  ({ walk: lsWalk, areas: lsAreas, service: lsService, missing: lsMissing, print: lsPrint })[LSVIEW]();
}

/* ================= Walk: devices by area ================= */
function lsCard(d) {
  const tags = [];
  tags.push(d.done ? '<span class="tag s-done">Checked</span>' : '<span class="tag">Due</span>');
  if (d.attention) tags.push('<span class="tag late">Failed: ' + esc((d.last.failed || []).map(k => (lsKind(d.kind).checks.find(c => c[0] === k) || [k, k, k])[2]).join(', ')) + '</span>');
  if (d.open_wo) tags.push('<span class="tag s-open">WO #' + d.open_wo + '</span>');
  if (d.svc_state === 'late') tags.push('<span class="tag late">' + esc(d.svc_label) + ' overdue</span>');
  else if (d.svc_state === 'soon') tags.push('<span class="tag p-high">' + esc(d.svc_label) + ' ' + esc(lsYm(d.svc_due)) + '</span>');
  const yr = LS.month.slice(0, 4);
  if (d.hydro_due && d.hydro_due <= yr) tags.push('<span class="tag p-high">Hydro due ' + esc(d.hydro_due) + '</span>');
  if (d.six_due && d.six_due <= yr) tags.push('<span class="tag p-high">6-year due ' + esc(d.six_due) + '</span>');
  const nowM = +LS.month.slice(5, 7);
  const punch = '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:2px;max-width:300px;margin-top:6px">' +
    LSMON.map((m, i) => { const p = d.punches[i + 1]; const bg = p === 'ok' ? 'var(--mint)' : p === 'fail' ? 'var(--rose)' : 'transparent';
      return '<span style="font-family:var(--mono);font-size:9px;text-align:center;border:' + (i + 1 === nowM ? '2px solid var(--ice)' : '1px solid var(--edge)') + ';border-radius:2px;background:' + bg + ';color:' + (p ? '#fff' : 'var(--dim)') + '">' + m + '</span>'; }).join('') + '</div>';
  return '<div class="woc ' + (d.attention ? 'pr-emergency' : d.done ? 'pr-low' : 'pr-normal') + '" onclick="lsCheck(' + d.id + ')">' +
    '<div class="t"><span style="font-family:var(--mono)">' + esc(d.tag) + '</span> · ' + esc(d.kind_label) + '</div>' +
    '<div class="m">' + esc(lsWhere(d)) + (d.kind === 'extinguisher' && d.info.type ? ' · ' + esc(d.info.type) : '') + '</div>' + punch +
    '<div class="r">' + tags.join('') + '</div></div>';
}
function lsWalk() {
  const kinds = LS.kinds.filter(k => LS.devices.some(d => d.kind === k.key));
  let h = '<div class="filters" id="lsKinds"><div data-k="" class="' + (LSKIND ? '' : 'on') + '">All <b>' + LS.devices.length + '</b></div>' +
    kinds.map(k => '<div data-k="' + k.key + '" class="' + (LSKIND === k.key ? 'on' : '') + '">' + esc(k.label) + ' <b>' + LS.devices.filter(d => d.kind === k.key).length + '</b></div>').join('') + '</div>';
  h += '<input id="lsQ" placeholder="Search tag, room, or area" value="' + esc(LSQ) + '" style="margin-bottom:10px">';
  if (canWork()) h += '<div class="row" style="margin-bottom:12px"><button class="btn" onclick="lsDeviceForm()">+ Add device</button><button class="btn-2" onclick="lsGapForm()">Flag a missing device</button></div>';
  const q = LSQ.toLowerCase();
  const list = LS.devices.filter(d => (!LSKIND || d.kind === LSKIND) && (!q || (d.tag + ' ' + d.building + ' ' + d.area + ' ' + d.location).toLowerCase().includes(q)));
  if (!LS.devices.length) h += '<div class="empty"><div class="big">Nothing on the walk yet</div>Add each extinguisher, emergency light, and exit sign as you find it.</div>';
  else if (!list.length) h += '<div class="empty">Nothing matches.</div>';
  let last = null;
  list.forEach(d => { const a = (d.building || '') + ' · ' + (d.area || ''); if (a !== last) { h += '<div class="bldg" style="margin:14px 0 8px">' + esc(a) + '</div>'; last = a; } h += lsCard(d); });
  $('lsBody').innerHTML = h;
  $('lsKinds').querySelectorAll('div').forEach(x => x.onclick = () => { LSKIND = x.dataset.k; lsWalk(); });
  const qi = $('lsQ'); qi.oninput = () => { LSQ = qi.value; const pos = qi.selectionStart; lsWalk(); const n = $('lsQ'); n.focus(); n.setSelectionRange(pos, pos); };
}

/* ----- monthly check on one device ----- */
let LSPICK = {};
function lsPickRow(key, text) {
  return '<div class="ck-row" style="display:flex;align-items:center;gap:10px"><span style="flex:1;min-width:0">' + esc(text) + '</span>' +
    '<div class="seg" style="display:flex;gap:4px;flex-shrink:0" data-k="' + key + '"><div data-v="y" style="padding:7px 12px">OK</div><div data-v="n" style="padding:7px 12px">Fail</div></div></div>';
}
function lsWirePicks() {
  document.querySelectorAll('.sheet .seg[data-k]').forEach(sg => sg.querySelectorAll('div').forEach(o => o.onclick = () => {
    LSPICK[sg.dataset.k] = o.dataset.v === 'y';
    sg.querySelectorAll('div').forEach(x => x.className = x === o ? o.dataset.v : '');
  }));
}
function lsAllOk(keys) { keys.forEach(k => LSPICK[k] = true); document.querySelectorAll('.sheet .seg[data-k]').forEach(sg => sg.querySelectorAll('div').forEach(x => x.className = x.dataset.v === 'y' ? 'y' : '')); }

function lsCheck(id) {
  const d = LS.devices.find(x => x.id === id); if (!d) return;
  const k = lsKind(d.kind); LSPICK = {};
  const i = d.info || {};
  const facts = [['Type', i.type], ['Size', i.size ? i.size + ' lb' : ''], ['Make', i.mfr], ['Serial', i.serial], ['Mfg year', i.mfg_year],
    [d.svc_label || 'Last service', i.last_annual ? lsYm(i.last_annual) + (d.svc_due ? ', next ' + lsYm(d.svc_due) : '') : ''],
    ['Hydro due', d.hydro_due], ['6-year due', d.six_due], ['Battery', i.battery_date], ['Pads', i.pads_date], ['Vendor', i.vendor]].filter(x => x[1]);
  let b = '<div class="mid" style="font-size:13px">' + esc(lsWhere(d)) + '</div>' +
    (facts.length ? '<table style="margin-top:8px">' + facts.map(f => '<tr><td>' + esc(f[0]) + '</td><td><b>' + esc(f[1]) + '</b></td></tr>').join('') + '</table>' : '') +
    (d.notes ? '<div class="note n-hist" style="margin-top:10px">' + esc(d.notes) + '</div>' : '');
  if (canWork()) {
    b += '<div class="eyebrow" style="margin-top:16px">Monthly check</div>' + k.checks.map(c => lsPickRow(c[0], c[1])).join('') +
      (d.kind === 'sprinkler' ? F('Gauge reading (psi)', inp('lsRd', '', 'e.g. 65', 'text', ' inputmode="decimal"')) : '') +
      (d.kind === 'aed' ? F('Pads expire', inp('lsRd', '', 'MM/YYYY')) : '') +
      row2(F('Date', inp('lsDate', LS.today, '', 'date')), '') +
      F('What was wrong / what you did', '<textarea id="lsNote" rows="2" placeholder="Required if anything fails"></textarea>') +
      '<div class="row" style="margin-top:12px"><button class="btn-2" id="lsOk">All OK</button><button class="btn" id="lsSave">Save check</button></div>' + errBox('lsMsg');
  }
  b += '<div class="eyebrow" style="margin-top:18px">History</div>' + (d.history.length ? d.history.map(c =>
    '<div class="att" style="cursor:default"><span class="lv" style="background:' + (c.pass ? 'var(--mint)' : 'var(--rose)') + '"></span><div style="flex:1;min-width:0"><div class="t">' + esc(fmtDate(c.done_on)) + ' · ' + (c.pass ? 'Pass' : 'Fail: ' + esc(c.failed.map(f => (k.checks.find(x => x[0] === f) || [f, f, f])[2]).join(', '))) + '</div>' +
    '<div class="m">' + esc(c.by) + (c.reading ? ' · ' + esc(c.reading) : '') + (c.wo_id ? ' · WO #' + c.wo_id : '') + (c.note ? ' · ' + esc(c.note) : '') + '</div></div></div>').join('') : '<div class="dim">No checks yet.</div>');
  if (canWork()) b += '<button class="btn-2 full" style="margin-top:14px" onclick="lsDeviceForm(' + d.id + ')">Edit details</button>';
  sheet(d.tag + ' · ' + k.label, 'Life safety', b);
  if (!canWork()) return;
  lsWirePicks();
  $('lsOk').onclick = () => lsAllOk(k.checks.map(c => c[0]));
  $('lsSave').onclick = async () => {
    const miss = k.checks.filter(c => !(c[0] in LSPICK));
    if (miss.length) return showErr('lsMsg', new Error('Mark every line OK or Fail. ' + miss.length + ' left.'));
    const failed = k.checks.filter(c => LSPICK[c[0]] === false).map(c => c[0]);
    try {
      const r = await api('/ls/checks', { method: 'POST', body: { device_id: d.id, failed, note: val('lsNote'), date: val('lsDate'), reading: $('lsRd') ? val('lsRd') : '' } });
      LS = r.state; closeSheet(); drawSafety();
      toast(r.ok ? d.tag + ' passed' : d.tag + ' failed. Work order #' + r.wo_id);
      if (!r.ok) try { refreshAlerts(); } catch (e) {}
    } catch (e) { showErr('lsMsg', e); }
  };
}

/* ----- add / edit a device ----- */
function lsNextTag(kind) {
  const p = lsKind(kind).prefix; let max = 0;
  LS.devices.forEach(d => { const m = d.tag.match(new RegExp('^' + p + '-(\\d+)$')); if (m) max = Math.max(max, +m[1]); });
  return p + '-' + String(max + 1).padStart(3, '0');
}
function lsDeviceForm(id) {
  const d = id ? LS.devices.find(x => x.id === id) : null, e = d || { kind: LSKIND || 'extinguisher', info: {} };
  const last = LS.devices[LS.devices.length - 1] || {};
  const bl = [...new Set(LS.devices.map(x => x.building).filter(Boolean))], al = [...new Set(LS.devices.map(x => x.area).filter(Boolean))];
  const i = e.info || {};
  const b = F('What is it', sel('lsK', LS.kinds.map(k => [k.key, k.label]), e.kind)) +
    row2(F('Tag', inp('lsT', d ? d.tag : lsNextTag(e.kind), '', 'text', ' style="font-family:var(--mono);text-transform:uppercase"')), F('Building', inp('lsB', d ? d.building : (last.building || 'Clubhouse'), '', 'text', ' list="lsBl"'))) +
    F('Floor or area', inp('lsA', d ? d.area : (last.area || ''), 'Lower level, Second floor, Kitchen', 'text', ' list="lsAl"')) +
    F('Exact spot', inp('lsL', e.location, 'Outside the elevator, left of the door')) +
    '<datalist id="lsBl">' + bl.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist><datalist id="lsAl">' + al.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
    '<div id="lsExtra"></div>' +
    F('Notes', '<textarea id="lsN" rows="2">' + esc(e.notes || '') + '</textarea>') +
    '<div class="row" style="margin-top:12px">' + (d ? '<button class="btn-2" style="color:var(--rose)" id="lsDel">Remove</button>' : '') + '<button class="btn" id="lsSv">Save</button></div>' + errBox('lsMsg');
  sheet(d ? 'Edit ' + d.tag : 'Add to the walk', 'Life safety', b);
  const extra = () => {
    const k = $('lsK').value;
    let h = '';
    if (k === 'extinguisher') h = row2(F('Type', sel('lsI_type', ['ABC', 'BC', 'CO2', 'Clean agent (Halotron)', 'Class K (wet chemical)', 'Water'], i.type || 'ABC')), F('Size (lb)', inp('lsI_size', i.size, '10', 'text', ' inputmode="decimal"'))) +
      row2(F('Make', inp('lsI_mfr', i.mfr, 'Amerex')), F('Serial', inp('lsI_serial', i.serial))) +
      row2(F('Mfg year', inp('lsI_mfg_year', i.mfg_year, '2019', 'text', ' inputmode="numeric"')), F('Last annual (month)', inp('lsI_last_annual', i.last_annual, '', 'month'))) +
      row2(F('Last hydro (year)', inp('lsI_last_hydro', i.last_hydro, '', 'text', ' inputmode="numeric"')), F('Last 6-year (year)', inp('lsI_last_six', i.last_six, '', 'text', ' inputmode="numeric"'))) +
      F('Service company on the tag', inp('lsI_vendor', i.vendor));
    else if (['emlight', 'exit', 'combo'].includes(k)) h = row2(F('Make', inp('lsI_mfr', i.mfr)), F('Last 90-min test (month)', inp('lsI_last_annual', i.last_annual, '', 'month'))) + F('Battery date', inp('lsI_battery_date', i.battery_date, 'MM/YYYY'));
    else if (k === 'aed') h = row2(F('Make / model', inp('lsI_mfr', i.mfr)), F('Pads expire', inp('lsI_pads_date', i.pads_date, 'MM/YYYY'))) + F('Battery expires', inp('lsI_battery_date', i.battery_date, 'MM/YYYY'));
    else if (lsKind(k).svc) h = row2(F('Make', inp('lsI_mfr', i.mfr)), F(lsKind(k).svcLabel + ' last done', inp('lsI_last_annual', i.last_annual, '', 'month'))) + F('Vendor', inp('lsI_vendor', i.vendor));
    $('lsExtra').innerHTML = h;
  };
  extra();
  $('lsK').onchange = () => { if (!d) $('lsT').value = lsNextTag($('lsK').value); extra(); };
  $('lsSv').onclick = async () => {
    const info = {}; document.querySelectorAll('[id^="lsI_"]').forEach(x => { if (x.value.trim()) info[x.id.slice(4)] = x.value.trim(); });
    try {
      LS = await api('/ls/devices', { method: 'POST', body: { id: d ? d.id : null, kind: val('lsK'), tag: val('lsT'), building: val('lsB'), area: val('lsA'), location: val('lsL'), info, notes: val('lsN') } });
      closeSheet(); drawSafety(); toast('Saved ' + val('lsT').toUpperCase());
    } catch (err) { showErr('lsMsg', err); }
  };
  if (d) $('lsDel').onclick = async () => {
    const btn = $('lsDel'); if (!btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Tap again to remove ' + d.tag; return; }
    try { LS = await api('/ls/devices/' + d.id, { method: 'DELETE' }); closeSheet(); drawSafety(); toast('Removed ' + d.tag); } catch (err) { showErr('lsMsg', err); }
  };
}

/* ================= Areas: general walk-through ================= */
function lsAreas() {
  let h = '<div class="panel"><div class="eyebrow">Walk each area once a month</div><div class="mid" style="font-size:13px">Exits, stairs, sprinkler clearance, electrical panels, cords, housekeeping, evacuation maps.</div></div>';
  if (!LS.areas.length) h += '<div class="empty">Areas show up here once devices are on the walk.</div>';
  LS.areas.forEach((a, n) => {
    const c = a.check;
    h += '<div class="woc ' + (c ? (c.pass ? 'pr-low' : 'pr-emergency') : 'pr-normal') + '" onclick="lsAreaCheck(' + n + ')"><div class="t">' + esc((a.building || '') + ' · ' + (a.area || '')) + '</div>' +
      '<div class="m">' + a.devices + ' device' + (a.devices === 1 ? '' : 's') + '</div><div class="r">' +
      (c ? (c.pass ? '<span class="tag s-done">Walked ' + esc(fmtDate(c.done_on)) + '</span>' : '<span class="tag late">Failed: ' + esc(c.failed.map(f => (LS.area_checks.find(x => x[0] === f) || [f, f, f])[2]).join(', ')) + '</span>' + (c.wo_id ? '<span class="tag s-open">WO #' + c.wo_id + '</span>' : '')) : '<span class="tag">Due</span>') + '</div></div>';
  });
  $('lsBody').innerHTML = h;
}
function lsAreaCheck(n) {
  const a = LS.areas[n]; if (!a) return; LSPICK = {};
  if (!canWork()) return;
  const b = LS.area_checks.map(c => lsPickRow(c[0], c[1])).join('') + row2(F('Date', inp('lsDate', LS.today, '', 'date')), '') +
    F('What was wrong / what you did', '<textarea id="lsNote" rows="2" placeholder="Required if anything fails"></textarea>') +
    '<div class="row" style="margin-top:12px"><button class="btn-2" id="lsOk">All OK</button><button class="btn" id="lsSave">Save walk</button></div>' + errBox('lsMsg');
  sheet((a.building || '') + ' · ' + (a.area || ''), 'Area walk-through', b);
  lsWirePicks();
  $('lsOk').onclick = () => lsAllOk(LS.area_checks.map(c => c[0]));
  $('lsSave').onclick = async () => {
    const miss = LS.area_checks.filter(c => !(c[0] in LSPICK));
    if (miss.length) return showErr('lsMsg', new Error('Mark every line OK or Fail. ' + miss.length + ' left.'));
    const failed = LS.area_checks.filter(c => LSPICK[c[0]] === false).map(c => c[0]);
    try {
      const r = await api('/ls/checks', { method: 'POST', body: { building: a.building, area: a.area, failed, note: val('lsNote'), date: val('lsDate') } });
      LS = r.state; closeSheet(); drawSafety(); toast(r.ok ? 'Area walked' : 'Logged. Work order #' + r.wo_id);
    } catch (e) { showErr('lsMsg', e); }
  };
}

/* ================= Service due ================= */
function lsService() {
  const yr = LS.month.slice(0, 4), rows = [];
  LS.devices.forEach(d => {
    if (d.svc_state === 'late' || d.svc_state === 'soon' || d.svc_state === 'unknown') rows.push({ d, what: d.svc_label, when: d.svc_state === 'unknown' ? 'No date on file' : lsYm(d.svc_due), late: d.svc_state === 'late', unk: d.svc_state === 'unknown' });
    if (d.hydro_due && d.hydro_due <= yr) rows.push({ d, what: 'Hydrostatic test', when: d.hydro_due, late: d.hydro_due < yr });
    if (d.six_due && d.six_due <= yr) rows.push({ d, what: '6-year maintenance', when: d.six_due, late: d.six_due < yr });
  });
  const known = rows.filter(r => !r.unk), unk = rows.filter(r => r.unk);
  let h = '<div class="panel"><div class="eyebrow">Vendor and annual service</div><div class="mid" style="font-size:13px">Overdue and due in the next 60 days. Hand this list to the extinguisher and alarm vendors.</div></div>';
  const row = r => '<div class="att" onclick="lsCheck(' + r.d.id + ')"><span class="lv" style="background:' + (r.late ? 'var(--rose)' : r.unk ? 'var(--dim)' : 'var(--sulfur)') + '"></span><div style="flex:1;min-width:0"><div class="t">' + esc(r.d.tag) + ' · ' + esc(r.what) + '</div><div class="m">' + esc(r.when) + ' · ' + esc(lsWhere(r.d)) + '</div></div></div>';
  h += '<div class="panel">' + (known.length ? known.map(row).join('') : '<div class="dim">Nothing due with a date on file.</div>') + '</div>';
  if (unk.length) h += '<div class="panel"><div class="eyebrow">No service date on file · ' + unk.length + '</div><div class="dim" style="font-size:12px;margin-bottom:6px">Read the date off the tag and add it, or have the vendor service and tag these.</div>' + unk.map(row).join('') + '</div>';
  $('lsBody').innerHTML = h;
}

/* ================= Missing ================= */
function lsMissing() {
  let h = '<div class="panel"><div class="eyebrow">Rooms that need a device</div>' + (LS.gaps.length ? LS.gaps.map(g =>
    '<div class="att" style="cursor:default"><span class="lv" style="background:var(--rose)"></span><div style="flex:1;min-width:0"><div class="t">' + esc([g.area, g.location].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="m">' + esc([g.building, g.recommend ? 'Needs ' + g.recommend : lsKind(g.kind).label, g.note].filter(Boolean).join(' · ')) + '</div></div>' +
    (canWork() ? '<button class="btn-2" style="padding:6px 10px;font-size:12px" onclick="lsResolve(' + g.id + ',this)">Installed</button>' : '') + '</div>').join('') : '<div class="dim">Nothing flagged.</div>') +
    (canWork() ? '<button class="btn-2 full" style="margin-top:10px" onclick="lsGapForm()">+ Flag a missing device</button>' : '') + '</div>';
  $('lsBody').innerHTML = h;
}
async function lsResolve(id, btn) {
  if (!btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Confirm'; return; }
  try { LS = await api('/ls/gaps/' + id + '/resolve', { method: 'POST' }); drawSafety(); toast('Cleared. Add the new device to the walk.'); } catch (e) { alert(e.message); }
}
function lsGapForm() {
  const last = LS.devices[LS.devices.length - 1] || {};
  sheet('Flag a missing device', 'Life safety',
    F('What is missing', sel('lsGK', LS.kinds.map(k => [k.key, k.label]), 'extinguisher')) +
    row2(F('Building', inp('lsGB', last.building || 'Clubhouse')), F('Floor or area', inp('lsGA', last.area || ''))) +
    F('Room or spot', inp('lsGL', '', 'Server room')) + F('Recommended', inp('lsGR', '', 'ABC, clean agent, Class K...')) +
    F('Notes', '<textarea id="lsGN" rows="2"></textarea>') + '<button class="btn full" style="margin-top:12px" id="lsGS">Save</button>' + errBox('lsMsg'));
  $('lsGS').onclick = async () => {
    try { LS = await api('/ls/gaps', { method: 'POST', body: { kind: val('lsGK'), building: val('lsGB'), area: val('lsGA'), location: val('lsGL'), recommend: val('lsGR'), note: val('lsGN') } });
      closeSheet(); LSVIEW = 'missing'; drawSafety(); toast('Flagged'); } catch (e) { showErr('lsMsg', e); }
  };
}

/* ================= Paper sheet ================= */
function lsPrint() {
  $('lsBody').innerHTML = '<div class="panel"><div class="eyebrow">Paper route sheet</div><div class="mid" style="font-size:13px">Every device on the walk with its own check boxes, grouped by area, plus the area walk-through and the missing list. Print it, carry it on a clipboard, then enter the results here.</div>' +
    F('Blank rows for new extinguishers', sel('lsBlank', [[0, 'None'], [6, '6'], [12, '12'], [20, '20']], 6)) +
    '<label class="ck-row" style="border:0;padding-top:10px"><input type="checkbox" id="lsAll"><span>Add blank tables for every kind of device (emergency lights, exit signs, doors...) even if none are on file yet. Use this for the first full walk.</span></label>' +
    '<div class="acts" style="margin-top:12px"><button class="btn" onclick="openHtml(\'/ls/sheet?blank=\'+val(\'lsBlank\')+(val(\'lsAll\')?\'&all=1\':\'\'))">Open sheet</button></div>' +
    '<div class="dim" style="margin-top:8px;font-size:12px">On the phone, open it and use Share, then Print, to save a PDF.</div></div>';
}
