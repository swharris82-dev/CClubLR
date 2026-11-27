/* Equipment and Diagnose tabs, version 3 look.
   Layers on the existing screens (index.html, pm-ui.js, live-ui.js): the same
   records, saves and AI calls, with a searchable equipment browser, a richer
   nameplate, an organized record, and a Diagnose screen built around live
   video and the written diagnosis. */
(function(){
const s=document.createElement('style');
s.textContent=`
/* ---------- equipment browser ---------- */
#lookupPanel{padding:14px}
#lookupPanel .tag-in{font-size:17px}
#dir>summary{font-weight:800;color:var(--ice);margin-top:10px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
#dir>summary::-webkit-details-marker{display:none}
#dir>summary::before{content:"";width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);transition:transform .2s;margin:0 4px 0 2px}
#dir[open]>summary::before{transform:rotate(45deg)}
.eqb-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
.eqb-stat{background:var(--deep);border:1px solid var(--edge);border-radius:12px;padding:9px 11px;cursor:pointer;transition:border-color .2s,transform .15s}
.eqb-stat:active{transform:scale(.97)}.eqb-stat.on{border-color:var(--ice);background:#E7EEF8}
.eqb-stat b{display:block;font-size:22px;font-weight:800;line-height:1.1}.eqb-stat span{font-size:11.5px;color:var(--dim);font-weight:600}
.eqb-stat.bad b{color:var(--rose)}.eqb-stat.warn b{color:#8A5A00}
.eqb-bar{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;scrollbar-width:none}.eqb-bar::-webkit-scrollbar{display:none}
.eqb-pill{flex:none;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:99px;border:1.5px solid var(--edge);background:var(--panel);font-size:13px;font-weight:700;color:var(--mid);cursor:pointer;white-space:nowrap}
.eqb-pill i{font-style:normal;font-size:11px;font-weight:800;background:var(--raised);padding:1px 7px;border-radius:99px;color:var(--dim)}
.eqb-pill.on{background:var(--ice);border-color:var(--ice);color:#fff}.eqb-pill.on i{background:rgba(255,255,255,.2);color:#fff}
.eqb-pill svg{width:16px;height:16px}
.eqb-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0 6px;font-size:12.5px;color:var(--dim)}
.eqb-tools select{width:auto;margin:0;min-height:34px;font-size:13px;padding:4px 30px 4px 10px}
.eqb-grp{margin:12px 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ice-dim);display:flex;align-items:center;gap:8px}
.eqb-grp::after{content:"";flex:1;height:1px;background:var(--edge)}
.eqb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.eqc2{display:flex;gap:10px;align-items:center;background:var(--panel);border:1.5px solid var(--edge);border-radius:14px;padding:10px;cursor:pointer;text-align:left;transition:border-color .2s,box-shadow .2s,transform .15s;animation:ahin .35s both;position:relative;min-width:0}
.eqc2:hover{border-color:var(--edge-lit);box-shadow:var(--shadow)}.eqc2:active{transform:scale(.98)}
.eqc2.flag{border-color:#E9B4AF;background:#FFF8F7}
.eqc2 .ic{width:42px;height:42px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center}
.eqc2 .ic svg,.eqp-ic svg,.dx-ctx .ic svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.eqc2 .tx{min-width:0;flex:1}.eqc2 .tg{font-weight:800;font-size:15.5px;letter-spacing:-.2px}
.eqc2 .ty{font-size:12px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eqc2 .mt{display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap}
.eqc2 .mt span{font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:99px;background:var(--raised);color:var(--mid)}
.eqc2 .mt .j{background:#FBF1DC;color:#8A5A00}.eqc2 .mt .f{background:#FBEBE9;color:var(--rose)}
.eqc2 .cd{position:absolute;top:9px;right:10px;display:flex;gap:2px}.eqc2 .cd i{width:5px;height:12px;border-radius:2px;background:var(--edge)}
.cat-plant .ic,.cat-plant.eqp-ic{background:#E3EEF9;color:#1d5fa8}.cat-air .ic,.cat-air.eqp-ic{background:#E4F3EC;color:#1F7A56}
.cat-hp .ic,.cat-hp.eqp-ic{background:#EFE8F8;color:#6440a5}.cat-cold .ic,.cat-cold.eqp-ic{background:#E2F4F7;color:#167d8c}
.cat-water .ic,.cat-water.eqp-ic{background:#FBF1DC;color:#9a6a00}.cat-other .ic,.cat-other.eqp-ic{background:var(--raised);color:var(--mid)}
.eqb-new{border-style:dashed;justify-content:center;color:var(--ice);font-weight:800}
.eqb-none{padding:18px;text-align:center;color:var(--dim)}
/* ---------- nameplate ---------- */
.plate{padding:18px}
.eqp-row{display:flex;gap:14px;align-items:center}
.eqp-ic{width:58px;height:58px;border-radius:16px;flex:none;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -8px rgba(0,0,0,.5)}
.eqp-ic svg{width:32px!important;height:32px!important}
.eqp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.eqp-chips span{font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.1);color:#dfe8f3}
.eqp-chips .good{background:rgba(78,224,143,.18);color:#bff3d6}.eqp-chips .poor{background:rgba(255,90,71,.22);color:#ffd1cb}
.eqp-acts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
.eqp-acts button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:12px;padding:9px 4px;font-size:12.5px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-height:58px}
.eqp-acts button:hover{background:rgba(255,255,255,.16)}
.eqp-acts button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.eqp-acts button.golive{background:var(--brass-lit);color:var(--navy-deep);border-color:transparent}
.unit-seg{position:sticky;top:6px;z-index:5;box-shadow:0 4px 14px -10px rgba(20,41,74,.4)}
/* ---------- record ---------- */
.eqsec{background:var(--panel);border:1px solid var(--edge);border-radius:var(--r);box-shadow:var(--shadow);margin-bottom:12px;overflow:hidden}
.eqsec>summary{list-style:none;cursor:pointer;padding:14px 16px;display:flex;align-items:center;gap:10px;font-weight:800}
.eqsec>summary::-webkit-details-marker{display:none}
.eqsec>summary .sm{font-weight:500;font-size:12.5px;color:var(--dim);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eqsec>summary::after{content:"";width:8px;height:8px;border-right:2px solid var(--dim);border-bottom:2px solid var(--dim);transform:rotate(45deg);transition:transform .2s;margin-right:4px}
.eqsec[open]>summary::after{transform:rotate(-135deg)}
.eqsec>.panel{box-shadow:none;border:0;border-top:1px solid var(--edge);border-radius:0;margin:0}
.eqsec>.panel>.eyebrow:first-child{display:none}
.eqh{display:flex;align-items:center;gap:8px}
.eqh svg{width:18px;height:18px;fill:none;stroke:var(--ice);stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}
#recordBody .equip{border:1px solid var(--edge);border-left:4px solid var(--brass);border-radius:12px;background:var(--deep);padding:10px 12px;margin-bottom:8px;position:relative}
#recordBody .equip .cn{font-weight:800}
/* ---------- history ---------- */
#historyBody .job{position:relative;padding-left:22px;border-left:2px solid var(--edge);margin-left:6px}
#historyBody .job::before{content:"";position:absolute;left:-7px;top:16px;width:12px;height:12px;border-radius:50%;background:var(--panel);border:3px solid var(--brass)}
/* ---------- diagnose ---------- */
.dx-ctx{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--edge);border-radius:var(--r);padding:12px 14px;margin-bottom:12px;box-shadow:var(--shadow)}
.dx-ctx .ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none}
.dx-ctx .tx{flex:1;min-width:0}.dx-ctx .k{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
.dx-ctx .v{font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dx-ctx .v small{font-weight:500;color:var(--dim);font-size:13px}
.dx-recent{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.dx-recent span{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;background:var(--raised);cursor:pointer}
.live-card.dxh{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:18px;padding:22px;border-radius:22px;position:relative;overflow:hidden;
  background:radial-gradient(120% 140% at 100% 0,#2a5590 0,#1B3A69 40%,var(--navy-deep) 100%)}
.dxh .live-copy .t{font-size:24px;font-family:var(--serif);font-weight:400;letter-spacing:0}
.dxh .live-copy .t em{color:var(--brass-lit)}
.dxh .live-copy .s{font-size:14px;margin-top:6px}
.dxh ul{list-style:none;padding:0;margin:14px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
.dxh li{display:flex;gap:8px;align-items:center;font-size:13px;color:#dbe5f1;font-weight:600}
.dxh li svg{width:18px;height:18px;flex:none;fill:none;stroke:var(--brass-lit);stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.dxh .btn-live{grid-column:auto;margin-top:16px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:17px;padding:15px;border-radius:14px;box-shadow:0 10px 24px -12px rgba(220,194,124,.8);width:100%}
.dxh .btn-live svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dxh .fine{font-size:12px;color:#9fb2cb;margin-top:8px}
.dx-vf{position:relative;border-radius:16px;overflow:hidden;background:#081429;aspect-ratio:3/4;align-self:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.dx-vf svg{position:absolute;inset:0;width:100%;height:100%}
.dx-scan{animation:dxscan 2.8s ease-in-out infinite}
@keyframes dxscan{0%,100%{transform:translateY(0)}50%{transform:translateY(150px)}}
.dx-rec{animation:plblink 1.2s steps(2) infinite}
.dx-bub{opacity:0;animation:dxbub 6s ease-in-out infinite}
@keyframes dxbub{0%,8%{opacity:0;transform:translateY(6px)}14%,44%{opacity:1;transform:none}52%,100%{opacity:0}}
.live-card.dxh.off .dx-vf{opacity:.5}
.dx-txt .chips2{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.dx-txt .chips2 span{font-size:13px;font-weight:700;padding:6px 12px;border-radius:99px;border:1.5px solid var(--edge);background:var(--deep);cursor:pointer;transition:all .15s}
.dx-txt .chips2 span.on{background:var(--ice);border-color:var(--ice);color:#fff}
.dx-ta{position:relative}.dx-ta textarea{min-height:110px;padding-right:56px}
.dx-mic{padding:0;position:absolute;right:10px;bottom:12px;width:40px;height:40px;border-radius:50%;border:0;background:var(--raised);color:var(--ice);display:flex;align-items:center;justify-content:center;cursor:pointer}
.dx-mic svg{display:block;width:20px!important;height:20px!important;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dx-mic.on{background:var(--rose);color:#fff;animation:dxmic 1.2s ease-in-out infinite}
@keyframes dxmic{50%{box-shadow:0 0 0 8px rgba(184,50,42,.18)}}
.dx-prog{display:none;margin-top:12px;background:var(--deep);border:1px solid var(--edge);border-radius:12px;padding:12px 14px}
.dx-prog.on{display:block}.dx-prog div{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--dim);padding:4px 0;transition:color .3s}
.dx-prog div i{width:18px;height:18px;border-radius:50%;border:2px solid var(--edge-lit);flex:none;position:relative}
.dx-prog div.on{color:var(--text);font-weight:700}.dx-prog div.on i{border-color:var(--ice);border-top-color:transparent;animation:spin .8s linear infinite}
.dx-prog div.ok{color:var(--mint)}.dx-prog div.ok i{background:var(--mint);border-color:var(--mint)}
.dx-prog div.ok i::after{content:"";position:absolute;left:5px;top:2px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
@keyframes spin{to{transform:rotate(360deg)}}
#triageOut .panel{animation:ahin .4s both}
#triageOut .firstmove{border-radius:14px}
.dx-esc{display:flex;gap:12px;align-items:center;background:linear-gradient(150deg,#1B3A69,var(--navy-deep));color:#fff;border-radius:var(--r);padding:14px 16px;margin-bottom:12px}
.dx-esc .t{flex:1;font-size:14px}.dx-esc .t b{display:block;font-size:16px}
.dx-esc button{background:var(--brass-lit);color:var(--navy-deep);border:0;border-radius:12px;font-weight:800;padding:11px 16px;cursor:pointer;white-space:nowrap}
/* ---------- live call polish ---------- */
.live-mid::before{content:"";position:absolute;inset:14% 9% 6%;pointer-events:none;opacity:.55;
  background:linear-gradient(#DCC27C,#DCC27C) top left/34px 3px,linear-gradient(#DCC27C,#DCC27C) top left/3px 34px,
  linear-gradient(#DCC27C,#DCC27C) top right/34px 3px,linear-gradient(#DCC27C,#DCC27C) top right/3px 34px,
  linear-gradient(#DCC27C,#DCC27C) bottom left/34px 3px,linear-gradient(#DCC27C,#DCC27C) bottom left/3px 34px,
  linear-gradient(#DCC27C,#DCC27C) bottom right/34px 3px,linear-gradient(#DCC27C,#DCC27C) bottom right/3px 34px;background-repeat:no-repeat}
.cap{animation:dxcap .3s ease both}.cap.ai::before{content:"Clubhouse IQ";display:block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8A6B22;margin-bottom:2px}
@keyframes dxcap{from{opacity:0;transform:translateY(8px)}}
.live-state.talk{box-shadow:0 0 0 0 rgba(79,211,160,.5);animation:dxtalk 1.4s ease-out infinite}
@keyframes dxtalk{to{box-shadow:0 0 0 10px rgba(79,211,160,0)}}
@media(max-width:560px){.plate-top{flex-wrap:wrap}.plate-top .status{order:-1;width:100%;display:flex;justify-content:space-between;align-items:center}.eqp-row{flex:1 1 100%}.eqp-ic{width:46px;height:46px}.eqp-ic svg{width:26px!important;height:26px!important}.plate .apt{font-size:30px}}
@media(max-width:700px){.live-card.dxh{grid-template-columns:1fr;padding:18px}.dx-vf{aspect-ratio:16/9;order:-1;max-height:170px;width:100%}.dxh ul{grid-template-columns:1fr}
  .eqb-stats{grid-template-columns:repeat(2,1fr)}.eqp-acts{grid-template-columns:repeat(2,1fr)}.eqb-grid{grid-template-columns:1fr 1fr}}
@media(max-width:400px){.eqb-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dx-scan,.dx-rec,.dx-bub,.eqc2,.cap,.live-state.talk,.dx-mic.on{animation:none}.dx-bub{opacity:1}}
`;
document.head.appendChild(s);
})();

/* ---------- icons and categories ---------- */
const EQI={
  boiler:'<path d="M5 21V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13M3 21h18M9 6V3h6v3"/><path d="M12 17c-2 0-3-1.300-3-2.800 0-1.700 1.500-2.500 2-4.200 1.200 1.100 1.200 2.300 1 3 .8-.3 1.500-.9 1.700-1.800 1 1 1.300 2 1.300 3 0 1.600-1.200 2.800-3 2.800z"/>',
  tower:'<path d="M7 4h10l2 16H5zM6 9h12M5.500 14h13"/><path d="M9 2.500c1 1 2 1 3 0s2-1 3 0"/>',
  pump:'<circle cx="10" cy="14" r="5"/><path d="M10 9V4h6M15 14h6M3 14h2M10 14l3-2"/>',
  hx:'<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4v16M12 4v16M15 4v16M2 8h3M19 16h3"/>',
  tank:'<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M7 12h10M12 21v1"/>',
  bas:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  ahu:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="14" cy="12" r="3.500"/><path d="M14 8.500v7M10.500 12h7M5 9v6M7.500 9v6"/>',
  hp:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="4"/><path d="M9 8v8M5 12h8M16 9h2M16 12h2M16 15h2"/>',
  cold:'<path d="M12 2v20M4.500 6.500l15 11M19.500 6.500l-15 11M9 3.500l3 2.500 3-2.500M9 20.500l3-2.500 3 2.500"/>',
  ice:'<rect x="4" y="4" width="7" height="7" rx="1.500"/><rect x="13" y="6" width="7" height="7" rx="1.500"/><rect x="7" y="13" width="7" height="7" rx="1.500"/>',
  water:'<path d="M12 3c3.500 4.500 6 7.500 6 11a6 6 0 0 1-12 0c0-3.500 2.500-6.500 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  pool:'<path d="M2 16c2 0 2 1.500 4 1.500S8 16 10 16s2 1.500 4 1.500S16 16 18 16s2 1.500 4 1.500M2 20c2 0 2 1.500 4 1.500S8 20 10 20s2 1.500 4 1.500S16 20 18 20s2 1.500 4 1.500M8 13V4a2 2 0 0 1 4 0M16 13V4a2 2 0 0 0-4 0M8 8h8"/>',
  rtu:'<path d="M3 10h18v9H3zM3 10l3-5h12l3 5"/><circle cx="8" cy="14.500" r="2.500"/><circle cx="16" cy="14.500" r="2.500"/>',
  dome:'<path d="M2 20a10 10 0 0 1 20 0zM7 20a5 5 0 0 1 10 0"/>',
  other:'<path d="M14.700 6.300a4 4 0 0 0-5.400 5.400L3 18l3 3 6.300-6.300a4 4 0 0 0 5.400-5.400l-2.400 2.400-2.800-.6-.6-2.800z"/>'
};
function eqKind(t,tag){
  t=String(t||'').toLowerCase();tag=String(tag||'').toUpperCase();
  if(/boiler/.test(t))return['boiler','plant'];
  if(/tower|fluid cooler/.test(t))return['tower','plant'];
  if(/chiller/.test(t))return['cold','plant'];
  if(/pump/.test(t)&&!/heat pump/.test(t))return['pump','plant'];
  if(/heat exchanger/.test(t))return['hx','plant'];
  if(/expansion|accessory|treatment/.test(t))return['tank','plant'];
  if(/controls|bas/.test(t))return['bas','plant'];
  if(/heat pump/.test(t))return['hp','hp'];
  if(/rooftop|package/.test(t))return['rtu','air'];
  if(/air handl|split|ahu|doas|make-up|fan/.test(t))return/BUBBLE/.test(tag)?['dome','air']:['ahu','air'];
  if(/walk-in|refriger|freezer|cooler/.test(t))return['cold','cold'];
  if(/ice/.test(t))return['ice','cold'];
  if(/pool/.test(t))return['pool','water'];
  if(/water heater|dhw/.test(t))return['water','water'];
  return['other','other'];
}
const EQCAT={plant:'Central plant',air:'Air handling',hp:'Heat pumps',cold:'Refrigeration',water:'Water and pool',other:'Other'};
const eqSvgI=k=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(EQI[k]||EQI.other)+'</svg>';
const EQ_ACT={
  dx:'<svg viewBox="0 0 24 24"><path d="M3 12h3.500l2.200-6 4.200 12 2.400-6H21"/></svg>',
  live:'<svg viewBox="0 0 24 24"><rect x="2.500" y="6" width="13" height="12" rx="3"/><path d="M15.500 10.500 21.500 7v10l-6-3.500"/></svg>',
  wo:'<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2.500"/><path d="M9 10.500h6M9 14.500h6M12 1.500v5"/></svg>',
  log:'<svg viewBox="0 0 24 24"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>',
  mic:'<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/></svg>',
  see:'<svg viewBox="0 0 24 24"><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  plate:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h6M7 12h10M7 15h4"/></svg>',
  hist:'<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.700L3 8M3 3v5h5M12 7v5l3 2"/></svg>',
  plant:'<svg viewBox="0 0 24 24"><path d="M3 20h18M5 20V9l4 3V9l4 3V5h6v15"/></svg>'
};

/* ---------- equipment browser ---------- */
let EQB={all:[],bldg:'all',cat:'all',quick:'',sort:'tag'};
try{const v=JSON.parse(localStorage.getItem('ciq_eqb')||'{}');Object.assign(EQB,{bldg:v.bldg||'all',cat:v.cat||'all',sort:v.sort||'tag'})}catch(e){}
function eqbSave(){try{localStorage.setItem('ciq_eqb',JSON.stringify({bldg:EQB.bldg,cat:EQB.cat,sort:EQB.sort}))}catch(e){}}
loadChips=async function(){
  try{
    const d=await api('/units');EQB.all=d.units||[];
    const groups={};EQB.all.forEach(u=>{const k=u.building||'Unassigned';(groups[k]=groups[k]||[]).push(u)});
    BUILDINGS=Object.keys(groups).filter(k=>k!=='Unassigned');
    eqbDraw();
  }catch(e){}
};
const eqbFlag=u=>u.switch_present==='no'||u.switch_functioning==='no';
const eqbPoor=u=>u.condition!=null&&u.condition<=2;
function eqbList(){
  const q=($('aptIn').value||'').trim().toLowerCase();
  let L=EQB.all.filter(u=>(EQB.bldg==='all'||(u.building||'Unassigned')===EQB.bldg)&&(EQB.cat==='all'||eqKind(u.system_type,u.apt)[1]===EQB.cat));
  if(EQB.quick==='flag')L=L.filter(eqbFlag);if(EQB.quick==='busy')L=L.filter(u=>u.job_count>0);if(EQB.quick==='poor')L=L.filter(eqbPoor);
  if(q)L=L.filter(u=>[u.apt,u.system_type,u.building,u.manufacturer,u.notes].join(' ').toLowerCase().includes(q));
  const S={tag:(a,b)=>a.apt.localeCompare(b.apt,undefined,{numeric:true}),jobs:(a,b)=>(b.job_count||0)-(a.job_count||0),age:(a,b)=>(a.install_year||9999)-(b.install_year||9999),cond:(a,b)=>(a.condition||3)-(b.condition||3)};
  return L.sort(S[EQB.sort]||S.tag);
}
function eqbDraw(){
  const box=$('chips');if(!box)return;
  const A=EQB.all,n=A.length,fl=A.filter(eqbFlag).length,busy=A.filter(u=>u.job_count>0).length,poor=A.filter(eqbPoor).length;
  $('dirSum').textContent='Browse all equipment ('+n+')';
  const bl={};A.forEach(u=>{const k=u.building||'Unassigned';bl[k]=(bl[k]||0)+1});
  const cl={};A.forEach(u=>{const c=eqKind(u.system_type,u.apt)[1];cl[c]=(cl[c]||0)+1});
  const st=(k,v,l,c)=>'<div class="eqb-stat '+(c||'')+(EQB.quick===k?' on':'')+'" onclick="EQB.quick=EQB.quick===\''+k+'\'?\'\':\''+k+'\';eqbDraw()"><b>'+v+'</b><span>'+l+'</span></div>';
  let h='<div class="eqb-stats">'+st('',n,'All equipment')+st('flag',fl,'Safety device issue',fl?'bad':'')+st('busy',busy,'With service history',busy?'warn':'')+st('poor',poor,'Poor condition',poor?'bad':'')+'</div>';
  const pill=(on,click,label,count,icon)=>'<div class="eqb-pill'+(on?' on':'')+'" onclick="'+click+'">'+(icon||'')+esc(label)+(count!=null?' <i>'+count+'</i>':'')+'</div>';
  h+='<div class="eqb-bar">'+pill(EQB.cat==='all',"EQB.cat='all';eqbSave();eqbDraw()",'All types',n)+
    Object.keys(EQCAT).filter(c=>cl[c]).map(c=>pill(EQB.cat===c,"EQB.cat='"+c+"';eqbSave();eqbDraw()",EQCAT[c],cl[c],eqSvgI({plant:'boiler',air:'ahu',hp:'hp',cold:'cold',water:'pool',other:'other'}[c]).replace('<svg ','<svg style="fill:none;stroke:currentColor;stroke-width:1.9" '))).join('')+'</div>';
  h+='<div class="eqb-bar">'+pill(EQB.bldg==='all',"EQB.bldg='all';eqbSave();eqbDraw()",'All buildings',n)+
    Object.keys(bl).sort().map(b=>pill(EQB.bldg===b,"EQB.bldg='"+b.replace(/'/g,"\\'")+"';eqbSave();eqbDraw()",b,bl[b])).join('')+'</div>';
  const L=eqbList();
  h+='<div class="eqb-tools"><span>'+L.length+' shown · type a new tag above and press Open to add one</span><select aria-label="Sort" onchange="EQB.sort=this.value;eqbSave();eqbDraw()">'+
    [['tag','Sort by tag'],['jobs','Most service'],['age','Oldest first'],['cond','Worst condition']].map(([v,l])=>'<option value="'+v+'"'+(EQB.sort===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>';
  if(!L.length){
    const q=($('aptIn').value||'').trim().toUpperCase();
    h+='<div class="eqb-none">No equipment matches.'+(q?'<div class="eqb-grid" style="margin-top:10px"><div class="eqc2 eqb-new" onclick="openUnit()">+ Add '+esc(q)+' as new equipment</div></div>':'')+'</div>';
  }else{
    const byB={};L.forEach(u=>{const k=u.building||'Unassigned';(byB[k]=byB[k]||[]).push(u)});
    const keys=EQB.sort==='tag'?Object.keys(byB).sort():Object.keys(byB);
    let i=0;
    (EQB.sort==='tag'?keys:['_']).forEach(k=>{
      const list=k==='_'?L:byB[k];
      if(k!=='_')h+='<div class="eqb-grp">'+esc(k)+' · '+list.length+'</div>';
      h+='<div class="eqb-grid">'+list.map(u=>eqbCard(u,i++)).join('')+'</div>';
    });
  }
  box.innerHTML=h;
}
function eqbCard(u,i){
  const [ic,cat]=eqKind(u.system_type,u.apt),fl=eqbFlag(u),c=u.condition||0;
  const cc=c>=4?'#1F7A56':c===3?'#D99A06':'#B8322A';
  const age=u.install_year?(new Date().getFullYear()-u.install_year):null;
  return '<div class="eqc2 cat-'+cat+(fl?' flag':'')+'" style="animation-delay:'+Math.min(i*18,400)+'ms" onclick="$(\'aptIn\').value=\''+esc(u.apt).replace(/'/g,"\\'")+'\';openUnit();window.scrollTo({top:0,behavior:\'smooth\'})" title="'+esc(u.system_type||'')+'">'+
    '<div class="ic">'+eqSvgI(ic)+'</div><div class="tx"><div class="tg" data-noi18n>'+esc(u.apt)+'</div><div class="ty">'+esc(u.system_type||'')+'</div>'+
    '<div class="mt">'+(u.job_count?'<span class="j">'+u.job_count+' job'+(u.job_count>1?'s':'')+'</span>':'')+(fl?'<span class="f">Safety</span>':'')+(age!=null?'<span>'+age+' yr</span>':'')+'</div></div>'+
    (c?'<div class="cd" title="Condition '+c+' of 5">'+[1,2,3,4,5].map(n=>'<i style="background:'+(n<=c?cc:'')+'"></i>').join('')+'</div>':'')+'</div>';
}
(function(){
  const inp=$('aptIn');if(!inp)return;
  inp.placeholder='Search or type a tag, like BLR-1';
  inp.addEventListener('input',()=>{if(!$('dir').open)$('dir').open=true;eqbDraw()});
})();

/* recent equipment for the Diagnose screen */
function eqRecent(){try{return JSON.parse(localStorage.getItem('ciq_recent')||'[]')}catch(e){return[]}}
openUnit=(orig=>async function(){
  await orig.apply(this,arguments);
  if(UNIT){const r=eqRecent().filter(x=>x!==UNIT.apt);r.unshift(UNIT.apt);try{localStorage.setItem('ciq_recent',JSON.stringify(r.slice(0,6)))}catch(e){}}
  dxCtx();
})(openUnit);

/* ---------- nameplate ---------- */
drawPlate=(orig=>function(){
  orig.apply(this,arguments);
  if(!UNIT)return;
  const pl=$('plate');pl.querySelectorAll('.eqx').forEach(x=>x.remove());
  const [ic,cat]=eqKind(UNIT.system_type,UNIT.apt);
  const top=pl.querySelector('.plate-top>div');
  if(top&&!top.parentNode.querySelector('.eqp-ic')){
    const wrap=document.createElement('div');wrap.className='eqp-row';
    const ico=document.createElement('div');ico.className='eqp-ic cat-'+cat;ico.innerHTML=eqSvgI(ic);
    top.parentNode.insertBefore(wrap,top);wrap.appendChild(ico);wrap.appendChild(top);
  }else if(top){const ico=pl.querySelector('.eqp-ic');ico.className='eqp-ic cat-'+cat;ico.innerHTML=eqSvgI(ic)}
  const c=UNIT.condition,yr=UNIT.install_year,age=yr?new Date().getFullYear()-yr:null,ch=[];
  if(UNIT.manufacturer&&!/unknown/i.test(UNIT.manufacturer))ch.push(['',UNIT.manufacturer]);
  if(yr)ch.push(['','Installed '+yr+' · '+age+' yr']);
  if(c)ch.push([c>=4?'good':c<=2?'poor':'','Condition '+['','failing','poor','fair','good','excellent'][c]]);
  if((UNIT.jobs||[]).length)ch.push(['',UNIT.jobs.length+' job'+(UNIT.jobs.length>1?'s':'')+' logged']);
  if((UNIT.equipment||[]).length)ch.push(['',UNIT.equipment.length+' component'+(UNIT.equipment.length>1?'s':'')]);
  const chips=document.createElement('div');chips.className='eqp-chips eqx';chips.innerHTML=ch.map(([k,t])=>'<span class="'+k+'">'+esc(t)+'</span>').join('');
  const acts=document.createElement('div');acts.className='eqp-acts eqx';
  acts.innerHTML='<button onclick="showTab(\'diagnose\');window.scrollTo(0,0)">'+EQ_ACT.dx+'Diagnose</button>'+
    '<button class="golive" onclick="startLive()">'+EQ_ACT.live+'Live video</button>'+
    '<button onclick="newWoForm(UNIT.apt)">'+EQ_ACT.wo+'Work order</button>'+
    '<button onclick="showTab(\'history\');window.scrollTo(0,0)">'+EQ_ACT.log+'Log a job</button>';
  const wo=$('pWo');pl.insertBefore(chips,wo);pl.appendChild(acts);
})(drawPlate);

/* ---------- record: work first, details folded ---------- */
const EQH={work:EQ_ACT.wo,reg:EQ_ACT.plate,rd:EQ_ACT.log,loc:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.200-7-11.500a7 7 0 0 1 14 0C19 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>',
  water:'<svg viewBox="0 0 24 24"><path d="M12 3c3.500 4.500 6 7.500 6 11a6 6 0 0 1-12 0c0-3.500 2.500-6.500 6-11z"/></svg>',notes:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>'};
window.drawRecord=(orig=>function(){
  orig.apply(this,arguments);
  const rb=$('recordBody');if(!UNIT||!rb)return;
  const panelOf=sel=>{const e=rb.querySelector(sel);return e?e.closest('.panel'):null};
  const P={loc:panelOf('#rBldg'),water:panelOf('#rDrain'),notes:panelOf('#rNotes'),work:panelOf('[onclick^="newPmForm"]'),rd:$('rdPanel'),reg:panelOf('#ePhoto')};
  const icon=(p,k)=>{const eb=p&&p.querySelector('.eyebrow');if(eb&&!eb.classList.contains('eqh')){eb.classList.add('eqh');eb.insertAdjacentHTML('afterbegin',EQH[k])}};
  ['work','reg','rd','notes'].forEach(k=>icon(P[k],k));
  const fold=(p,k,title,summary)=>{
    if(!p)return null;const d=document.createElement('details');d.className='eqsec';
    d.innerHTML='<summary><span class="eqh">'+EQH[k]+esc(title)+'</span><span class="sm">'+esc(summary)+'</span></summary>';d.appendChild(p);return d;
  };
  const meta=UNIT.system_meta||{};
  const locSum=[UNIT.building,UNIT.system_type,UNIT.manufacturer&&!/unknown/i.test(UNIT.manufacturer)?UNIT.manufacturer:''].filter(Boolean).join(' · ');
  const sw=UNIT.switch_present==='no'?'safety device missing':UNIT.switch_functioning==='no'?'safety device failed':UNIT.switch_functioning==='yes'?'safety device OK':'safety device not checked';
  const order=[P.work,P.reg,P.rd,fold(P.loc,'loc','Location, type and details',locSum),fold(P.water,'water',(P.water&&P.water.querySelector('.eyebrow')||{}).textContent||'Water and safety',sw),P.notes].filter(Boolean);
  order.forEach(n=>rb.appendChild(n));
  if(UNIT.switch_present==='no'||UNIT.switch_functioning==='no'){const d=rb.querySelectorAll('.eqsec')[1];if(d)d.open=true}
})(window.drawRecord);

/* ---------- Diagnose screen ---------- */
(function buildDx(){
  const tab=$('tab-diagnose');if(!tab)return;
  const goHandler=$('goTriage').onclick;
  const report=$('reportIn'),codeWrap=$('codeWrap'),tNote=$('tNote'),tFirst=$('tFirst'),out=$('triageOut');
  const vf='<svg viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="dxG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16325c"/><stop offset="1" stop-color="#0a1830"/></linearGradient>'+
    '<linearGradient id="dxL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCC27C" stop-opacity="0"/><stop offset=".5" stop-color="#DCC27C" stop-opacity=".55"/><stop offset="1" stop-color="#DCC27C" stop-opacity="0"/></linearGradient></defs>'+
    '<rect width="240" height="320" fill="url(#dxG)"/>'+
    // an air handler in frame
    '<g opacity=".9"><rect x="44" y="118" width="152" height="92" rx="8" fill="#2a4a78" stroke="#5d7aa3" stroke-width="2"/><rect x="58" y="132" width="26" height="64" fill="#3d6aa4"/>'+[0,1,2,3,4,5,6].map(i=>'<line x1="'+(60+i*3.5)+'" y1="134" x2="'+(60+i*3.5)+'" y2="194" stroke="#8DB8E0" stroke-width="1"/>').join('')+
    '<circle cx="140" cy="164" r="28" fill="#0b1a33" stroke="#8DB8E0" stroke-width="2"/><g class="pl-spin" style="animation-duration:1.4s">'+[0,72,144,216,288].map(r=>'<path d="M140 164 L140 141 Q150 148 144 164Z" fill="#8DB8E0" transform="rotate('+r+' 140 164)"/>').join('')+'</g>'+
    '<rect x="160" y="196" width="28" height="10" rx="2" fill="#0b1a33"/><text x="174" y="204" text-anchor="middle" font-size="7" fill="#7CFF8E" font-family="monospace">E4</text></g>'+
    '<rect class="dx-scan" x="20" y="70" width="200" height="40" fill="url(#dxL)"/>'+
    '<g stroke="#DCC27C" stroke-width="3" fill="none" stroke-linecap="round"><path d="M28 60v-22h22M212 60v-22h-22M28 270v22h22M212 270v22h-22"/></g>'+
    '<circle class="dx-rec" cx="30" cy="20" r="5" fill="#ff5a47"/><text x="40" y="24" font-size="11" font-weight="700" fill="#fff" font-family="Figtree,sans-serif">LIVE</text>'+
    '<g class="dx-bub"><rect x="20" y="226" width="200" height="34" rx="12" fill="#fff" fill-opacity=".95"/><text x="32" y="247" font-size="10.5" fill="#121B2A" font-family="Figtree,sans-serif" font-weight="600">Code E4. Check the drain pan float.</text></g>'+
    '<g class="dx-bub" style="animation-delay:3s"><rect x="40" y="226" width="180" height="34" rx="12" fill="#1B3A69" fill-opacity=".95"/><text x="52" y="247" font-size="10.5" fill="#fff" font-family="Figtree,sans-serif" font-weight="600">Pan is full. Clearing it now.</text></g>'+
    '</svg>';
  const feats=[[EQ_ACT.see,'Sees what you point at'],[EQ_ACT.mic,'Hears you, talks back'],[EQ_ACT.plate,'Reads plates and fault codes'],[EQ_ACT.hist,'Knows the unit history'],[EQ_ACT.plant,'Checks central plant status'],[EQ_ACT.log,'Saves the call to history']];
  tab.innerHTML=
    '<div class="dx-ctx" id="dxCtx"></div>'+
    '<div class="live-card dxh" id="liveCard"><div><div class="live-copy"><div class="t">Live video <em>diagnosis</em></div><div class="s" id="liveSub"></div></div>'+
      '<ul>'+feats.map(([i,t])=>'<li>'+i+t+'</li>').join('')+'</ul>'+
      '<button class="btn-live" id="goLive" onclick="startLive()">'+EQ_ACT.live+'Start live video</button>'+
      '<div class="fine">Uses the camera and microphone. Works best on Wi-Fi or a strong LTE signal.</div></div>'+
      '<div class="dx-vf" aria-hidden="true">'+vf+'</div></div>'+
    '<div class="panel dx-txt"><div class="eyebrow eqh">'+EQ_ACT.dx+'Written diagnosis</div>'+
      '<div class="dim" style="font-size:13.5px">No signal, or noisy room? Describe it and get ranked causes, the first move, and what to bring.</div>'+
      '<div class="chips2" id="dxChips">'+['No heat','No cooling','Not keeping setpoint','Fan not running','Tripped or locked out','Short cycling','Leaking water','Noisy or vibrating','Odor or smoke','Ice on coil','High head pressure','Won\'t start'].map(t=>'<span>'+t+'</span>').join('')+'</div>'+
      '<div class="dx-ta" id="dxTa"></div><div id="dxCodeSlot"></div>'+
      '<button class="btn full" style="margin-top:12px" id="dxGoSlot">Run diagnosis</button>'+
      '<div class="dx-prog" id="dxProg"><div>'+'<i></i>Reading the equipment record and history</div><div><i></i>Checking central plant status</div><div><i></i>Ranking likely causes</div><div><i></i>Writing the first move and truck list</div></div>'+
      '<div id="dxNotes"></div></div>'+
    '<div id="dxOutSlot"></div>';
  // move the original working elements into the new layout so their handlers keep working
  $('dxTa').appendChild(report);
  report.placeholder='What staff or dispatch said. Like: Garden Room warm, AHU-3 has a freeze stat trip';
  const mic=document.createElement('button');mic.type='button';mic.className='dx-mic';mic.id='dxMic';mic.setAttribute('aria-label','Dictate');mic.innerHTML=EQ_ACT.mic;$('dxTa').appendChild(mic);
  $('dxCodeSlot').appendChild(codeWrap);
  const go=document.createElement('button');go.className='btn full';go.style.marginTop='12px';go.id='goTriage';go.textContent='Run diagnosis';$('dxGoSlot').replaceWith(go);
  $('dxNotes').appendChild(tNote);$('dxNotes').appendChild(tFirst);tNote.style.marginTop='9px';
  $('dxOutSlot').replaceWith(out);
  // symptom chips add to the description
  document.querySelectorAll('#dxChips span').forEach(c=>c.onclick=()=>{
    c.classList.toggle('on');const t=c.textContent,v=report.value.trim();
    if(c.classList.contains('on'))report.value=v?(v.replace(/[.\s]*$/,'')+'. '+t):t;
    else report.value=v.split(/\.\s*/).filter(x=>x&&x!==t).join('. ');
  });
  // progress steps while the diagnosis runs
  go.onclick=async()=>{
    const pr=$('dxProg'),rows=[...pr.children];if(!report.value.trim()){goHandler();return}
    pr.classList.add('on');rows.forEach(r=>r.className='');let i=0;rows[0].className='on';
    const t=setInterval(()=>{if(i<rows.length-1){rows[i].className='ok';rows[++i].className='on'}},1400);
    try{await goHandler()}finally{clearInterval(t);rows.forEach(r=>r.className='ok');setTimeout(()=>pr.classList.remove('on'),700);
      if($('triageOut').firstChild)$('triageOut').scrollIntoView({behavior:'smooth',block:'start'})}
  };
  // dictation
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null;
  if(!SR)mic.style.display='none';
  mic.onclick=()=>{
    if(rec){rec.stop();return}
    rec=new SR();rec.lang=window.LANG==='es'?'es-US':'en-US';rec.interimResults=false;rec.continuous=true;
    rec.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal){const v=report.value.trim();report.value=(v?v+' ':'')+e.results[i][0].transcript.trim()}};
    rec.onend=()=>{rec=null;mic.classList.remove('on')};rec.onerror=()=>{rec=null;mic.classList.remove('on')};
    mic.classList.add('on');try{rec.start()}catch(e){rec=null;mic.classList.remove('on')}
  };
})();
function dxCtx(){
  const el=$('dxCtx');if(!el)return;
  const r=eqRecent().filter(a=>!UNIT||a!==UNIT.apt).slice(0,5);
  const rec=r.length?'<div class="dx-recent">'+r.map(a=>'<span data-noi18n onclick="$(\'aptIn\').value=\''+esc(a)+'\';openUnit()">'+esc(a)+'</span>').join('')+'</div>':'';
  el.style.display=UNIT?'none':'';
  if(UNIT){const [ic,cat]=eqKind(UNIT.system_type,UNIT.apt);
    el.innerHTML='<div class="ic cat-'+cat+'" style="'+''+'"><span class="eqp-ic cat-'+cat+'" style="width:44px;height:44px;box-shadow:none;border-radius:12px">'+eqSvgI(ic)+'</span></div><div class="tx"><div class="k">Diagnosing</div><div class="v"><span data-noi18n>'+esc(UNIT.apt)+'</span> <small>'+esc([UNIT.building,UNIT.system_type].filter(Boolean).join(' · '))+'</small></div>'+rec+'</div>'+
      '<button class="btn-2" onclick="$(\'dir\').open=true;$(\'aptIn\').focus();window.scrollTo({top:0,behavior:\'smooth\'})">Change</button>';
  }else el.innerHTML='<div class="ic cat-other"><span class="eqp-ic cat-other" style="width:44px;height:44px;box-shadow:none;border-radius:12px">'+eqSvgI('other')+'</span></div><div class="tx"><div class="k">No equipment picked</div><div class="v" style="font-size:14px;font-weight:600;white-space:normal">Pick the unit for sharper answers. It brings in its history and the plant status.</div>'+rec+'</div>'+
      '<button class="btn" onclick="$(\'dir\').open=true;$(\'aptIn\').focus();window.scrollTo({top:0,behavior:\'smooth\'})">Pick</button>';
}
showTab=(orig=>function(name){
  const was=TAB;orig.apply(this,arguments);
  if(name==='diagnose'){$('dir').open=false;dxCtx()}
  if(name==='record'&&!UNIT&&was!=='record')$('dir').open=true;
})(showTab);
drawTriage=(orig=>function(t){
  orig.apply(this,arguments);
  const out=$('triageOut');if(!out||!AI_CFG.live)return;
  out.insertAdjacentHTML('afterbegin','<div class="dx-esc"><div class="t"><b>Still not sure?</b>Show it on camera. The live assistant picks up from this description.</div><button onclick="startLive()">Start live video</button></div>');
})(drawTriage);
syncNav=(orig=>function(){orig.apply(this,arguments);const g=$('goLive');if(g&&!AI_CFG.live)g.textContent='Live video not set up'})(syncNav);
dxCtx();
$('openBtn').onclick=()=>openUnit();
try{if(TOKEN)loadChips()}catch(e){}
