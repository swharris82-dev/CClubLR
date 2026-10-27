/* Clubhouse IQ: preventive maintenance screens (see pm2.js on the server).
   Loaded after the main page script. It replaces the PM schedule pane with five
   views (Schedule, Rounds, Parts, Scorecard, Club hours), adds readings and
   parts kits to the close-out form, adds a readings and hour meter panel to
   equipment records, and opens the right PM when a QR tag is scanned.
   Overrides are assignments (window.x = ...) so they win over the page's own
   function declarations. */

let PMVIEW = 'schedule', PMDAYS = 7, KITDAYS = 30, SCDAYS = 90, PM_TODAY = today();
const PMNAV = [['schedule', 'Schedule'], ['rounds', 'Rounds'], ['parts', 'Parts'], ['score', 'Scorecard'], ['hours', 'Club hours']];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const rngText = s => s.lo != null && s.hi != null ? s.lo + '–' + s.hi : s.hi != null ? 'max ' + s.hi : s.lo != null ? 'min ' + s.lo : '';
const inRng = (s, v) => !((s.lo != null && v < s.lo) || (s.hi != null && v > s.hi));
const pmErr = (el, e) => { const b = $(el); if (b) b.innerHTML = '<div class="note n-safe"><b>Failed</b>' + esc(e.message || e) + '</div>'; };
try { QUEUEABLE.push(/^\/unit\/[^/]+\/runtime$/); } catch (e) {}

/* ================= PM pane shell ================= */
window.loadPm = async function () {
  syncWorkNav();
  const pane = $('pmPane');
  pane.innerHTML = '<div class="filters" id="pmNav">' + PMNAV.map(([k, l]) => '<div data-v="' + k + '" class="' + (PMVIEW === k ? 'on' : '') + '">' + l + '</div>').join('') + '</div><div id="pmBody"></div>';
  $('pmNav').querySelectorAll('div').forEach(d => d.onclick = () => { PMVIEW = d.dataset.v; loadPm(); });
  $('pmBody').innerHTML = '<div class="panel"><span class="spin"></span><span class="dim">Loading</span></div>';
  try {
    if (PMVIEW === 'rounds') return await drawRounds();
    if (PMVIEW === 'parts') return await drawKits();
    if (PMVIEW === 'score') return await drawScore();
    if (PMVIEW === 'hours') return await drawHours();
    const d = await api('/pm'); PMS = d.pms; PM_TODAY = d.today; drawPm(d.today);
  } catch (e) { pmErr('pmBody', e); }
};
function goPm(view) { PMVIEW = view; WORKVIEW = 'pm'; if (TAB !== 'work') showTab('work'); else loadPm(); }

/* ================= Schedule ================= */
window.drawPm = function (t) {
  const body = $('pmBody') || $('pmPane');
  const in14 = (() => { const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 14); return d.toISOString().slice(0, 10); })();
  const late = PMS.filter(p => p.next_due < t), soon = PMS.filter(p => p.next_due >= t && p.next_due <= in14), later = PMS.filter(p => p.next_due > in14);
  const rd = PMS.reduce((s, p) => s + (p.reading_count ? 1 : 0), 0);
  let h = '<div class="panel"><div class="stats">' +
    '<div class="stat"><div class="n">' + PMS.length + '</div><div class="l">PM tasks</div></div>' +
    '<div class="stat"><div class="n" style="color:' + (late.length ? 'var(--rose)' : 'var(--text)') + '">' + late.length + '</div><div class="l">overdue</div></div>' +
    '<div class="stat"><div class="n">' + soon.length + '</div><div class="l">next 14 days</div></div></div>' +
    (canWork() ? '<div class="row" style="margin-top:12px;"><button class="btn" onclick="newPmForm()">+ PM task</button>' +
      '<button class="btn-2" onclick="starterPlan()">Load standard plan</button></div>' +
      '<div class="dim" style="margin-top:8px;font-size:12px;">Standard plan adds the usual PM for every piece of equipment on file, with readings to log. Skips anything already scheduled. ' + rd + ' of ' + PMS.length + ' tasks take readings.</div>' : '') +
    '<div id="pmNewBox"></div></div>';
  if (!PMS.length) h += '<div class="empty"><div class="big">No PM scheduled</div>Load the standard plan or add tasks one at a time.</div>';
  const sec = (title, list) => list.length ? '<div class="bldg" style="margin:14px 0 8px">' + title + ' · ' + list.length + '</div>' + list.map(p => pmRow(p, t)).join('') : '';
  h += sec('Overdue', late) + sec('Next 14 days', soon) + sec('Later', later);
  body.innerHTML = h;
};

function pmTags(p) {
  const tags = [];
  if (p.trigger_type === 'seasonal' && p.season) tags.push('<span class="tag">Yearly · ' + esc(p.season_label) + '</span>');
  if (p.trigger_type === 'runtime') {
    const r = p.runtime || {};
    tags.push('<span class="tag">' + (r.used != null ? esc(r.used + ' / ' + p.run_hours + ' run hrs') : esc(p.run_hours + ' run hrs')) + '</span>');
  }
  if (p.reading_count) tags.push('<span class="tag" style="color:var(--ice)">' + p.reading_count + ' reading' + (p.reading_count > 1 ? 's' : '') + '</span>');
  if (p.needs_shutdown) tags.push('<span class="tag" style="color:var(--ember)">Shutdown</span>');
  if ((p.kit_items || []).length) tags.push('<span class="tag" style="color:var(--mint)">Kit</span>');
  const ev = evTag(p.next_due, p.bldg);
  if (ev) tags.push(ev);
  return tags.length ? '<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">' + tags.join('') + '</div>' : '';
}
window.pmRow = function (p, t) {
  const d = p.next_due.split('-');
  const how = p.trigger_type === 'seasonal' && p.season ? 'every year' : p.trigger_type === 'runtime' ? 'by run hours, at most every ' + freqLabel(p.freq_days) : 'every ' + freqLabel(p.freq_days);
  return '<div class="pm' + (p.next_due < t ? ' late' : '') + '"><div class="dd"><div class="d">' + (+d[2]) + '</div><div class="mo">' + MON[+d[1] - 1] + '</div></div>' +
    '<div class="bd"><div class="t">' + esc(p.title) + '</div><div class="m">' + (p.apt ? esc(p.apt) + ' · ' : '') + esc(p.bldg || '') + ' · ' + esc(how) +
    (p.last_done ? ' · last ' + esc(fmtDate(p.last_done)) : '') + '</div>' + pmTags(p) + '</div>' +
    '<div class="go">' + (p.open_wo ? '<button class="btn" onclick="openWo(' + p.open_wo + ')">Open</button>' : (canWork() ? '<button class="btn-2" onclick="editPm(' + p.id + ')">Edit</button>' : '')) + '</div></div>';
};

/* ----- PM edit form: trigger, shutdown, kit ----- */
let PMKIT = [];
window.newPmForm = function (apt, pm) {
  WORKVIEW = 'pm'; PMVIEW = 'schedule';
  if (TAB !== 'work') showTab('work'); else if (!$('pmNewBox')) loadPm();
  const go = () => {
    const box = $('pmNewBox'); if (!box) { setTimeout(go, 150); return; }
    const e = pm || {}, f = e.freq_days || 30, tt = e.trigger_type || 'calendar';
    const sm = e.season ? +e.season.slice(0, 2) : 3, sd = e.season ? +e.season.slice(3) : 15;
    PMKIT = (e.kit_items || []).map(k => ({ part_id: k.part_id, qty: k.qty, name: k.name, uom: k.uom }));
    box.innerHTML = '<div style="margin-top:14px;border-top:1px solid var(--edge);padding-top:12px;"><div class="eyebrow">' + (pm ? 'Edit PM task' : 'New PM task') + '</div>' +
      '<label class="fl" style="margin-top:0;">Task</label><input id="pmT" maxlength="160" value="' + esc(e.title || '') + '" placeholder="AHU semiannual PM">' +
      (pm ? '' : '<div class="row"><div><label class="fl">Equipment tag</label><input id="pmA" list="tagList" value="' + esc(apt || '') + '" placeholder="Optional" style="font-family:var(--mono);text-transform:uppercase"></div>' +
        '<div><label class="fl">Building</label><input id="pmB" list="woBldgList" placeholder="If no tag"></div></div>') +
      '<label class="fl">When it comes due</label>' + sel('pmTT', [['calendar', 'Every so many days'], ['seasonal', 'Same date every year'], ['runtime', 'By run hours on the meter']], tt) +
      '<div id="pmTrig"></div>' +
      '<label class="ck-row" style="border:0;padding-top:12px"><input type="checkbox" id="pmSD"' + (e.needs_shutdown ? ' checked' : '') + '><span>Needs the unit shut down. Keeps it off no-work event days and shows the club-hours window.</span></label>' +
      '<label class="fl">Checklist <span style="text-transform:none;letter-spacing:0">(one step per line)</span></label>' +
      '<textarea id="pmC" rows="6" placeholder="Replace filters&#10;Cold deck temp [°F 50-60]&#10;Blower motor amps [A]">' + esc(e.checklist || '') + '</textarea>' +
      '<div class="dim" style="font-size:12px;margin-top:4px">To log a number, end the line with the unit and range in brackets: <code>Cold deck temp [°F 50-60]</code>, <code>Filter pressure drop [in. w.c. max 1.0]</code>, or just <code>Motor amps [A]</code>. A reading outside the range opens a repair work order.</div>' +
      '<label class="fl">Parts kit <span style="text-transform:none;letter-spacing:0">(pre-fills close-out and the shopping list)</span></label><div id="kitList"></div>' +
      '<input id="kitQ" placeholder="Search stock to add a part" autocomplete="off"><div id="kitRes"></div>' +
      '<div class="row" style="margin-top:12px;"><button class="btn-2" onclick="$(\'pmNewBox\').innerHTML=\'\'">Cancel</button>' +
      (pm ? '<button class="btn-2" style="color:var(--rose)" onclick="delPm(' + pm.id + ')">Remove</button>' : '') +
      '<button class="btn" onclick="savePm(' + (pm ? pm.id : '') + ')">Save</button></div><div class="dim" id="pmMsg" style="margin-top:8px;"></div>' + tagList() + bldgList() + '</div>';
    const drawTrig = () => {
      const v = $('pmTT').value;
      const freqSel = lbl => '<label class="fl">' + lbl + '</label><select id="pmF">' + FREQS.map(([n, l]) => '<option value="' + n + '"' + (n === f ? ' selected' : '') + '>' + l + '</option>').join('') +
        (FREQS.some(x => x[0] === f) ? '' : '<option value="' + f + '" selected>Every ' + f + ' days</option>') + '</select>';
      let h = '';
      if (v === 'seasonal') {
        h = '<div class="row"><div><label class="fl">Month</label>' + sel('pmSM', MONTHS_FULL.map((m, i) => [i + 1, m]), sm) + '</div>' +
          '<div><label class="fl">Day</label><input id="pmSDay" type="number" min="1" max="31" value="' + sd + '"></div></div>' +
          '<input type="hidden" id="pmF" value="365"><div class="dim" style="font-size:12px;margin-top:4px">Good for spring tower startup, fall boiler service, and the free cooling test before cold weather.</div>';
      } else if (v === 'runtime') {
        h = '<div class="row"><div><label class="fl">Run hours between</label><input id="pmRH" type="number" min="1" value="' + esc(e.run_hours || 2000) + '"></div>' +
          '<div>' + freqSel('Or at most') + '</div></div>' +
          '<div class="dim" style="font-size:12px;margin-top:4px">Log the hour meter on the equipment record or when closing out. It comes due when the hours run out, or after the day limit if nobody reads the meter.</div>';
      } else {
        h = '<div class="row"><div>' + freqSel('Repeats') + '</div><div><label class="fl">Next due</label><input type="date" id="pmD" value="' + esc(e.next_due || today()) + '"></div></div>';
      }
      if (v !== 'calendar') h += '<input type="hidden" id="pmD" value="' + esc(e.next_due || '') + '">';
      $('pmTrig').innerHTML = h;
    };
    $('pmTT').onchange = drawTrig; drawTrig();
    kitPicker();
    box.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('pmT').focus();
  };
  if (!PMS.length && !$('pmNewBox')) loadPm().then(go); else go();
};
async function kitPicker() {
  if (!PARTS.length) { try { const d = await api('/parts'); PARTS = d.parts; } catch (e) {} }
  const q = $('kitQ'); if (!q) return;
  q.oninput = e => {
    const s = e.target.value.toLowerCase().trim();
    const res = s ? PARTS.filter(p => [p.name, p.part_no, p.fits].join(' ').toLowerCase().includes(s)).slice(0, 6) : [];
    $('kitRes').innerHTML = res.map(p => '<div class="pkr" onclick="kitAdd(' + p.id + ')"><span>' + esc(p.name) + '</span><span class="dim">' + qn(p.on_hand) + ' ' + esc(p.uom) + '</span></div>').join('') ||
      (s ? '<div class="dim" style="padding:6px 0">Not in stock. Add it on the Parts tab first.</div>' : '');
  };
  drawKit();
}
function kitAdd(id) {
  const p = PARTS.find(x => x.id === id); if (!p) return;
  const have = PMKIT.find(x => x.part_id === id); if (have) have.qty++; else PMKIT.push({ part_id: id, qty: 1, name: p.name, uom: p.uom });
  $('kitQ').value = ''; $('kitRes').innerHTML = ''; drawKit();
}
function drawKit() {
  const el = $('kitList'); if (!el) return;
  el.innerHTML = PMKIT.map((x, i) => '<div class="pkr on"><span style="flex:1">' + esc(x.name) + '</span>' +
    '<input type="number" step="any" min="0" value="' + x.qty + '" style="width:70px;padding:6px" onchange="PMKIT[' + i + '].qty=+this.value">' +
    '<span class="dim" style="width:34px">' + esc(x.uom || '') + '</span><span class="rm" onclick="PMKIT.splice(' + i + ',1);drawKit()">✕</span></div>').join('') ||
    '<div class="dim" style="font-size:12px;margin-bottom:6px">No kit. Filter and belt kits can be set up from the sizes on each record (PM, then Parts).</div>';
}
window.savePm = async function (id) {
  const tt = $('pmTT').value;
  const body = { title: $('pmT').value.trim(), freq_days: $('pmF').value, checklist: $('pmC').value, trigger_type: tt,
    needs_shutdown: $('pmSD').checked, kit: PMKIT.filter(k => k.qty > 0).map(k => ({ part_id: k.part_id, qty: k.qty })) };
  if (tt === 'calendar') body.next_due = $('pmD').value;
  if (tt === 'seasonal') {
    const m = String($('pmSM').value).padStart(2, '0'), d = String(parseInt($('pmSDay').value, 10) || 1).padStart(2, '0');
    body.season = m + '-' + d;
  }
  if (tt === 'runtime') body.run_hours = $('pmRH').value;
  if (!id) { body.apt = $('pmA').value.trim(); body.building = $('pmB').value.trim(); }
  try {
    await api(id ? '/pm/' + id : '/pm', { method: id ? 'PUT' : 'POST', body });
    toast(id ? 'PM updated' : 'PM task added'); loadPm(); refreshUnitIfOpen();
  } catch (e) { $('pmMsg').innerHTML = '<span style="color:var(--rose)">' + esc(e.message) + '</span>'; }
};

/* ================= Rounds ================= */
async function drawRounds() {
  const d = await api('/pm/rounds?days=' + PMDAYS);
  const total = d.routes.reduce((s, r) => s + r.count, 0), late = d.routes.reduce((s, r) => s + r.late, 0);
  let h = '<div class="panel"><div class="eyebrow">PM walks by location</div>' +
    '<div class="filters" style="margin:8px 0 10px">' + [[0, 'Due now'], [7, '7 days'], [14, '14 days'], [30, '30 days']].map(([n, l]) =>
      '<div class="' + (PMDAYS === n ? 'on' : '') + '" onclick="PMDAYS=' + n + ';loadPm()">' + l + '</div>').join('') + '</div>' +
    '<div class="stats"><div class="stat"><div class="n">' + total + '</div><div class="l">PM due</div></div>' +
    '<div class="stat"><div class="n" style="color:' + (late ? 'var(--rose)' : 'var(--text)') + '">' + late + '</div><div class="l">overdue</div></div>' +
    '<div class="stat"><div class="n">' + d.routes.length + '</div><div class="l">walks</div></div></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn" onclick="scanTag()">Scan a tag</button><button class="btn-2" onclick="printTags()">Print QR tags</button></div>' +
    '<div class="row" style="margin-top:8px"><input id="scanType" placeholder="Or type a tag: AHU-2" style="font-family:var(--mono);text-transform:uppercase" list="tagList">' +
    '<button class="btn-2" style="flex:0 0 auto" onclick="scanOpen($(\'scanType\').value)">Go</button></div>' + tagList() +
    '<input type="file" id="scanIn" accept="image/*" capture="environment" style="display:none">' +
    '<div class="dim" id="scanMsg" style="margin-top:6px;font-size:12px">Scan the QR tag on a unit to open the PM due on it. Walk names come from where each unit is; rename one on its record.</div></div>';
  if (!d.routes.length) h += '<div class="empty"><div class="big">Nothing due in this window</div>Pick a longer window, or check the Schedule.</div>';
  d.routes.forEach((r, ri) => {
    h += '<div class="panel"><div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;min-width:0">' +
      '<div style="font-family:var(--disp);font-size:17px;font-weight:700;line-height:1.25">' + esc(r.name) + '</div>' +
      '<div class="dim" style="font-size:12px;margin-top:2px">' + r.stops.length + ' stop' + (r.stops.length > 1 ? 's' : '') + ' · ' + r.count + ' task' + (r.count > 1 ? 's' : '') +
      (r.late ? ' · <span style="color:var(--rose)">' + r.late + ' overdue</span>' : '') + (r.shutdown ? ' · ' + r.shutdown + ' need shutdown' : '') + '</div></div>' +
      '<button class="btn-2" style="flex:0 0 auto;padding:7px 10px;font-size:12px" onclick="printTags(' + ri + ')">Tags</button></div>';
    if (r.parts.length) h += '<div class="note n-warr" style="margin:10px 0 4px;color:var(--text)"><b style="color:var(--mint)">Pull before you go</b>' +
      r.parts.map(p => esc(qn(p.qty) + ' ' + p.uom + ' ' + p.name) + (p.on_hand < p.qty ? ' <span style="color:var(--rose)">(' + qn(p.on_hand) + ' on hand)</span>' : '') + (p.location ? ' <span class="dim">· ' + esc(p.location) + '</span>' : '')).join('<br>') + '</div>';
    r.stops.forEach((s, i) => {
      h += '<div style="border-top:1px solid var(--edge);padding:10px 0 4px;display:flex;gap:10px">' +
        '<div style="flex:0 0 26px;height:26px;border-radius:50%;background:var(--ice);color:#F3EFE5;font-family:var(--mono);font-size:12px;display:flex;align-items:center;justify-content:center">' + (i + 1) + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-family:var(--mono);font-weight:600">' + esc(s.apt || 'No tag') + '<span class="dim" style="font-weight:400"> · ' + esc(s.type) + '</span></div>' +
        (s.location ? '<div class="dim" style="font-size:12px">' + esc(s.location) + '</div>' : '') +
        s.wos.map(w => '<div class="att" onclick="openWo(' + w.id + ')" style="padding:7px 0"><div style="flex:1;min-width:0"><div class="t">' + esc(w.title) + '</div>' +
          '<div class="m">' + (w.late ? '<span style="color:var(--rose)">overdue since ' + esc(fmtDate(w.due_date)) + '</span>' : 'due ' + esc(fmtDate(w.due_date))) +
          (w.readings ? ' · ' + w.readings + ' reading' + (w.readings > 1 ? 's' : '') : '') + (w.assigned_to ? ' · ' + esc(w.assigned_to) : '') + '</div></div>' +
          (w.shutdown ? '<span class="tag" style="color:var(--ember)">Shutdown</span>' : '') + '</div>').join('') +
        '</div></div>';
    });
    h += '</div>';
  });
  $('pmBody').innerHTML = h;
  window._ROUTES = d.routes;
  $('scanIn').onchange = e => { const f = e.target.files[0]; if (f) decodeTag(f); };
}

/* ----- scanning ----- */
function scanTag() { const el = $('scanIn'); if (!el) { goPm('rounds'); setTimeout(scanTag, 400); return; } el.value = ''; el.click(); }
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/jsQR.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load the scanner. Type the tag instead.')); document.head.appendChild(s); });
}
async function decodeTag(file) {
  const msg = $('scanMsg'); if (msg) msg.innerHTML = '<span class="spin"></span>Reading the tag';
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Could not open that photo')); i.src = URL.createObjectURL(file); });
    let text = null;
    if ('BarcodeDetector' in window) {
      try { const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(img); if (r.length) text = r[0].rawValue; } catch (e) {}
    }
    if (!text) {
      await loadJsQR();
      for (const max of [1200, 800, 1600]) {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
        const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        if (r) { text = r.data; break; }
      }
    }
    if (!text) throw new Error('No QR code found. Get closer and try again, or type the tag.');
    let tag = text.trim();
    try { const u = new URL(text); tag = u.searchParams.get('u') || tag; } catch (e) {}
    if (msg) msg.textContent = 'Found ' + tag + '.';
    scanOpen(tag);
  } catch (e) { if (msg) msg.innerHTML = '<span style="color:var(--rose)">' + esc(e.message) + '</span>'; else alert(e.message); }
}
async function scanOpen(tag) {
  tag = String(tag || '').trim().toUpperCase(); if (!tag) return;
  try {
    const d = await api('/scan/' + encodeURIComponent(tag));
    const pm = d.open.filter(w => w.source === 'pm');
    if (d.open.length === 1) return openWo(d.open[0].id);
    if (!d.open.length) return openRecord(d.apt);
    sheet(d.apt, d.route, '<div class="panel"><div class="eyebrow">Open on this unit</div>' +
      d.open.map(w => '<div class="att" onclick="openWo(' + w.id + ')"><div style="flex:1;min-width:0"><div class="t">' + esc(w.title) + '</div>' +
        '<div class="m">' + (w.due_date ? 'due ' + esc(fmtDate(w.due_date)) : '') + '</div></div>' + (w.source === 'pm' ? '<span class="tag tpm">PM</span>' : '') + '</div>').join('') +
      '<button class="btn-2 full" style="margin-top:12px" onclick="closeSheet();openRecord(\'' + esc(d.apt) + '\')">Open the equipment record</button></div>' +
      (pm.length ? '' : ''));
  } catch (e) { alert(e.message); }
}
async function openRecord(apt) { closeSheet(); $('aptIn').value = apt; showTab('record'); await openUnit(); }

/* ----- printable QR tags ----- */
async function printTags(ri) {
  const route = ri != null && window._ROUTES ? window._ROUTES[ri].name : '';
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:20px">Building tags…</p>');
  try {
    const d = await api('/tags' + (route ? '?route=' + encodeURIComponent(route) : ''));
    const o = location.origin;
    const card = t => '<div class="c"><img src="' + o + '/api/public/tag-qr.svg?t=' + encodeURIComponent(t.apt) + '" alt="">' +
      '<div class="b"><div class="tg">' + esc(t.apt) + '</div><div class="ty">' + esc(t.type) + '</div>' +
      '<div class="lo">' + esc(t.route) + '</div>' + (t.serves ? '<div class="lo">Serves ' + esc(t.serves.length > 70 ? t.serves.slice(0, 68) + '…' : t.serves) + '</div>' : '') +
      '<div class="hint">Scan in Clubhouse IQ to open its PM</div></div></div>';
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Equipment QR tags</title><style>' +
      'body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;background:#F3EFE5}.pg{max-width:820px;margin:0 auto;background:#fff;padding:18px}' +
      'h1{font-family:Georgia,serif;color:#1F3A63;font-size:20px;margin:0 0 4px}.sub{color:#7C8494;font-size:12px;margin-bottom:14px}' +
      '.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.c{display:flex;gap:10px;border:2px solid #1F3A63;border-radius:6px;padding:10px;break-inside:avoid}' +
      '.c img{width:96px;height:96px;flex:0 0 96px}.b{min-width:0}.tg{font-family:Menlo,Consolas,monospace;font-size:22px;font-weight:bold;color:#1F3A63}' +
      '.ty{font-size:11px;color:#9A7B32;text-transform:uppercase;letter-spacing:1px}.lo{font-size:11px;color:#4A5466;margin-top:2px}.hint{font-size:9px;color:#7C8494;margin-top:6px}' +
      '.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px;margin:0 4px}' +
      '@media(max-width:560px){.g{grid-template-columns:1fr}}@media print{.bar{display:none}body{background:#fff}.pg{padding:0}}</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">Print or save PDF</button><button onclick="window.close()">Close</button></div>' +
      '<div class="pg"><h1>Equipment QR tags</h1><div class="sub">' + esc(route || 'All equipment') + ' · ' + d.tags.length + ' tags. Print on label stock or card, laminate, and mount where the unit is serviced.</div>' +
      '<div class="g">' + d.tags.map(card).join('') + '</div></div></body></html>';
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else sheet('QR tags', route, '<iframe style="width:100%;height:75vh;border:1px solid var(--edge);background:#fff" srcdoc="' + esc(html) + '"></iframe>');
  } catch (e) { if (w) w.close(); alert(e.message); }
}

/* ================= Parts kits ================= */
async function drawKits() {
  const d = await api('/pm/kits?days=' + KITDAYS);
  const short = d.needs.filter(r => r.short > 0), ok = d.needs.filter(r => r.short <= 0);
  let h = '<div class="panel"><div class="eyebrow">Parts the coming PM will use</div>' +
    '<div class="filters" style="margin:8px 0 10px">' + [[14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']].map(([n, l]) =>
      '<div class="' + (KITDAYS === n ? 'on' : '') + '" onclick="KITDAYS=' + n + ';loadPm()">' + l + '</div>').join('') + '</div>' +
    '<div class="stats"><div class="stat"><div class="n" style="color:' + (short.length ? 'var(--rose)' : 'var(--mint)') + '">' + short.length + '</div><div class="l">to order</div></div>' +
    '<div class="stat"><div class="n">' + money2(d.short_total) + '</div><div class="l">est. cost</div></div>' +
    '<div class="stat"><div class="n">' + d.with_kits + '</div><div class="l">PMs with kits</div></div></div>' +
    (canWork() ? '<div class="row" style="margin-top:12px">' + (short.length ? '<button class="btn" onclick="copyPmOrder()">Copy order list</button>' : '') +
      '<button class="btn-2" onclick="suggestKits()">Set up kits from records</button></div>' : '') +
    '<div class="dim" id="kitMsg" style="margin-top:8px;font-size:12px">' + (d.without_kits ? d.without_kits + ' filter or belt PMs have no kit yet. "Set up kits" reads the filter size and count and the belt size typed on each record.' : 'Counts each PM as many times as it comes due in the window.') + '</div></div>';
  const line = r => '<div class="att" style="cursor:default"><div style="flex:1;min-width:0"><div class="t">' + esc(r.name) + '</div>' +
    '<div class="m">need ' + qn(r.need) + ' · on hand ' + qn(r.on_hand) + (r.vendor ? ' · ' + esc(r.vendor) : '') + (r.location ? ' · ' + esc(r.location) : '') + '</div>' +
    '<div class="m" style="margin-top:2px">' + esc(r.uses.slice(0, 4).join(', ') + (r.uses.length > 4 ? ' +' + (r.uses.length - 4) : '')) + '</div></div>' +
    (r.short > 0 ? '<span class="tag" style="color:var(--rose)">order ' + qn(r.short) + '</span>' : '<span class="tag" style="color:var(--mint)">covered</span>') + '</div>';
  if (!d.needs.length) h += '<div class="empty"><div class="big">No kits due in this window</div>Add kits to PM tasks, or set them up from the records.</div>';
  if (short.length) h += '<div class="panel"><div class="eyebrow">Order</div>' + short.map(line).join('') + '</div>';
  if (ok.length) h += '<div class="panel"><div class="eyebrow">On the shelf</div>' + ok.map(line).join('') + '</div>';
  $('pmBody').innerHTML = h;
  window._NEEDS = short;
}
async function suggestKits() {
  $('kitMsg').innerHTML = '<span class="spin"></span>Reading filter and belt sizes';
  try {
    const r = await api('/pm/kits/suggest', { method: 'POST' });
    toast(r.set ? 'Kits set on ' + r.set + ' PM tasks' : 'No new kits');
    await loadPm();
    $('kitMsg').innerHTML = (r.created ? r.created + ' new stock item' + (r.created > 1 ? 's' : '') + ' added at zero on hand. Set cost and minimum on the Parts tab. ' : '') +
      (r.missing.length ? '<b>Still missing sizes on the record:</b> ' + esc(r.missing.slice(0, 12).join(', ')) + (r.missing.length > 12 ? ' and ' + (r.missing.length - 12) + ' more' : '') +
        '. Type them into Filter size and count, and Belt size, on each record.' : '');
  } catch (e) { showErr('kitMsg', e); }
}
async function copyPmOrder() {
  const by = {};
  (window._NEEDS || []).forEach(r => (by[r.vendor || 'No vendor set'] = by[r.vendor || 'No vendor set'] || []).push(r));
  const txt = 'PM parts order, next ' + KITDAYS + ' days\n\n' + Object.keys(by).map(v => v + '\n' + by[v].map(r => '  ' + qn(r.short) + ' ' + r.uom + '  ' + r.name).join('\n')).join('\n\n');
  try { await navigator.clipboard.writeText(txt); toast('Order list copied'); } catch (e) { prompt('Copy:', txt); }
}

/* ================= Scorecard ================= */
async function drawScore() {
  const d = await api('/pm/scorecard?days=' + SCDAYS);
  const pct = v => v == null ? '—' : v + '%';
  let h = '<div class="panel"><div class="eyebrow">PM scorecard</div>' +
    '<div class="filters" style="margin:8px 0 10px">' + [[30, '30 days'], [90, '90 days'], [365, '12 months']].map(([n, l]) =>
      '<div class="' + (SCDAYS === n ? 'on' : '') + '" onclick="SCDAYS=' + n + ';loadPm()">' + l + '</div>').join('') + '</div><div class="kpis">' +
    kpi(pct(d.on_time_pct), 'PM on time', d.pm_done + ' completed' + (d.avg_days_late ? ', late ones avg ' + d.avg_days_late + ' days' : ''), d.on_time_pct == null ? '' : d.on_time_pct >= 90 ? 'good' : d.on_time_pct < 75 ? 'bad' : '') +
    kpi(pct(d.planned_pct), 'Planned work', d.planned + ' PM, ' + d.reactive + ' repairs', d.planned_pct == null ? '' : d.planned_pct >= 60 ? 'good' : d.planned_pct < 35 ? 'bad' : '') +
    kpi(d.overdue_count, 'PM overdue now', d.active + ' active tasks', d.overdue_count ? 'bad' : 'good', "goPm('schedule')") +
    kpi(d.out_of_range, 'Readings out of range', d.readings + ' logged, ' + d.repairs_from_readings + ' repair' + (d.repairs_from_readings === 1 ? '' : 's') + ' opened', d.out_of_range ? '' : 'good') +
    '</div><div class="dim" style="font-size:12px;margin-top:10px">Planned work is PM as a share of all closed work. Most well-run plants aim for 60% or more. Planned hours: ' + pct(d.planned_hours_pct) + ' (' + d.planned_hours + ' of ' + Math.round((d.planned_hours + d.reactive_hours) * 10) / 10 + ' hrs).</div></div>';
  h += '<div class="panel"><div class="eyebrow">Last six months</div><div class="legend"><span><i style="background:#2F64A8"></i>PM on time</span><span><i style="background:#B8801F"></i>Planned share</span></div>' + scoreChart(d.months) + '</div>';
  if (d.out_recent.length) h += '<div class="panel"><div class="eyebrow">Recent readings out of range</div>' + d.out_recent.map(r =>
    '<div class="att"' + (r.repair ? ' onclick="openWo(' + r.repair + ')"' : '') + '><div style="flex:1;min-width:0"><div class="t">' + esc(r.step) + ' · ' + esc(r.value + (r.uom ? ' ' + r.uom : '')) + '</div>' +
    '<div class="m">' + esc(r.apt || '') + ' · expected ' + esc(rngText(r)) + ' · ' + esc(fmtDate(r.at)) + '</div></div>' + (r.repair ? '<span class="tag">WO #' + r.repair + '</span>' : '') + '</div>').join('') + '</div>';
  if (d.overdue.length) h += '<div class="panel"><div class="eyebrow">Overdue PM</div>' + d.overdue.map(p =>
    '<div class="att" onclick="goPm(\'schedule\')"><div style="flex:1;min-width:0"><div class="t">' + esc(p.title) + '</div><div class="m">' + esc([p.apt, p.building].filter(Boolean).join(' · ')) +
    ' · <span style="color:var(--rose)">due ' + esc(fmtDate(p.next_due)) + '</span></div></div></div>').join('') + '</div>';
  if (d.by_category.length) h += '<div class="panel"><div class="eyebrow">On time by trade, ' + SCDAYS + ' days</div>' + d.by_category.map(c =>
    '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--edge)"><div style="flex:0 0 120px;font-size:13px">' + esc(c.category) + '</div>' +
    '<div style="flex:1;height:8px;background:var(--raised);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + c.pct + '%;background:' + (c.pct >= 90 ? 'var(--mint)' : c.pct < 75 ? 'var(--rose)' : 'var(--sulfur)') + '"></div></div>' +
    '<div style="flex:0 0 76px;text-align:right;font-family:var(--mono);font-size:12px">' + c.pct + '% of ' + c.n + '</div></div>').join('') + '</div>';
  $('pmBody').innerHTML = h;
}
function scoreChart(months) {
  const W = 400, H = 170, pl = 30, pr = 6, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
  const gw = iw / months.length, bw = Math.min(16, (gw - 8) / 2);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="PM on time and planned share by month" style="display:block">';
  [0, 50, 100].forEach(v => { const y = pt + ih - ih * v / 100;
    s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="#DDD5C3" stroke-width="1"' + (v ? ' stroke-dasharray="2 3"' : '') + '/>' +
      '<text x="' + (pl - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#7C8494" font-family="IBM Plex Mono,monospace">' + v + '%</text>'; });
  const bar = (x, v, c) => v == null ? '' : '<rect x="' + x + '" y="' + (pt + ih - ih * v / 100) + '" width="' + bw + '" height="' + Math.max(1, ih * v / 100) + '" rx="2" fill="' + c + '"><title>' + v + '%</title></rect>';
  months.forEach((m, i) => {
    const cx = pl + gw * i + gw / 2;
    s += bar(cx - bw - 1, m.on_time_pct, '#2F64A8') + bar(cx + 1, m.planned_pct, '#B8801F');
    if (m.on_time_pct == null && m.planned_pct == null) s += '<text x="' + cx + '" y="' + (pt + ih - 4) + '" text-anchor="middle" font-size="9" fill="#7C8494">no PM</text>';
    s += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#7C8494" font-family="IBM Plex Mono,monospace">' + esc(m.label) + '</text>';
  });
  return s + '</svg>';
}

/* ================= Club hours (shutdown windows) ================= */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function drawHours(edit) {
  const d = await api('/pm/shutdown');
  window._RULES = d.rules;
  const daysTxt = s => s === '0123456' ? 'Every day' : s === '12345' ? 'Weekdays' : s.split('').map(n => DOW[+n]).join(' ');
  let h = '<div class="panel"><div class="eyebrow">Club hours</div><div class="dim" style="font-size:13px;margin-bottom:8px">PM that needs a unit shut down is planned outside these hours, and is moved off no-work event days on the Events calendar.</div>' +
    (d.rules.length ? d.rules.map(r => '<div class="att"' + (isMgr() ? ' onclick="hoursForm(' + r.id + ')"' : ' style="cursor:default"') + '><div style="flex:1;min-width:0"><div class="t">' + esc(r.building) + '</div>' +
      '<div class="m">' + esc(daysTxt(r.days)) + ' · open ' + esc(r.start_time) + ' to ' + esc(r.end_time) + (r.note ? ' · ' + esc(r.note) : '') + '</div></div>' + (isMgr() ? '<span class="dim">Edit</span>' : '') + '</div>').join('')
      : '<div class="dim">No club hours set.</div>') +
    (isMgr() ? '<button class="btn-2" style="margin-top:12px" onclick="hoursForm()">+ Building hours</button>' : '<div class="dim" style="margin-top:10px;font-size:12px">A manager can change these.</div>') +
    '<div id="hrBox"></div></div>';
  h += '<div class="panel"><div class="eyebrow">When can it come down?</div><div class="row"><input id="hrB" list="woBldgList" placeholder="Building" value="Clubhouse"><button class="btn-2" style="flex:0 0 auto" onclick="hoursLook()">Check</button></div>' + bldgList() + '<div id="hrOut" style="margin-top:8px"></div></div>';
  $('pmBody').innerHTML = h;
  hoursLook();
}
async function hoursLook() {
  try {
    const d = await api('/pm/shutdown?building=' + encodeURIComponent($('hrB').value.trim()));
    $('hrOut').innerHTML = d.windows.map(w => '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--edge);font-size:13px"><div style="flex:0 0 90px;font-family:var(--mono)">' +
      esc(DOW[new Date(w.date + 'T12:00:00Z').getUTCDay()] + ' ' + fmtDate(w.date)) + '</div><div>' + esc(w.text) + '</div></div>').join('') || '<div class="dim">No clear days in the next 60.</div>';
  } catch (e) { showErr('hrOut', e); }
}
function hoursForm(id) {
  const r = (window._RULES || []).find(x => x.id === id) || { building: '', days: '0123456', start_time: '06:00', end_time: '22:00', note: '' };
  $('hrBox').innerHTML = '<div style="margin-top:12px;border-top:1px solid var(--edge);padding-top:10px">' +
    F('Building', '<input id="hrBld" list="woBldgList" value="' + esc(r.building) + '">') +
    '<label class="fl">Open days</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + DOW.map((n, i) =>
      '<label style="display:flex;gap:4px;align-items:center;font-size:13px"><input type="checkbox" class="hrD" value="' + i + '"' + (r.days.includes(String(i)) ? ' checked' : '') + '>' + n + '</label>').join('') + '</div>' +
    row2(F('Opens', inp('hrS', r.start_time, '06:00', 'time')), F('Closes', inp('hrE', r.end_time, '22:00', 'time'))) +
    F('Note', inp('hrN', r.note, 'Banquets run late on Saturdays')) +
    '<div class="row" style="margin-top:12px"><button class="btn-2" onclick="$(\'hrBox\').innerHTML=\'\'">Cancel</button>' +
    (id ? '<button class="btn-2" style="color:var(--rose)" onclick="hoursDel(' + id + ')">Remove</button>' : '') +
    '<button class="btn" onclick="hoursSave(' + (id || '') + ')">Save</button></div>' + errBox('hrMsg') + '</div>';
}
async function hoursSave(id) {
  const days = [...document.querySelectorAll('.hrD')].filter(x => x.checked).map(x => x.value).join('');
  try { await api('/pm/shutdown', { method: 'POST', body: { id, building: val('hrBld'), days, start_time: val('hrS'), end_time: val('hrE'), note: val('hrN') } }); toast('Saved'); drawHours(); }
  catch (e) { showErr('hrMsg', e); }
}
async function hoursDel(id) {
  if (!confirm('Remove these hours?')) return;
  try { await api('/pm/shutdown/' + id, { method: 'DELETE' }); drawHours(); } catch (e) { showErr('hrMsg', e); }
}

/* ================= Close-out form: readings, kit, hour meter ================= */
window.completeForm = async function () {
  const w = WO, box = $('cmpBox'); if (!box) return;
  const pm = w.pm;
  const steps = pm && pm.steps ? pm.steps : (w.source === 'pm' ? (w.description || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => ({ label: l, line: l, reading: false })) : []);
  const checks = steps.filter(s => !s.reading), reads = steps.filter(s => s.reading);
  let h = '<div style="margin-top:14px;border-top:1px solid var(--edge);padding-top:12px;"><div class="eyebrow">Close it out</div>';
  if (reads.length) {
    h += '<div class="eyebrow" style="margin-top:4px">Readings</div><div id="rdList">' + reads.map((s, i) =>
      '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--edge)"><div style="flex:1;min-width:0;font-size:14px">' + esc(s.label) +
      (rngText(s) ? '<div class="dim" style="font-size:11px;font-family:var(--mono)">normal ' + esc(rngText(s)) + (s.uom ? ' ' + esc(s.uom) : '') + '</div>' : '') + '</div>' +
      '<input type="number" step="any" inputmode="decimal" data-i="' + i + '" class="rdIn" style="width:92px;padding:8px;font-family:var(--mono)">' +
      '<span class="dim" style="width:44px;font-size:12px">' + esc(s.uom || '') + '</span></div>').join('') +
      '</div><div class="dim" id="rdWarn" style="font-size:12px;margin-top:6px">Leave a reading blank if you could not take it.</div>';
  }
  if (checks.length) h += '<div id="ckList" style="margin-top:8px">' + checks.map(c => '<label class="ck-row"><input type="checkbox" data-c="' + esc(c.line) + '" checked><span>' + esc(c.label) + '</span></label>').join('') + '</div>';
  const showMeter = pm && w.apt && (pm.trigger_type === 'runtime' || (pm.runtime && pm.runtime.meter != null));
  if (showMeter) h += '<label class="fl">Hour meter reading</label><input type="number" step="any" id="cmRT" placeholder="' + esc(pm.runtime && pm.runtime.meter != null ? 'Last ' + pm.runtime.meter : 'Run hours on the meter') + '">';
  h += '<label class="fl">What you found and did</label><textarea id="cmR" placeholder="' + (steps.length ? 'Anything out of spec, anything to watch' : 'Replaced fill valve and flapper, tested 3 flushes') + '"></textarea>' +
    '<div class="row"><div><label class="fl">Hours</label><input type="number" step=".25" id="cmH" placeholder="0"></div>' +
    '<div><label class="fl">Vendor cost avoided</label><input type="number" id="cmV" placeholder="$0"></div></div>' +
    '<div id="cmParts"></div>' +
    '<label class="fl">Other parts used</label><input id="cmP" placeholder="Anything not tracked in stock">' +
    (w.apt ? '<div class="dim" style="margin-top:8px;">Saves to ' + esc(w.apt) + ' service history too.</div>' : '') +
    (pm ? '<div class="dim" style="margin-top:4px;">Next one: ' + esc(pm.repeat_text || ('every ' + freqLabel(pm.freq_days))) + '.</div>' : '') +
    '<div class="dim" style="margin-top:10px">Add an after photo from the Photos section above before you close it.</div>' +
    '<div id="cmSig"></div>' +
    '<button class="btn btn-good full" style="margin-top:12px;" onclick="submitComplete()">Mark complete</button>' +
    '<div class="dim" id="cmMsg" style="margin-top:8px;"></div></div>';
  box.innerHTML = h;
  window._READS = reads;
  box.querySelectorAll('.rdIn').forEach(el => el.oninput = () => {
    const s = reads[+el.dataset.i], v = parseFloat(el.value);
    const bad = el.value !== '' && !isNaN(v) && !inRng(s, v);
    el.style.borderColor = bad ? 'var(--rose)' : ''; el.style.color = bad ? 'var(--rose)' : '';
    const n = [...box.querySelectorAll('.rdIn')].filter(x => x.style.borderColor).length;
    $('rdWarn').innerHTML = n ? '<span style="color:var(--rose)">' + n + ' reading' + (n > 1 ? 's' : '') + ' out of range. A repair work order opens for each when you close this out.</span>' : 'Leave a reading blank if you could not take it.';
  });
  signaturePad();
  await partsPicker();
  if (pm && (pm.kit_items || []).length && PARTS.length) {
    pm.kit_items.forEach(k => { const p = PARTS.find(x => x.id === k.part_id); if (p && !PICKED.find(x => x.part_id === p.id)) PICKED.push({ part_id: p.id, qty: k.qty, name: p.name, uom: p.uom, cost: p.unit_cost }); });
    drawPicked();
    const lab = $('cmParts') && $('cmParts').querySelector('label'); if (lab) lab.textContent = 'Parts from stock (kit pre-filled, change if you used different)';
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.submitComplete = async function () {
  const done = [], skip = [];
  document.querySelectorAll('#ckList input').forEach(el => (el.checked ? done : skip).push(el.dataset.c));
  const readings = [...document.querySelectorAll('.rdIn')].filter(el => el.value !== '').map(el => ({ step: window._READS[+el.dataset.i].label, value: el.value }));
  const body = { resolution: $('cmR').value.trim(), hours: $('cmH').value || 0, cost_avoided: $('cmV').value || 0,
    parts_used: $('cmP').value.trim(), checklist_done: done, checklist_skipped: skip, readings,
    parts_stock: PICKED.filter(x => x.qty > 0).map(x => ({ part_id: x.part_id, qty: x.qty })), ...sigPayload() };
  if ($('cmRT') && $('cmRT').value !== '') body.runtime = $('cmRT').value;
  try {
    const d = await api('/workorders/' + WO.id + '/complete', { method: 'POST', body });
    WO = d.workorder; PICKED = []; PARTS = [];
    const bad = (WO.notes || []).filter(n => /out of range\. Opened work order/.test(n.body)).length;
    toast('Work order #' + WO.id + ' closed' + (bad ? ', ' + bad + ' repair' + (bad > 1 ? 's' : '') + ' opened' : ''));
    drawWoSheet(); afterWoChange(); refreshUnitIfOpen(); refreshAlerts(); refreshBadge();
  } catch (e) { $('cmMsg').innerHTML = '<span style="color:var(--rose)">' + esc(e.message) + '</span>'; }
};

/* ================= Equipment record: readings, hour meter, walk ================= */
window.drawRecord = (orig => function () {
  orig.apply(this, arguments);
  if (!UNIT || !$('recordBody')) return;
  const p = document.createElement('div'); p.className = 'panel'; p.id = 'rdPanel';
  p.innerHTML = '<div class="eyebrow">Readings and run hours</div><span class="spin"></span>';
  const panels = $('recordBody').querySelectorAll('.panel');
  const anchor = [...panels].find(x => /Work on this equipment/.test(x.textContent));
  if (anchor) anchor.insertAdjacentElement('afterend', p); else $('recordBody').appendChild(p);
  loadReadings(UNIT.apt);
})(window.drawRecord);

async function loadReadings(apt) {
  const p = $('rdPanel'); if (!p) return;
  try {
    const d = await api('/unit/' + encodeURIComponent(apt) + '/readings');
    if (!UNIT || UNIT.apt !== apt || !$('rdPanel')) return;
    let h = '<div class="eyebrow">Readings and run hours</div>';
    h += '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap"><div style="flex:1;min-width:140px"><div class="dim" style="font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:1px">Hour meter</div>' +
      '<div style="font-family:var(--disp);font-size:22px;font-weight:700">' + (d.runtime_hours == null ? '—' : esc(qn(d.runtime_hours)) + ' hrs') + '</div>' +
      '<div class="dim" style="font-size:12px">' + (d.runtime_at ? 'read ' + esc(fmtDate(d.runtime_at)) : 'Not read yet') + (d.rate ? ' · about ' + esc(qn(Math.round(d.rate * 10) / 10)) + ' hrs a day' : '') + '</div></div>' +
      (canWork() ? '<div style="display:flex;gap:6px;flex:1;min-width:200px"><input type="number" step="any" id="rtIn" placeholder="New reading"><button class="btn-2" style="flex:0 0 auto" onclick="saveRuntime()">Log</button></div>' : '') + '</div>' +
      (canWork() ? '<label class="ck-row" style="border:0;font-size:12px;padding:6px 0 0"><input type="checkbox" id="rtReset"><span>Meter was reset or replaced</span></label>' : '') +
      '<div class="dim" id="rtMsg" style="font-size:12px"></div>';
    if (!d.series.length) h += '<div class="dim" style="margin-top:12px">No readings yet. They show up here after a PM with readings is closed out.</div>';
    d.series.forEach(s => {
      h += '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--edge)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">' +
        '<div style="font-weight:600;font-size:14px">' + esc(s.step) + '</div><div style="font-family:var(--mono);font-size:13px;' + (s.points[s.points.length - 1].ok ? '' : 'color:var(--rose)') + '">' + esc(qn(s.last) + (s.uom ? ' ' + s.uom : '')) + '</div></div>' +
        '<div class="dim" style="font-size:11px;font-family:var(--mono)">' + (rngText(s) ? 'normal ' + esc(rngText(s)) + ' · ' : '') + s.points.length + ' reading' + (s.points.length > 1 ? 's' : '') +
        (s.out ? ' · <span style="color:var(--rose)">' + s.out + ' out of range</span>' : '') +
        (s.drift ? ' · <span style="color:var(--ember)">trending ' + s.drift + '</span>' : '') + '</div>' + spark(s) + '</div>';
    });
    if (canWork()) h += '<details style="margin-top:14px"><summary class="dim" style="cursor:pointer;font-size:13px">PM walk: ' + esc(d.route) + '</summary>' +
      row2(F('Walk name', inp('rtRoute', d.route_custom, d.route)), F('Stop order', inp('rtOrd', d.route_order || '', '1', 'number'))) +
      '<button class="btn-2" style="margin-top:8px" onclick="saveRoute()">Save walk</button><div class="dim" style="font-size:12px;margin-top:6px">Leave the name blank to use the building and location. Units with the same walk name are grouped on Rounds.</div></details>';
    $('rdPanel').innerHTML = h;
  } catch (e) { $('rdPanel').innerHTML = '<div class="eyebrow">Readings and run hours</div><div class="dim">' + esc(e.message) + '</div>'; }
}
function spark(s) {
  const W = 320, H = 64, pl = 4, pr = 4, pt = 6, pb = 6, iw = W - pl - pr, ih = H - pt - pb;
  const vals = s.points.map(p => p.v);
  let lo = Math.min(...vals, s.lo != null ? s.lo : Infinity), hi = Math.max(...vals, s.hi != null ? s.hi : -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const Y = v => pt + ih - ih * (v - lo) / (hi - lo);
  const X = i => s.points.length === 1 ? pl + iw / 2 : pl + iw * i / (s.points.length - 1);
  let g = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block;margin-top:6px" role="img" aria-label="' + esc(s.step) + ' over time">';
  if (s.lo != null || s.hi != null) {
    const y1 = Y(s.hi != null ? s.hi : hi), y2 = Y(s.lo != null ? s.lo : lo);
    g += '<rect x="' + pl + '" y="' + y1 + '" width="' + iw + '" height="' + Math.max(1, y2 - y1) + '" fill="rgba(46,125,91,.10)"/>';
  }
  if (s.points.length > 1) {
    const pts = s.points.map((p, i) => X(i) + ',' + Y(p.v)).join(' ');
    g += '<polyline points="' + pts + '" fill="none" stroke="#1F3A63" stroke-width="1.6" vector-effect="non-scaling-stroke"/>';
  }
  s.points.forEach((p, i) => { const last = i === s.points.length - 1;
    if (!p.ok || last) g += '<circle cx="' + X(i) + '" cy="' + Y(p.v) + '" r="' + (last ? 3.5 : 3) + '" fill="' + (p.ok ? '#1F3A63' : '#B3362D') + '" vector-effect="non-scaling-stroke"><title>' + esc(fmtDate(p.at) + ': ' + p.v) + '</title></circle>'; });
  return g + '</svg>';
}
async function saveRuntime() {
  try {
    await api('/unit/' + encodeURIComponent(UNIT.apt) + '/runtime', { method: 'POST', body: { hours: $('rtIn').value, reset: $('rtReset').checked } });
    toast('Hour meter logged'); loadReadings(UNIT.apt);
  } catch (e) { showErr('rtMsg', e); }
}
async function saveRoute() {
  try { await api('/unit/' + encodeURIComponent(UNIT.apt) + '/route', { method: 'PUT', body: { route: val('rtRoute'), route_order: val('rtOrd') } }); toast('Walk saved'); loadReadings(UNIT.apt); }
  catch (e) { alert(e.message); }
}

/* ================= Dashboard: planned work panel ================= */
window.drawDash = (orig => function (d) {
  orig.apply(this, arguments);
  api('/pm/scorecard?days=30').then(s => {
    const body = $('dashBody'); if (!body || $('dashPm')) return;
    const p = document.createElement('div'); p.className = 'panel'; p.id = 'dashPm';
    const pct = v => v == null ? '—' : v + '%';
    p.innerHTML = '<div class="eyebrow">Preventive maintenance · 30 days</div><div class="kpis">' +
      kpi(pct(s.planned_pct), 'Planned work', s.planned + ' PM, ' + s.reactive + ' repairs', s.planned_pct == null ? '' : s.planned_pct >= 60 ? 'good' : s.planned_pct < 35 ? 'bad' : '', "goPm('score')") +
      kpi(s.out_of_range, 'Readings out of range', s.readings + ' logged', s.out_of_range ? '' : 'good', "goPm('score')") + '</div>';
    const first = body.querySelector('.panel'); if (first) first.insertAdjacentElement('afterend', p); else body.appendChild(p);
  }).catch(() => {});
})(window.drawDash);

/* ================= Scanned-tag links (/?u=AHU-2) ================= */
(function deepLink() {
  let tag = null;
  try { tag = new URLSearchParams(location.search).get('u'); } catch (e) {}
  if (!tag) return;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  let n = 0;
  const wait = setInterval(() => {
    if (++n > 80) return clearInterval(wait);
    if (!ME || !TOKEN) return;
    clearInterval(wait);
    if (!canWork()) { toast('Sign in as maintenance staff to open equipment PM'); return; }
    scanOpen(tag);
  }, 250);
})();

// If the app opened before this file loaded, redraw so the new screens show.
if (ME && TAB === 'work' && WORKVIEW === 'pm') loadPm();
