/* Clubhouse IQ language support (English / Español).
   The app is written in English. When Spanish is picked, this file swaps
   the words on screen as the page draws them, using the table in es.js.
   Names, tags, notes and anything staff typed stay as they were typed.
   The choice is kept on the phone, and the server is told with X-Lang so
   AI diagnosis and briefs come back in Spanish too. */
(function () {
  var KEY = 'chiq_lang';
  var LANG = 'en';
  try { LANG = localStorage.getItem(KEY) || ''; } catch (e) {}
  if (!LANG) LANG = /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
  if (LANG !== 'es') LANG = 'en';
  window.LANG = LANG;
  document.documentElement.lang = LANG;

  window.setLang = function (l) {
    try { localStorage.setItem(KEY, l); } catch (e) {}
    location.reload();
  };
  window.toggleLang = function () { window.setLang(LANG === 'es' ? 'en' : 'es'); };

  // Send the language with every same-origin API call.
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0) {
        init = init || {};
        var h = init.headers;
        if (h instanceof Headers) { h.set('X-Lang', LANG); }
        else { init.headers = Object.assign({}, h || {}, { 'X-Lang': LANG }); }
      }
    } catch (e) {}
    return _fetch(input, init);
  };

  window.T = function (s) { return s; };
  if (LANG !== 'es') return;

  var D = window.ES_DICT || {};
  var PAT = window.ES_PATTERNS || [];
  var MON = { Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun', Jul: 'jul', Aug: 'ago', Sep: 'sep', Oct: 'oct', Nov: 'nov', Dec: 'dic' };

  // Lowercase index so "OPEN WORK" and "Open work" both hit.
  var LOW = {};
  Object.keys(D).forEach(function (k) { LOW[k.toLowerCase()] = D[k]; });

  // Prefixes/suffixes: phrases that sit next to a number or name in one text node.
  var PRE = [], SUF = [];
  Object.keys(D).forEach(function (k) { if (k.length >= 3) { PRE.push(k); SUF.push(k); } });
  PRE.sort(function (a, b) { return b.length - a.length; });
  SUF.sort(function (a, b) { return b.length - a.length; });

  function caseLike(src, out) {
    if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return out.toUpperCase();
    return out;
  }
  function exact(t) {
    if (Object.prototype.hasOwnProperty.call(D, t)) return D[t];
    var l = t.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LOW, l)) return caseLike(t, LOW[l]);
    return null;
  }
  function pats(t) {
    for (var i = 0; i < PAT.length; i++) {
      var m = t.match(PAT[i][0]);
      if (m) return PAT[i][1].apply(null, m);
    }
    var dm = t.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(, (\d{4}))?$/);
    if (dm) return dm[2] + ' ' + MON[dm[1]] + (dm[4] ? ' ' + dm[4] : '');
    return null;
  }
  var SEP = /^[\s:·.,()\-–#|/]$/;
  function edges(t) {
    // "Due 11/3", "Last updated by Bob", "3 overdue", "Open (4)"
    for (var i = 0; i < PRE.length; i++) {
      var k = PRE[i];
      if (t.length > k.length && t.slice(0, k.length).toLowerCase() === k.toLowerCase() && SEP.test(t.charAt(k.length))) {
        var rest = t.slice(k.length);
        var r2 = tr(rest.trim());
        // A one-word prefix only counts when the rest is a number, a date,
        // or something we also know. Keeps "Low water cutoff" from half-translating.
        if (k.indexOf(' ') < 0 && /[A-Za-z]{2,}/.test(rest) && r2 == null && !/^\s*[:·#(]/.test(rest)) continue;
        var lead = rest.match(/^\s*/)[0];
        return caseLike(t.slice(0, k.length), exact(t.slice(0, k.length))) + lead + (r2 != null ? r2 : rest.slice(lead.length));
      }
    }
    for (var j = 0; j < SUF.length; j++) {
      var s = SUF[j];
      var n = t.length - s.length;
      if (n > 0 && t.slice(n).toLowerCase() === s.toLowerCase() && SEP.test(t.charAt(n - 1))) {
        var head = t.slice(0, n);
        var hv = /[A-Za-z]{3,}/.test(head) ? tr(head.trim()) : null;
        if (s.indexOf(' ') < 0 && /[A-Za-z]{2,}/.test(head) && hv == null && !/[:·)]\s*$/.test(head)) continue;
        var trail = head.match(/\s*$/)[0];
        return (hv != null ? hv + trail : head) + caseLike(t.slice(n), exact(t.slice(n)));
      }
    }
    return null;
  }
  var depth = 0;
  function tr(t) {
    if (!t || !/[A-Za-z]{2,}/.test(t)) return null;
    var r = exact(t);
    if (r != null) return r;
    r = pats(t);
    if (r != null) return r;
    // A sentence list joined by " · "
    if (t.indexOf(' · ') > 0) {
      var parts = t.split(' · '), hit = false;
      var out = parts.map(function (p) { var x = tr(p); if (x != null) { hit = true; return x; } return p; });
      if (hit) return out.join(' · ');
    }
    if (depth < 3) { depth++; try { r = edges(t); } finally { depth--; } if (r != null) return r; }
    // Leading or trailing punctuation: "· Sample data. View as:"
    var pm = t.match(/^([·:\-–\s(]*)([\s\S]*?)([·:.,)\s]*)$/);
    if (pm && (pm[1] || pm[3]) && pm[2] && pm[2] !== t && depth < 3) {
      depth++; try { r = tr(pm[2]); } finally { depth--; }
      if (r != null) return pm[1] + r + pm[3];
    }
    return null;
  }
  function trFull(s) {
    if (s == null) return s;
    var str = String(s);
    var m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
    var core = m[2].replace(/\s+/g, ' ');
    var r = tr(core);
    return r == null ? str : m[1] + r + m[3];
  }
  window.T = trFull;

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  function skipEl(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.tagName] || (e.hasAttribute && e.hasAttribute('data-noi18n')) || e.isContentEditable) return true;
    }
    return false;
  }
  function doText(n) {
    var v = n.nodeValue;
    if (!v || n.__tr === v || !/[A-Za-z]/.test(v)) return;
    var par = n.parentNode;
    if (par && skipEl(par)) return;
    var out;
    // data-es="..." on an element sets its first text exactly (for words like
    // "Open" that are a verb on a button and a status elsewhere).
    if (par && par.getAttribute && par.getAttribute('data-es') && n === par.firstChild) {
      var m = v.match(/^(\s*)[\s\S]*?(\s*)$/);
      out = m[1] + par.getAttribute('data-es') + m[2];
    } else out = trFull(v);
    n.__tr = out;
    if (out !== v) n.nodeValue = out;
  }
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function doAttrs(el) {
    if (skipEl(el.parentNode || el) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v && /[A-Za-z]/.test(v)) {
        var o = trFull(v);
        if (o !== v) el.setAttribute(a, o);
      }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      var nv = trFull(el.value); if (nv !== el.value) el.value = nv;
    }
    if (el.tagName === 'OPTION' && el.firstChild == null && el.label) {
      var lo = trFull(el.label); if (lo !== el.label) el.label = lo;
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP[root.tagName]) { if (root.tagName === 'TEXTAREA') doAttrs(root); return; } doAttrs(root); }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else if (SKIP[n.tagName]) { if (n.tagName === 'TEXTAREA') doAttrs(n); continue; }
      else doAttrs(n);
    }
  }
  window.i18nWalk = walk;

  // Dialogs
  var _a = window.alert, _c = window.confirm, _p = window.prompt;
  window.alert = function (m) { return _a.call(window, trFull(m)); };
  window.confirm = function (m) { return _c.call(window, trFull(m)); };
  window.prompt = function (m, d) { return _p.call(window, trFull(m), d); };

  // Titles
  function doTitle() { var t = trFull(document.title); if (t !== document.title) document.title = t; }

  function start() {
    walk(document.body);
    doTitle();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      doTitle();
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
