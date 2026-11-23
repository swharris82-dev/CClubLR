/* Property map artwork: an illustrated aerial view of the club.
   Each building is drawn inside its layout box (MAP.layout[name] = {x,y,w,h}),
   so Arrange buildings still moves and resizes it. The look is chosen from the
   building's name: clubhouse, plant, pool, tennis, cart barn, shop, and so on.
   Status shows as a glow around the building and a badge with the open count. */

const MAPC = {
  grass: '#CFE3B4', grass2: '#C4DBA6', fairway: '#B9D99A', fairway2: '#AED18D', rough: '#B7CF97',
  road: '#9AA1A8', roadEdge: '#E9E6DD', walk: '#E6DFCF', water1: '#7FB6DA', water2: '#4F8FBF',
  wall: '#EFE8D8', wallDark: '#D9CFBA', window: '#3A4A5E', white: '#FBF8F1',
  slate: ['#7B8796', '#6A7685', '#566170', '#616D7C'], tan: ['#C9B89A', '#B9A786', '#A39273', '#AF9E7E'],
  green: ['#6E8B6F', '#5E7A60', '#4C664E', '#56715A'], red: ['#B0714F', '#9E6244', '#874F35', '#96593C'],
  metal: ['#B9C2CB', '#A8B2BC', '#929DA8', '#9EA8B2'], navy: '#1F3A63', gold: '#D8BE7C'
};
const MAP_HALO = { critical: '#D23B2A', warn: '#D99A06', busy: '#3E6CA8', ok: '#2E7D5B' };

function mapKind(name) {
  const n = String(name).toLowerCase();
  if (/club ?house/.test(n)) return 'clubhouse';
  if (/plant|boiler|chiller|mechanical/.test(n)) return 'plant';
  if (/pool|aquatic/.test(n)) return 'pool';
  if (/tennis|racquet|pickle/.test(n)) return 'tennis';
  if (/fitness|gym|wellness/.test(n)) return 'fitness';
  if (/cart/.test(n)) return 'cartbarn';
  if (/maint|shop/.test(n) && !/golf|pro/.test(n)) return 'maint';
  if (/golf shop|pro shop|starter/.test(n)) return 'golfshop';
  if (/ground|course|range|green/.test(n)) return 'grounds';
  if (/teen|family|kids|youth/.test(n)) return 'family';
  return 'generic';
}

/* ---------- small helpers ---------- */
const P = pts => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
function shadow(x, y, w, h, rx) { return '<rect x="' + (x + 7) + '" y="' + (y + 9) + '" width="' + w + '" height="' + h + '" rx="' + (rx || 4) + '" fill="#2B3A22" opacity=".22" filter="url(#mBlur)"/>'; }

// Hip roof seen from above, lit from the top left. c = [top, right, bottom, left]
function hipRoof(x, y, w, h, c) {
  const o = '<g>';
  if (w >= h) {
    const r = h / 2, cy = y + h / 2;
    return o + '<polygon points="' + P([[x, y], [x + w, y], [x + w - r, cy], [x + r, cy]]) + '" fill="' + c[0] + '"/>' +
      '<polygon points="' + P([[x + w, y], [x + w, y + h], [x + w - r, cy]]) + '" fill="' + c[1] + '"/>' +
      '<polygon points="' + P([[x, y + h], [x + w, y + h], [x + w - r, cy], [x + r, cy]]) + '" fill="' + c[2] + '"/>' +
      '<polygon points="' + P([[x, y], [x + r, cy], [x, y + h]]) + '" fill="' + c[3] + '"/>' +
      '<line x1="' + (x + r) + '" y1="' + cy + '" x2="' + (x + w - r) + '" y2="' + cy + '" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>';
  }
  const r = w / 2, cx = x + w / 2;
  return o + '<polygon points="' + P([[x, y], [x + w, y], [cx, y + r]]) + '" fill="' + c[0] + '"/>' +
    '<polygon points="' + P([[x + w, y], [x + w, y + h], [cx, y + h - r], [cx, y + r]]) + '" fill="' + c[1] + '"/>' +
    '<polygon points="' + P([[x, y + h], [x + w, y + h], [cx, y + h - r]]) + '" fill="' + c[2] + '"/>' +
    '<polygon points="' + P([[x, y], [cx, y + r], [cx, y + h - r], [x, y + h]]) + '" fill="' + c[3] + '"/>' +
    '<line x1="' + cx + '" y1="' + (y + r) + '" x2="' + cx + '" y2="' + (y + h - r) + '" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>';
}
// Gable roof, ridge running across the long side; metal adds standing seams.
function gableRoof(x, y, w, h, c, seams) {
  let s = '';
  if (w >= h) {
    s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h / 2 + '" fill="' + c[0] + '"/><rect x="' + x + '" y="' + (y + h / 2) + '" width="' + w + '" height="' + h / 2 + '" fill="' + c[2] + '"/>';
    if (seams) for (let i = x + 9; i < x + w; i += 9) s += '<line x1="' + i + '" y1="' + y + '" x2="' + i + '" y2="' + (y + h) + '" stroke="#fff" stroke-opacity=".22"/>';
    s += '<line x1="' + x + '" y1="' + (y + h / 2) + '" x2="' + (x + w) + '" y2="' + (y + h / 2) + '" stroke="#fff" stroke-opacity=".45" stroke-width="2.5"/>';
  } else {
    s += '<rect x="' + x + '" y="' + y + '" width="' + w / 2 + '" height="' + h + '" fill="' + c[3] + '"/><rect x="' + (x + w / 2) + '" y="' + y + '" width="' + w / 2 + '" height="' + h + '" fill="' + c[1] + '"/>';
    if (seams) for (let i = y + 9; i < y + h; i += 9) s += '<line x1="' + x + '" y1="' + i + '" x2="' + (x + w) + '" y2="' + i + '" stroke="#fff" stroke-opacity=".22"/>';
    s += '<line x1="' + (x + w / 2) + '" y1="' + y + '" x2="' + (x + w / 2) + '" y2="' + (y + h) + '" stroke="#fff" stroke-opacity=".45" stroke-width="2.5"/>';
  }
  return s + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="none" stroke="#000" stroke-opacity=".12"/>';
}
// Flat commercial roof with parapet and rooftop units.
function flatRoof(x, y, w, h, units) {
  let s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#C9CED4"/>' +
    '<rect x="' + (x + 5) + '" y="' + (y + 5) + '" width="' + (w - 10) + '" height="' + (h - 10) + '" fill="url(#mGravel)" stroke="#AEB5BD" stroke-width="2"/>';
  for (let i = 0; i < (units || 0); i++) {
    const ux = x + 14 + i * Math.max(30, (w - 40) / Math.max(1, units)), uy = y + 14;
    if (ux + 22 > x + w - 8) break;
    s += '<rect x="' + ux + '" y="' + uy + '" width="22" height="16" rx="2" fill="#E5E8EC" stroke="#8F98A2"/><circle cx="' + (ux + 11) + '" cy="' + (uy + 8) + '" r="5" fill="#8F98A2"/>';
  }
  return s;
}
// Front wall seen below the roof edge (gives the drawing depth), with windows or doors.
function frontWall(x, y, w, hh, opts) {
  opts = opts || {};
  let s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="' + (opts.color || MAPC.wall) + '"/>' +
    '<rect x="' + x + '" y="' + (y + hh - 3) + '" width="' + w + '" height="3" fill="' + MAPC.wallDark + '"/>';
  if (opts.doors) {
    const n = opts.doors, dw = Math.min(30, (w - 20) / n - 8);
    for (let i = 0; i < n; i++) {
      const dx = x + (w - (n * (dw + 8) - 8)) / 2 + i * (dw + 8);
      s += '<rect x="' + dx + '" y="' + (y + 2) + '" width="' + dw + '" height="' + (hh - 5) + '" fill="#8E97A1"/>';
      for (let j = y + 5; j < y + hh - 4; j += 3) s += '<line x1="' + dx + '" y1="' + j + '" x2="' + (dx + dw) + '" y2="' + j + '" stroke="#6F7883" stroke-width=".8"/>';
    }
  } else if (hh >= 9) {
    for (let i = x + 10; i < x + w - 10; i += 18) s += '<rect x="' + i + '" y="' + (y + 3) + '" width="8" height="' + Math.max(4, hh - 8) + '" fill="' + (opts.lit ? '#FFE3A3' : MAPC.window) + '" opacity=".85"/>';
  }
  return s;
}
function tree(x, y, r, tone) {
  const g = tone ? ['#5E8A4A', '#4C7639', '#76A35C'] : ['#6C9A52', '#557F3F', '#88B66B'];
  return '<circle cx="' + (x + r * .35) + '" cy="' + (y + r * .45) + '" r="' + r + '" fill="#2B3A22" opacity=".2"/>' +
    '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + g[1] + '"/>' +
    '<circle cx="' + (x - r * .2) + '" cy="' + (y - r * .25) + '" r="' + r * .72 + '" fill="' + g[0] + '"/>' +
    '<circle cx="' + (x - r * .35) + '" cy="' + (y - r * .4) + '" r="' + r * .32 + '" fill="' + g[2] + '"/>';
}
function cart(x, y) {
  return '<rect x="' + x + '" y="' + y + '" width="13" height="20" rx="3" fill="#F7F5EF" stroke="#A9A39A"/><rect x="' + (x + 2) + '" y="' + (y + 3) + '" width="9" height="6" rx="1" fill="#3E4C5C"/>';
}
function car(x, y, c) {
  return '<rect x="' + x + '" y="' + y + '" width="22" height="38" rx="6" fill="' + c + '"/><rect x="' + (x + 3) + '" y="' + (y + 9) + '" width="16" height="9" rx="2" fill="#2E3A48" opacity=".75"/><rect x="' + (x + 3) + '" y="' + (y + 24) + '" width="16" height="6" rx="2" fill="#2E3A48" opacity=".6"/>';
}

/* ---------- one drawing per kind of building ---------- */
function drawBuilding(kind, x, y, w, h) {
  const wall = Math.max(8, Math.min(18, h * .13));
  const roofH = h - wall;
  let s = '';
  switch (kind) {
    case 'clubhouse': {
      // main block, two wings, white portico, chimneys, porte-cochere drive
      const mw = w * .56, mx = x + (w - mw) / 2, mh = roofH * .72;
      const ww = w * .26, wy = y + roofH * .22, wh = roofH * .62;
      s += shadow(x, wy, ww, wh + wall) + shadow(x + w - ww, wy, ww, wh + wall) + shadow(mx, y, mw, mh + wall + roofH * .1);
      s += frontWall(x, wy + wh, ww, wall, { lit: true }) + hipRoof(x, wy, ww, wh, MAPC.slate);
      s += frontWall(x + w - ww, wy + wh, ww, wall, { lit: true }) + hipRoof(x + w - ww, wy, ww, wh, MAPC.slate);
      s += frontWall(mx, y + mh, mw, wall + roofH * .1, { lit: true }) + hipRoof(mx, y, mw, mh, MAPC.slate);
      [mx + mw * .18, mx + mw * .82].forEach(cx => { s += '<rect x="' + (cx - 6) + '" y="' + (y + mh * .2) + '" width="12" height="16" fill="#9C7C62" stroke="#6E5543"/>'; });
      // portico: pediment roof and white columns
      const pw = mw * .36, px = x + (w - pw) / 2, py = y + mh - 6, ph = roofH * .26;
      s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" fill="' + MAPC.white + '" stroke="#CFC6B3"/>' +
        '<polygon points="' + P([[px, py], [px + pw, py], [px + pw / 2, py + ph * .55]]) + '" fill="#E6DECB"/>';
      for (let i = 0; i < 4; i++) s += '<circle cx="' + (px + pw * (.14 + i * .24)) + '" cy="' + (py + ph - 5) + '" r="3.5" fill="#fff" stroke="#BFB49E"/>';
      // drive loop
      const dcx = x + w / 2, dcy = y + h - 4;
      s += '<path d="M' + (dcx - pw * .9) + ' ' + (y + h + 30) + ' Q ' + dcx + ' ' + (dcy - 10) + ' ' + (dcx + pw * .9) + ' ' + (y + h + 30) + '" stroke="' + MAPC.road + '" stroke-width="12" fill="none" opacity=".9"/>';
      break;
    }
    case 'plant': {
      s += shadow(x, y, w, h) + flatRoof(x, y, w, roofH, 0) + frontWall(x, y + roofH, w, wall, { doors: 1 });
      // rooftop cooling tower with fan, plus pipes
      const tr = Math.min(w, roofH) * .3, tx = x + w * .68, ty = y + roofH * .5;
      s += '<rect x="' + (tx - tr * 1.15) + '" y="' + (ty - tr * 1.15) + '" width="' + tr * 2.3 + '" height="' + tr * 2.3 + '" rx="4" fill="#AFB8C2" stroke="#7D8793"/>' +
        '<circle cx="' + tx + '" cy="' + ty + '" r="' + tr + '" fill="#3C4756" stroke="#D3D9E0" stroke-width="2"/>';
      for (let i = 0; i < 4; i++) s += '<path d="M' + tx + ' ' + ty + ' l' + (tr * .9 * Math.cos(i * 1.571)).toFixed(1) + ' ' + (tr * .9 * Math.sin(i * 1.571)).toFixed(1) + '" stroke="#C8D1DA" stroke-width="4" stroke-linecap="round"/>';
      s += '<circle cx="' + tx + '" cy="' + ty + '" r="4" fill="#C8D1DA"/>';
      s += '<path d="M' + (x + 12) + ' ' + (y + roofH * .35) + ' H' + (tx - tr * 1.2) + ' M' + (x + 12) + ' ' + (y + roofH * .62) + ' H' + (tx - tr * 1.2) + '" stroke="#5F87B5" stroke-width="5"/>' +
        '<path d="M' + (x + 12) + ' ' + (y + roofH * .48) + ' H' + (tx - tr * 1.2) + '" stroke="#C9704A" stroke-width="5"/>';
      break;
    }
    case 'pool': {
      const ph = h * .38;
      s += shadow(x, y, w, ph + wall) + gableRoof(x + w * .1, y, w * .8, ph, MAPC.red) + frontWall(x + w * .1, y + ph, w * .8, wall, { lit: true });
      const dy = y + ph + wall + 4, dh = h - ph - wall - 4;
      s += '<rect x="' + x + '" y="' + dy + '" width="' + w + '" height="' + dh + '" rx="6" fill="#EEE9DD" stroke="#D4CBB6"/>';
      const px = x + 12, py = dy + 10, pw = w - 24, phh = dh - 20;
      s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + phh + '" rx="10" fill="url(#mWater)" stroke="#fff" stroke-width="3"/>';
      for (let i = 1; i < 5; i++) s += '<line x1="' + (px + 6) + '" y1="' + (py + phh * i / 5) + '" x2="' + (px + pw - 6) + '" y2="' + (py + phh * i / 5) + '" stroke="#fff" stroke-opacity=".55" stroke-dasharray="6 6"/>';
      [[x + w - 10, dy + 8], [x + 8, dy + dh - 8]].forEach(([ux, uy]) => { s += '<circle cx="' + ux + '" cy="' + uy + '" r="9" fill="#F0E2B8" stroke="#C9A85C"/>'; });
      break;
    }
    case 'tennis': {
      s += shadow(x, y, w, h);
      // barrel vault roof running across the long side, with ribs
      const v = w >= h;
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + roofH + '" rx="' + (v ? roofH * .12 : w * .12) + '" fill="url(' + (v ? '#mVaultH' : '#mVaultV') + ')" stroke="#9AA4AF" stroke-width="2"/>';
      if (v) for (let i = x + 16; i < x + w - 6; i += 16) s += '<line x1="' + i + '" y1="' + (y + 2) + '" x2="' + i + '" y2="' + (y + roofH - 2) + '" stroke="#8C97A3" stroke-opacity=".45" stroke-width="1.5"/>';
      else for (let i = y + 16; i < y + roofH - 6; i += 16) s += '<line x1="' + (x + 2) + '" y1="' + i + '" x2="' + (x + w - 2) + '" y2="' + i + '" stroke="#8C97A3" stroke-opacity=".45" stroke-width="1.5"/>';
      s += frontWall(x, y + roofH, w, wall, { doors: 0 });
      break;
    }
    case 'fitness': {
      s += shadow(x, y, w, h) + flatRoof(x, y, w, roofH, 2);
      for (let i = 0; i < 3; i++) s += '<rect x="' + (x + w * .5 + i * (w * .14)) + '" y="' + (y + roofH * .35) + '" width="' + w * .1 + '" height="' + roofH * .45 + '" rx="2" fill="#BFE0F2" stroke="#8FB6CC"/>';
      s += frontWall(x, y + roofH, w, wall, { lit: true });
      break;
    }
    case 'cartbarn': {
      const bh = h * .62;
      s += shadow(x, y, w, bh) + gableRoof(x, y, w, bh - wall, MAPC.green, true) + frontWall(x, y + bh - wall, w, wall, { doors: Math.max(2, Math.floor(w / 60)) });
      s += '<rect x="' + x + '" y="' + (y + bh + 2) + '" width="' + w + '" height="' + (h - bh - 2) + '" rx="4" fill="#CBC7BE"/>';
      for (let cx = x + 10; cx < x + w - 14; cx += 19) s += cart(cx, y + bh + 8);
      break;
    }
    case 'maint': {
      const bh = h * .7;
      s += shadow(x, y, w, bh) + gableRoof(x, y, w, bh - wall, MAPC.metal, true) + frontWall(x, y + bh - wall, w, wall + 2, { doors: Math.max(2, Math.floor(w / 55)), color: '#DCD6C8' });
      s += '<rect x="' + x + '" y="' + (y + bh + 2) + '" width="' + w + '" height="' + (h - bh - 2) + '" rx="4" fill="url(#mGravel)" stroke="#B6AE9D"/>';
      // mower and pallets in the yard
      s += '<rect x="' + (x + 14) + '" y="' + (y + bh + 10) + '" width="28" height="18" rx="4" fill="#E2B33C" stroke="#9C7A21"/><rect x="' + (x + 50) + '" y="' + (y + bh + 10) + '" width="22" height="16" fill="#B08A5B"/>';
      break;
    }
    case 'golfshop': {
      s += shadow(x, y, w, h) + hipRoof(x, y, w, roofH, MAPC.green) + frontWall(x, y + roofH, w, wall, { lit: true });
      for (let i = 0; i < w; i += 14) s += '<rect x="' + (x + i) + '" y="' + (y + roofH - 2) + '" width="7" height="7" fill="' + (i / 14 % 2 ? '#FFFFFF' : '#2E6B45') + '"/>';
      s += '<line x1="' + (x + w + 8) + '" y1="' + (y + 4) + '" x2="' + (x + w + 8) + '" y2="' + (y + 40) + '" stroke="#555" stroke-width="2"/><path d="M' + (x + w + 8) + ' ' + (y + 4) + ' l16 6 -16 6z" fill="' + MAPC.navy + '"/>';
      break;
    }
    case 'family': {
      s += shadow(x, y, w, h) + gableRoof(x, y, w, roofH, MAPC.tan);
      const dn = Math.max(2, Math.floor(w / 50));
      for (let i = 0; i < dn; i++) { const dx = x + (i + .5) * w / dn - 8; s += '<rect x="' + dx + '" y="' + (y + roofH * .58) + '" width="16" height="' + roofH * .3 + '" fill="' + MAPC.tan[0] + '" stroke="#8D7C5F"/>'; }
      s += frontWall(x, y + roofH, w, wall, { lit: true });
      break;
    }
    case 'grounds': {
      // putting green, bunker, flag, mower path
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="16" fill="' + MAPC.fairway + '" stroke="#9CC07A" stroke-width="2"/>';
      for (let i = x + 12; i < x + w; i += 24) s += '<rect x="' + i + '" y="' + (y + 2) + '" width="12" height="' + (h - 4) + '" fill="' + MAPC.fairway2 + '" opacity=".6"/>';
      s += '<ellipse cx="' + (x + w * .62) + '" cy="' + (y + h * .48) + '" rx="' + w * .24 + '" ry="' + h * .3 + '" fill="#9FD07A" stroke="#7FB55C" stroke-width="2"/>' +
        '<path d="M' + (x + w * .22) + ' ' + (y + h * .62) + ' q' + w * .08 + ' -' + h * .2 + ' ' + w * .18 + ' 0 q-' + w * .06 + ' ' + h * .16 + ' -' + w * .18 + ' 0z" fill="#EEDFB2" stroke="#D6C38D"/>' +
        '<line x1="' + (x + w * .64) + '" y1="' + (y + h * .5) + '" x2="' + (x + w * .64) + '" y2="' + (y + h * .2) + '" stroke="#333" stroke-width="2"/><path d="M' + (x + w * .64) + ' ' + (y + h * .2) + ' l18 6 -18 6z" fill="#C8372D"/>' +
        '<circle cx="' + (x + w * .64) + '" cy="' + (y + h * .5) + '" r="3" fill="#222"/>';
      break;
    }
    default: {
      s += shadow(x, y, w, h) + hipRoof(x, y, w, roofH, MAPC.tan) + frontWall(x, y + roofH, w, wall, { lit: true });
    }
  }
  return s;
}

/* ---------- the grounds ---------- */
const MAP_TREES = [[40, 280], [380, 260], [395, 330], [40, 560], [60, 900], [350, 640], [565, 450], [960, 300], [945, 420], [960, 560],
  [960, 700], [940, 1010], [700, 1060], [610, 1100], [380, 1020], [40, 1000], [420, 140], [600, 160], [330, 60], [560, 60], [900, 60],
  [22, 470], [720, 470], [880, 470], [260, 980], [990, 860], [30, 700], [580, 990]];
const CAR_COLORS = ['#D9DEE4', '#2E3A48', '#8A1E24', '#E9E9E9', '#5B6C82', '#C7C2B6', '#1F3A63', '#7B7F84'];

function mapGround(W, H) {
  let s = '<defs>' +
    '<filter id="mBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>' +
    '<pattern id="mMow" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="56" height="56" fill="' + MAPC.fairway + '"/><rect width="28" height="56" fill="' + MAPC.fairway2 + '"/></pattern>' +
    '<pattern id="mLawn" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="' + MAPC.grass + '"/><circle cx="8" cy="10" r="1.2" fill="#B7D199"/><circle cx="28" cy="30" r="1.2" fill="#B7D199"/></pattern>' +
    '<pattern id="mGravel" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#D2D5D9"/><circle cx="2" cy="2" r=".9" fill="#B5BAC0"/><circle cx="6" cy="5" r=".9" fill="#E3E6E9"/></pattern>' +
    '<linearGradient id="mWater" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FD3F0"/><stop offset="1" stop-color="#3D9ACB"/></linearGradient>' +
    '<radialGradient id="mPond" cx=".4" cy=".35"><stop offset="0" stop-color="' + MAPC.water1 + '"/><stop offset="1" stop-color="' + MAPC.water2 + '"/></radialGradient>' +
    '<linearGradient id="mVaultH" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4F6F8"/><stop offset=".5" stop-color="#DDE2E7"/><stop offset="1" stop-color="#B4BDC6"/></linearGradient>' +
    '<linearGradient id="mVaultV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F4F6F8"/><stop offset=".5" stop-color="#DDE2E7"/><stop offset="1" stop-color="#B4BDC6"/></linearGradient>' +
    '<style>.mHalo{fill:none;stroke-width:6;opacity:.85}.mHalo.crit{animation:mPulse 1.4s ease-in-out infinite}@keyframes mPulse{50%{opacity:.25}}@media(prefers-reduced-motion:reduce){.mHalo.crit{animation:none}}</style>' +
    '</defs>';
  s += '<rect width="' + W + '" height="' + H + '" fill="url(#mLawn)"/>';
  // fairways top and bottom, rough edges
  s += '<path d="M0 0 H' + W + ' V120 C 820 170, 640 60, 470 120 S 140 190, 0 110Z" fill="url(#mMow)"/>' +
    '<path d="M0 1080 C 170 1030, 330 1130, 520 1085 S 840 1010, ' + W + ' 1075 V' + H + ' H0Z" fill="url(#mMow)"/>' +
    '<path d="M0 1080 C 170 1030, 330 1130, 520 1085 S 840 1010, ' + W + ' 1075" stroke="#A2C47F" stroke-width="10" fill="none" opacity=".6"/>';
  // bunkers and a green on the course
  s += '<ellipse cx="760" cy="1190" rx="60" ry="26" fill="#EEDFB2" stroke="#D6C38D" stroke-width="2"/>' +
    '<ellipse cx="320" cy="1200" rx="80" ry="42" fill="#A3D57F" stroke="#86BC63" stroke-width="2"/>' +
    '<line x1="330" y1="1205" x2="330" y2="1158" stroke="#333" stroke-width="2.5"/><path d="M330 1158 l22 7 -22 7z" fill="#C8372D"/>' +
    '<ellipse cx="200" cy="55" rx="55" ry="22" fill="#EEDFB2" stroke="#D6C38D" stroke-width="2"/>';
  // pond
  s += '<ellipse cx="870" cy="1195" rx="104" ry="62" fill="#9CC07A"/><ellipse cx="870" cy="1192" rx="96" ry="55" fill="url(#mPond)"/>' +
    '<path d="M820 1180 q20 -6 40 0 M880 1200 q20 -6 40 0" stroke="#fff" stroke-opacity=".5" stroke-width="2" fill="none"/>';
  // roads: entrance from the boulevard, the main drive, service road
  const road = d => '<path d="' + d + '" stroke="' + MAPC.roadEdge + '" stroke-width="40" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="' + d + '" stroke="' + MAPC.road + '" stroke-width="32" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="' + d + '" stroke="#F3E6B4" stroke-width="2" stroke-dasharray="14 12" fill="none"/>';
  s += road('M500 1320 L500 980 Q500 940 470 930 L380 930') + road('M500 980 L500 730 L880 730') + road('M500 440 L500 250 L910 250 L910 120');
  // cart paths
  s += '<path d="M80 1050 C 220 1000, 300 980, 420 935 M600 1000 C 700 1030, 820 1040, 950 1010 M330 175 C 420 220, 600 200, 700 245" stroke="' + MAPC.walk + '" stroke-width="10" fill="none" stroke-linecap="round" opacity=".95"/>';
  // parking lot with stalls and cars
  s += '<rect x="60" y="296" width="300" height="210" rx="12" fill="#8E959D" stroke="' + MAPC.roadEdge + '" stroke-width="5"/>' +
    '<rect x="70" y="390" width="280" height="22" fill="#B8C9A3"/>';
  for (let i = 0; i < 9; i++) {
    const sx = 72 + i * 31;
    s += '<line x1="' + sx + '" y1="306" x2="' + sx + '" y2="384" stroke="#F4F1E8" stroke-width="2"/><line x1="' + sx + '" y1="418" x2="' + sx + '" y2="496" stroke="#F4F1E8" stroke-width="2"/>';
    if ((i * 7) % 3 !== 1 && i < 8) s += car(sx + 5, 330, CAR_COLORS[i % CAR_COLORS.length]);
    if ((i * 5) % 4 !== 2 && i < 8) s += car(sx + 5, 438, CAR_COLORS[(i + 3) % CAR_COLORS.length]);
  }
  s += '<text x="210" y="405" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="15" fill="#5E6B57" letter-spacing="2" opacity=".8">PARKING</text>';
  // trees
  MAP_TREES.forEach(([x, y], i) => { s += tree(x, y, 18 + (i * 7) % 12, i % 2); });
  // street name and compass
  s += '<text x="520" y="1300" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="17" fill="#ffffff" letter-spacing="3" opacity=".95">COUNTRY CLUB BLVD</text>' +
    '<text x="150" y="1258" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="16" fill="#4F7238" letter-spacing="3" opacity=".8">GOLF COURSE</text>' +
    '<g transform="translate(948,52)"><circle r="26" fill="#fff" opacity=".85" stroke="#B8C3A6"/><path d="M0 -20 L7 4 L0 0 L-7 4Z" fill="' + MAPC.navy + '"/><path d="M0 20 L7 -4 L0 0 L-7 -4Z" fill="#B8C3A6"/>' +
    '<text y="-27" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="12" fill="' + MAPC.navy + '">N</text></g>';
  return s;
}

/* ---------- the map ---------- */
function mapSvg() {
  const L = MAP.layout, W = MAP.canvas.w, H = MAP.canvas.h;
  let s = '<svg id="mapSvg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:' + MAPC.grass + ';touch-action:' + (MAPEDIT ? 'none' : 'pan-y') + '" role="img" aria-label="Illustrated map of the club buildings">' + mapGround(W, H);
  // draw back to front so lower buildings overlap the ones behind them
  const list = MAP.buildings.filter(b => L[b.name]).sort((a, b) => (L[a.name].y + L[a.name].h) - (L[b.name].y + L[b.name].h));
  list.forEach(b => {
    const r = L[b.name], kind = mapKind(b.name), col = MAP_HALO[b.status] || MAP_HALO.ok;
    s += '<g class="bld" data-b="' + esc(b.name) + '" style="cursor:' + (MAPEDIT ? 'move' : 'pointer') + '">';
    // invisible hit area so the whole box is tappable
    s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#000" fill-opacity="0"/>';
    if (b.status !== 'ok' || MAPEDIT) s += '<rect class="mHalo' + (b.status === 'critical' ? ' crit' : '') + '" x="' + (r.x - 9) + '" y="' + (r.y - 9) + '" width="' + (r.w + 18) + '" height="' + (r.h + 18) + '" rx="14" stroke="' + (MAPEDIT ? MAPC.navy : col) + '"' + (MAPEDIT ? ' stroke-dasharray="12 8" style="opacity:.7;stroke-width:3"' : '') + '/>';
    s += drawBuilding(kind, r.x, r.y, r.w, r.h);
    // name plaque
    const words = b.name.split(' '), lines = []; let cur = '';
    const fs = Math.max(17, Math.min(21, r.w / 9)), maxc = Math.max(6, Math.floor(r.w * 1.5 / fs));
    words.forEach(w => { if ((cur + ' ' + w).trim().length > maxc && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }); if (cur) lines.push(cur);
    const longest = Math.max(...lines.map(l => l.length)), pw = Math.min(r.w + 20, longest * fs * .56 + 20), lh = fs * 1.1;
    const ph = lines.length * lh + (b.equipment ? fs * .78 : 0) + 10, px = kind === 'grounds' ? r.x + 10 : r.x + r.w / 2 - pw / 2;
    const py = kind === 'grounds' ? r.y + 8 : Math.max(4, r.y + r.h * (kind === 'pool' || kind === 'cartbarn' || kind === 'maint' ? .3 : .42) - ph / 2);
    s += '<g pointer-events="none"><rect x="' + (px + 2) + '" y="' + (py + 3) + '" width="' + pw + '" height="' + ph + '" rx="8" fill="#1A2436" opacity=".22"/>' +
      '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="8" fill="#FFFDF8" fill-opacity=".94" stroke="' + (b.status === 'ok' ? '#D9D2BF' : col) + '" stroke-width="' + (b.status === 'ok' ? 1.5 : 3) + '"/>' +
      lines.map((l, i) => '<text x="' + (px + pw / 2) + '" y="' + (py + 5 + (i + .8) * lh) + '" text-anchor="middle" font-family="Libre Caslon Text,Georgia,serif" font-weight="700" font-size="' + fs + '" fill="#1A2436">' + esc(l) + '</text>').join('') +
      (b.equipment ? '<text x="' + (px + pw / 2) + '" y="' + (py + 5 + lines.length * lh + fs * .62) + '" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="' + (fs * .6).toFixed(1) + '" font-weight="600" fill="#5A6475">' + b.equipment + ' equipment</text>' : '') + '</g>';
    if (b.open) {
      const bx = Math.min(r.x + r.w - 2, W - 26), by = Math.max(r.y + 2, 26);
      s += '<g pointer-events="none"><circle cx="' + (bx + 2) + '" cy="' + (by + 3) + '" r="24" fill="#000" opacity=".2"/><circle cx="' + bx + '" cy="' + by + '" r="24" fill="' + col + '" stroke="#fff" stroke-width="4"/>' +
        '<text x="' + bx + '" y="' + (by + 8) + '" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="22" fill="#fff">' + b.open + '</text></g>';
    }
    if (b.events && b.events.length) s += '<g pointer-events="none"><rect x="' + (r.x + 6) + '" y="' + (r.y + r.h - 30) + '" width="66" height="24" rx="12" fill="' + MAPC.navy + '"/><text x="' + (r.x + 39) + '" y="' + (r.y + r.h - 13) + '" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="13" fill="' + MAPC.gold + '">EVENT</text></g>';
    if (MAPEDIT) s += '<rect class="rsz" data-b="' + esc(b.name) + '" x="' + (r.x + r.w - 26) + '" y="' + (r.y + r.h - 26) + '" width="26" height="26" rx="4" fill="' + MAPC.navy + '" stroke="#fff" stroke-width="2" style="cursor:nwse-resize"/>';
    s += '</g>';
  });
  return s + '</svg>';
}
