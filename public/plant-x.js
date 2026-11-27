/* Plant screen extras, layered on plant-ui.js:
   - tap any piece of equipment on the drawing for its readings, trend and checks
   - a status strip above the drawing
   - wall display mode for the HVAC PC (fullscreen, screen kept awake)
   - new alarms slide in, and phones buzz on a new critical alarm
   - richer air handler drawing (air colored by temperature, filter loading)
   Works the same in demo and live. */
(function(){
const s=document.createElement('style');
s.textContent=
'.pl-hit{fill:#fff;fill-opacity:0;stroke:#DCC27C;stroke-opacity:0;stroke-width:3;cursor:pointer;transition:fill-opacity .2s,stroke-opacity .2s}'+
'.pl-hit:hover,.pl-hit:focus{fill-opacity:.05;stroke-opacity:.8;outline:none}'+
'.plstrip{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}@media(min-width:560px){.plstrip{grid-template-columns:repeat(3,1fr)}}@media(min-width:900px){.plstrip{grid-template-columns:repeat(6,1fr)}}'+
'.plpill>div{min-width:0}.plpill .v{overflow:hidden;text-overflow:ellipsis}'+
'.plpill{display:flex;align-items:center;gap:9px;background:var(--panel);border:1.5px solid var(--edge);border-radius:14px;padding:8px 11px;cursor:pointer;box-shadow:var(--shadow);transition:border-color .3s,background .3s,transform .15s;animation:ahin .4s both}'+
'.plpill:active{transform:scale(.97)}.plpill .d{width:11px;height:11px;border-radius:50%;flex:none;background:#9aa3ad;position:relative}'+
'.plpill.run .d{background:var(--mint)}.plpill.run .d::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--mint);opacity:0;animation:plpillr 2s ease-out infinite}'+
'.plpill.warn{border-color:#D99A06;background:#FBF1DC}.plpill.warn .d{background:#D99A06}'+
'.plpill.bad{border-color:var(--rose);background:#FBEBE9}.plpill.bad .d{background:var(--rose);animation:plblink 1s ease-in-out infinite}'+
'.plpill .t{font-size:11.5px;color:var(--dim);font-weight:600;line-height:1.1}.plpill .v{font-size:16px;font-weight:800;color:var(--text);line-height:1.2;white-space:nowrap}'+
'@keyframes plpillr{0%{opacity:.7;transform:scale(.6)}100%{opacity:0;transform:scale(1.6)}}'+
'.plinsp .hero{display:flex;align-items:center;gap:10px;margin-bottom:10px}.plinsp .st{font-size:12px;font-weight:800;padding:4px 11px;border-radius:99px;background:var(--raised);color:var(--mid)}'+
'.plinsp .st.run{background:#E4F3EC;color:var(--mint)}.plinsp .st.bad{background:#FBEBE9;color:var(--rose)}.plinsp .st.warn{background:#FBF1DC;color:#8A5A00}'+
'.plinsp .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}'+
'.plalm.pl-new{animation:plnew .55s cubic-bezier(.2,.9,.3,1) both,plflash 1.6s .2s ease-out}'+
'.plalm:not(.pl-warn){position:relative}.plalm:not(.pl-warn)::before{content:"";position:absolute;left:-5px;top:0;bottom:0;width:5px;border-radius:3px 0 0 3px;background:var(--rose);animation:plblink 1.2s ease-in-out infinite}'+
'@keyframes plnew{from{opacity:0;transform:translateX(-18px) scale(.98)}}@keyframes plflash{0%{box-shadow:0 0 0 0 rgba(184,50,42,.45)}100%{box-shadow:0 0 0 14px rgba(184,50,42,0)}}'+
/* wall display */
'#plWall{position:fixed;inset:0;z-index:90;background:radial-gradient(120% 100% at 50% 0,#1a3561,#0a1630 70%);color:#fff;display:flex;flex-direction:column;padding:14px 18px;gap:12px;overflow:hidden;animation:fadeIn .3s}'+
'#plWall .wh{display:flex;align-items:center;gap:14px}#plWall .wh img{height:46px}'+
'#plWall .wt{font-family:"Libre Caslon Text",Georgia,serif;font-size:24px}#plWall .wt em{color:#DCC27C}#plWall .ws{font-size:12.5px;color:#a9bdd6;font-weight:600;letter-spacing:.08em;text-transform:uppercase}'+
'#plWall .wc{margin-left:auto;text-align:right}#plWall .wc b{display:block;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}#plWall .wc span{font-size:12.5px;color:#a9bdd6}'+
'#plWall .wx{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer;margin-left:12px}'+
'#plWall .plfig{flex:1;min-height:0;margin:0;display:flex;align-items:center;justify-content:center;background:transparent;box-shadow:none}#plWall .plfig svg{width:auto;height:100%;max-width:100%}'+
'#plWall .plstrip{margin:0}#plWall .plpill{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);box-shadow:none}#plWall .plpill .t{color:#a9bdd6}#plWall .plpill .v{color:#fff}'+
'#plWall .plpill.warn{background:rgba(217,154,6,.22);border-color:#D99A06}#plWall .plpill.bad{background:rgba(184,50,42,.35);border-color:#ff5a47}'+
'#plWall .wa{overflow:hidden;white-space:nowrap;font-size:14px;min-height:26px;-webkit-mask:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent);mask:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent)}#plWall .wa .rl{display:inline-flex;gap:10px;padding-right:10px}#plWall .wa .rl.mv{animation:plmarq var(--d,30s) linear infinite}@keyframes plmarq{to{transform:translateX(-50%)}}'+
'#plWall .wa span{display:inline-block}#plWall .wa span{padding:3px 12px;border-radius:99px;background:rgba(255,90,71,.25);border:1px solid rgba(255,90,71,.6)}#plWall .wa span.w{background:rgba(255,197,61,.18);border-color:rgba(255,197,61,.55)}'+
'#plWall .wa .ok{background:rgba(78,224,143,.15);border-color:rgba(78,224,143,.5)}'+
'@media(max-width:640px){#plWall .plfig{overflow:auto}#plWall .plfig svg{width:900px;height:auto}}'+
/* air handler drawing */
'#ab-fr{stroke-dasharray:1 18;stroke-width:3.5}.ab-drip{animation:abdrip 1.2s linear infinite}@keyframes abdrip{from{transform:translateY(0);opacity:1}to{transform:translateY(22px);opacity:0}}'+
'@media(prefers-reduced-motion:reduce){.plpill.run .d::after,.plpill.bad .d,.plalm.pl-new,.plalm:not(.pl-warn)::before{animation:none}}';
document.head.appendChild(s);
})();

/* ---------- equipment on the drawing ---------- */
const PLX={
  tower:{n:'CT-1 cooling tower',box:[46,26,226,238],trend:'cw',
    tiles:V=>[['Fan drive',V.hz==null?'?':Math.round(V.hz),'Hz'],['BAS signal',V.sig==null?'?':Math.round(V.sig),'%'],['Water to chiller',plF(V.ecwt),'°F'],['Water back from chiller',plF(V.lcwt),'°F'],['Approach to wet bulb',V.ecwt!=null&&V.oaWb!=null?(V.ecwt-V.oaWb).toFixed(1):'?','°F'],['Outside wet bulb',plF(V.oaWb,0),'°F']],
    st:V=>V.sig!=null&&V.hz!=null&&Math.abs(V.sig*.6-V.hz)>10?['warn','DRIVE NOT FOLLOWING BAS']:(V.hz||0)>1?['run','FAN RUNNING']:['','FAN OFF'],
    checks:['Fill, spray nozzles and basin strainer for scale or debris.','Approach over 7°F on a humid day at full fan points to fouled fill.','ABB keypad: Hand/Off/Auto and speed reference if the drive ignores the BAS.','Basin level and makeup float.'],keys:['ecwt','lcwt','tower_hz']},
  chiller:{n:'York YK chiller',box:[410,184,408,296],trend:'chw',
    tiles:V=>[['Leaving CHW',plF(V.lchw),'°F'],['Return CHW',plF(V.chwr),'°F'],['Motor current',V.fla==null?'?':Math.round(V.fla),'% FLA'],['Evap pressure',plF(V.evap),'psig'],['Cond pressure',plF(V.cond),'psig'],['Starts, last hour',V.starts1h==null?'?':V.starts1h,'']],
    st:V=>V.fault?['bad','TRIPPED']:V.run?['run','RUNNING']:['','OFF'],
    checks:['OptiView History screen for the last shutdown and its time.','Starts per hour. More than 3 means short cycling: check the LCHW restart offset.','Oil pressure and temperature on the Oil Sump screen.','Motor bearing lubrication hours.'],keys:['lchwt','chwr','fla_pct'],faults:1},
  cwp:{n:'Condenser water pump',box:[262,400,76,100],trend:'cw',
    tiles:V=>[['Status',V.cwp?'ON':'OFF',''],['Water to chiller',plF(V.ecwt),'°F'],['Water from chiller',plF(V.lcwt),'°F']],
    st:V=>V.cwp?['run','RUNNING']:['warn','OFF'],
    checks:['The water-cooled walk-in depends on this pump. If it is off, the walk-in trips on head pressure.','Amps against nameplate, seal for leaks, coupler and bearings for noise.'],keys:['ecwt','lcwt']},
  chp:{n:'Building chilled water pump',box:[862,400,76,100],trend:'chw',
    tiles:V=>[['Status',V.chwp?'ON':'OFF',''],['Flow',V.flow==null?'?':Math.round(V.flow),'gpm'],['Supply to building',plF(V.chws),'°F'],['Return from building',plF(V.chwr),'°F'],['Delta T',V.chwr!=null&&V.chws!=null?(V.chwr-V.chws).toFixed(1):'?','°F']],
    st:V=>!V.chwp?['warn','OFF']:V.flow!=null&&V.flow<150?['bad','LOW FLOW']:['run','RUNNING'],
    checks:['Flow under 150 gpm trips the chiller flow switch.','Over 800 gpm with a low delta T means too much pump or wide open coil valves.','Strainer differential and air in the loop.'],keys:['chw_gpm','chws','chwr']},
  phx:{n:'PHX-1 free cooling heat exchanger',box:[506,480,128,140],trend:'chw',
    tiles:V=>[['Status',V.phx?'ON':'OFF',''],['CHW in',plF(V.phxIn),'°F'],['CHW out',plF(V.phxOut),'°F'],['Outside wet bulb',plF(V.oaWb,0),'°F']],
    st:V=>V.phx&&V.chws>50?['bad','ON, NOT COOLING']:V.phx?['run','FREE COOLING']:['','OFF'],
    checks:['Enables below 52°F wet bulb.','Pressure drop across the CHW side. None means no flow.','Changeover valve linkage (repaired 11/2026) and isolation valves.'],keys:['chws','oa_wb']},
  walk:{n:'Walk-in cooler',box:[38,490,208,128],trend:'walkin',
    tiles:V=>[['Box temperature',plF(V.walk),'°F'],['Limit','41','°F'],['Condenser water pump',V.cwp?'ON':'OFF','']],
    st:V=>V.walk>41?['bad','ABOVE 41°F']:['run','HOLDING'],
    checks:['Water-cooled: needs the condenser water pump running even with the chiller off.','High pressure control reset after a trip.','Door gasket and strip curtain.'],keys:['walkin_temp']},
  boil:{n:'Boilers B-1 and B-2',box:[626,606,236,150],trend:'hw',
    tiles:V=>[['B-1 firing',V.b1==null?'?':Math.round(V.b1),'%'],['B-2 firing',V.b2==null?'?':Math.round(V.b2),'%'],['HW supply',plF(V.hws,0),'°F'],['HW return',plF(V.hwr,0),'°F'],['HW flow',V.hwFlow==null?'?':Math.round(V.hwFlow),'gpm']],
    st:V=>V.bLock?['bad','NO-FLOW LOCKOUT']:(V.b1||0)>2||(V.b2||0)>2?['run','FIRING']:['','IDLE'],
    checks:['Lockout or error 59: confirm the hot water pump shaft is turning, not just the motor.','Flame sensor, igniter, and condensate trap at the annual service.','Outdoor reset: supply setpoint should fall as it warms up outside.'],keys:['hws','hwr']},
  hwp:{n:'Hot water pump',box:[922,610,80,140],trend:'hw',
    tiles:V=>[['Status',V.hwp?'ON':'OFF',''],['Flow',V.hwFlow==null?'?':Math.round(V.hwFlow),'gpm'],['HW supply',plF(V.hws,0),'°F']],
    st:V=>!V.hwp?['warn','OFF']:V.hwFlow!=null&&V.hwFlow<5?['bad','MOTOR ON, NO FLOW']:['run','RUNNING'],
    checks:['A worn coupler lets the motor spin with the pump still (Commons pump, 11/14).','Seal leaks leave white scale on the bearing frame.','Check motor-to-pump alignment when rebuilding.'],keys:['hws']},
  bld:{n:'Clubhouse air handlers and fan coils',box:[950,24,230,236],open:'ahus'}
};
let PLX_SEL=null;
function plxHits(){
  const svg=document.querySelector('#plFig svg');if(!svg||svg.querySelector('.pl-hit'))return;
  let h='';Object.entries(PLX).forEach(([k,c])=>{const[x,y,w,ht]=c.box;h+='<rect class="pl-hit" tabindex="0" role="button" aria-label="'+c.n+'" data-k="'+k+'" x="'+x+'" y="'+y+'" width="'+w+'" height="'+ht+'" rx="16"><title>'+c.n+'</title></rect>'});
  svg.insertAdjacentHTML('beforeend',h);
  svg.querySelectorAll('.pl-hit').forEach(r=>{const go=()=>plxOpen(r.dataset.k);r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})});
}
function plxOpen(k){
  const c=PLX[k];if(!c)return;
  if(c.open){plxExitWall();PLVIEW=c.open;plBuilt='';drawPlant();return}
  PLX_SEL=k;
  sheet(c.n,'Central plant'+(PLMODE==='demo'?' · demo':''),'<div class="plinsp"><div class="hero"><span class="st" id="plxSt">--</span><span class="dim" style="font-size:13px" id="plxWhen"></span></div>'+
    '<div id="plxAlm"></div><div class="pltiles" id="plxTiles"></div>'+
    '<div class="panel" style="margin-top:12px"><div class="pllegend" id="plxLeg"></div><div class="plchart" style="height:170px" id="plxBox"><svg id="plxChart"></svg></div></div>'+
    '<div class="panel"><div class="eyebrow">What to look at</div><ul style="margin:4px 0 0;padding-left:20px;font-size:14px">'+c.checks.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>'+
    '<div class="acts"><button class="btn" onclick="closeSheet();plxExitWall();PLVIEW=\'trends\';PLTREND=\''+c.trend+'\';plBuilt=\'\';drawPlant()">Full trend</button>'+
    (c.faults?'<button class="btn-2" onclick="closeSheet();plxExitWall();PLVIEW=\'faults\';plBuilt=\'\';drawPlant()">York faults</button>':'')+
    '<button class="btn-2" onclick="closeSheet();plxExitWall();PLVIEW=\'controls\';plBuilt=\'\';drawPlant()">Setpoints and overrides</button></div></div>');
  plxRefresh();
}
function plxRefresh(){
  if(!PLX_SEL||!$('plxTiles')){PLX_SEL=$('plxTiles')?PLX_SEL:null;return}
  const c=PLX[PLX_SEL],V=plView(),st=c.st(V);
  const e=$('plxSt');e.className='st '+st[0];e.textContent=st[1];$('plxWhen').textContent=PLMODE==='demo'?'Plant time '+V.clock:V.clock;
  $('plxTiles').innerHTML=c.tiles(V).map(t=>plTile(t[0],t[1],t[2])).join('');
  const A=plAlarms().filter(a=>{const q=PL_EQ[a.rule];return q===PLX_SEL||(PLX_SEL==='hwp'&&q==='boil')||(PLX_SEL==='chp'&&a.rule==='lowdt')||(PLX_SEL==='cwp'&&a.rule==='walkin')});
  $('plxAlm').innerHTML=A.map(a=>'<div class="plalm '+(a.level==='critical'?'':'pl-warn')+'"><h4>'+esc(a.title)+'</h4><p>'+esc(a.detail)+'</p></div>').join('');
  plxChart(c);
}
const PLX_COL={lchwt:'#3d8fd6',chwr:'#e0663a',chws:'#8DB8E0',ecwt:'#2f8c94',lcwt:'#e0663a',tower_hz:'#B8322A',fla_pct:'#17325C',chw_gpm:'#3d8fd6',oa_wb:'#9aa3ad',walkin_temp:'#3d8fd6',hws:'#d2452b',hwr:'#e9a23b'};
const PLX_LAB={lchwt:'Leaving CHW',chwr:'Return CHW',chws:'CHW supply',ecwt:'Cond to chiller',lcwt:'Cond from chiller',tower_hz:'Tower Hz',fla_pct:'% FLA',chw_gpm:'CHW gpm',oa_wb:'Wet bulb',walkin_temp:'Walk-in',hws:'HW supply',hwr:'HW return'};
let PLX_LIVE={};
async function plxChart(c){
  const svg=$('plxChart');if(!svg)return;
  let ser={};
  if(PLMODE==='demo'){const d=PLHIST.slice(-120);c.keys.forEach(k=>ser[k]=d.map((r,i)=>[i,r[k]]).filter(p=>p[1]!=null))}
  else{const ck=c.keys.join(',');if(!PLX_LIVE[ck]||Date.now()-PLX_LIVE[ck].t>60000){try{const r=await api('/plant/trend?hours=2&keys='+ck);PLX_LIVE[ck]={t:Date.now(),s:r.series||{}}}catch(e){PLX_LIVE[ck]={t:Date.now(),s:{}}}}c.keys.forEach(k=>ser[k]=PLX_LIVE[ck].s[k]||[])}
  $('plxLeg').innerHTML=c.keys.map(k=>'<span><i style="background:'+PLX_COL[k]+'"></i>'+PLX_LAB[k]+'</span>').join('')+'<span class="dim">last 2 hours</span>';
  // keys with different units get their own scale so each line uses the height
  const W=svg.clientWidth||500,H=svg.clientHeight||170,P=8;let o='',any=0;
  const grp=k=>/hz|fla|gpm/.test(k)?k:'temp',rng={};
  c.keys.forEach(k=>{const s=ser[k];if(!s||!s.length)return;const g=grp(k),v=s.map(p=>p[1]);rng[g]=rng[g]||[1e9,-1e9];rng[g][0]=Math.min(rng[g][0],...v);rng[g][1]=Math.max(rng[g][1],...v)});
  c.keys.forEach(k=>{const s=ser[k];if(!s||s.length<2)return;any=1;
    const xs=s.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs);let[lo,hi]=rng[grp(k)];const mr=Math.max(1,Math.abs(hi)*.05);if(hi-lo<mr){const m=(hi+lo)/2;lo=m-mr/2;hi=m+mr/2}
    const X=v=>P+(W-2*P)*(v-x0)/((x1-x0)||1),Y=v=>P+(H-2*P)*(1-(v-lo)/(hi-lo));
    o+='<polyline fill="none" stroke="'+PLX_COL[k]+'" stroke-width="2.2" stroke-linejoin="round" points="'+s.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ')+'"/>';
    const e=s[s.length-1];o+='<circle class="now" cx="'+X(e[0]).toFixed(1)+'" cy="'+Y(e[1]).toFixed(1)+'" r="4" fill="'+PLX_COL[k]+'" stroke="#fff" stroke-width="1.5"/>';});
  svg.innerHTML=any?o:'<text x="12" y="30" fill="var(--dim)" font-size="13">No readings yet.</text>';
}

/* ---------- status strip ---------- */
function plxStripHtml(){return '<div class="plstrip" id="plStrip">'+['chiller','tower','chp','boil','walk','alm'].map(k=>'<div class="plpill" id="plP-'+k+'" onclick="'+(k==='alm'?'plxScrollAlarms()':'plxOpen(\''+k+'\')')+'"><span class="d"></span><div><div class="t"></div><div class="v">--</div></div></div>').join('')+'</div>'}
function plxScrollAlarms(){if($('plWall')){plxExitWall()}const a=$('plAlm');if(a)a.scrollIntoView({behavior:'smooth',block:'start'})}
function plxStrip(V,A){
  if(!$('plStrip'))return;
  const set=(k,t,v,cls)=>{const p=$('plP-'+k);if(!p)return;p.className='plpill '+(cls||'');p.querySelector('.t').textContent=t;plTween(p.querySelector('.v'),String(v))};
  const cs=PLX.chiller.st(V);set('chiller','Chiller',V.fault?'TRIP':V.run?(V.fla==null?'RUN':Math.round(V.fla)+'% FLA'):'OFF',cs[0]);
  set('tower','Tower fan',V.hz==null?'--':Math.round(V.hz)+' Hz',PLX.tower.st(V)[0]);
  set('chp','CHW supply',V.chws==null?'--':plF(V.chws)+'°F',V.chws>50?'bad':PLX.chp.st(V)[0]);
  const bf=Math.max(V.b1||0,V.b2||0);set('boil','Hot water',V.bLock?'LOCKOUT':V.hws==null?'--':plF(V.hws,0)+'°F',V.bLock?'bad':V.hws!=null&&V.hws<120&&V.hwp?'bad':bf>2?'run':'');
  set('walk','Walk-in',V.walk==null?'--':plF(V.walk)+'°F',V.walk>41?'bad':'run');
  const cr=A.filter(a=>a.level==='critical'&&!a.acked).length,wn=A.length-cr;
  set('alm','Alarms',A.length?(cr?cr+' critical':'')+(cr&&wn?' · ':'')+(wn?wn+' warn':''):'None',cr?'bad':wn?'warn':'run');
}

/* ---------- wall display ---------- */
let PLX_WAKE=null,PLX_CLK=null;
async function plxWall(){
  if($('plWall')||!$('plFig'))return;
  const w=document.createElement('div');w.id='plWall';
  w.innerHTML='<div class="wh"><img src="/crest.png" alt=""><div><div class="wt">Central <em>Plant</em></div><div class="ws">Country Club of Little Rock'+(PLMODE==='demo'?' · demo data':' · live from the BAS')+'</div></div>'+
    '<div class="wc"><b id="plWClk">--</b><span id="plWDate"></span></div><button class="wx" onclick="plxExitWall()">Exit</button></div><div id="plWStrip"></div><div id="plWFig"></div><div class="wa" id="plWAlm"></div>';
  document.body.appendChild(w);
  $('plWStrip').appendChild($('plStrip'));$('plWFig').replaceWith($('plFig'));
  try{if(w.requestFullscreen)await w.requestFullscreen()}catch(e){}
  try{if(navigator.wakeLock)PLX_WAKE=await navigator.wakeLock.request('screen')}catch(e){}
  const tick=()=>{const d=new Date();$('plWClk').textContent=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});$('plWDate').textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})};tick();PLX_CLK=setInterval(tick,10000);
  plxWallAlarms();
}
function plxWallAlarms(){
  const el=$('plWAlm');if(!el)return;
  const A=plAlarms().sort((a,b)=>(a.level==='critical'?0:1)-(b.level==='critical'?0:1));
  const sig=A.map(a=>a.rule+a.level).join('|');if(el.dataset.sig===sig)return;el.dataset.sig=sig;
  if(!A.length){el.innerHTML='<div class="rl"><span class="ok">No active alarms. The plant is running inside its limits.</span></div>';return}
  const one=A.map(a=>'<span class="'+(a.level==='critical'?'':'w')+'">'+(a.level==='critical'?'● ':'')+esc(a.title)+'</span>').join('');
  el.innerHTML='<div class="rl">'+one+'</div>';
  const rl=el.firstChild;
  if(rl.scrollWidth>el.clientWidth){rl.innerHTML=one+one;rl.classList.add('mv');rl.style.setProperty('--d',Math.max(20,A.length*6)+'s')}
}
function plxExitWall(){
  const w=$('plWall');if(!w)return;
  clearInterval(PLX_CLK);try{PLX_WAKE&&PLX_WAKE.release()}catch(e){}PLX_WAKE=null;
  if(document.fullscreenElement)try{document.exitFullscreen()}catch(e){}
  const fig=$('plFig'),strip=$('plStrip'),body=$('plantBody');w.remove();
  if(body&&PLVIEW==='plant'){plBuilt='';drawPlant()}
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&$('plWall'))plxExitWall()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('plWall'))plxExitWall()});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&$('plWall')&&navigator.wakeLock)try{PLX_WAKE=await navigator.wakeLock.request('screen')}catch(e){}});

/* ---------- new alarm motion ---------- */
let PLX_SEEN=null;
function plxAlarmMotion(A){
  const box=$('plAlm');if(!box)return;
  A=A.slice().sort((a,b)=>(a.level==='critical'?0:1)-(b.level==='critical'?0:1));
  const cards=box.querySelectorAll('.plalm'),first=PLX_SEEN===null;if(first)PLX_SEEN=new Set();
  let buzz=false;
  A.forEach((a,i)=>{const id=String(a.id||a.rule);if(!PLX_SEEN.has(id)){PLX_SEEN.add(id);if(cards[i])cards[i].classList.add('pl-new');if(!first&&a.level==='critical')buzz=true}});
  const now=new Set(A.map(a=>String(a.id||a.rule)));PLX_SEEN.forEach(id=>{if(!now.has(id))PLX_SEEN.delete(id)});
  if(buzz&&navigator.vibrate)try{navigator.vibrate([120,80,120])}catch(e){}
}

/* ---------- air handler drawing extras ---------- */
if(typeof ahuBig==='function'){
  const _big=ahuBig;
  ahuBig=function(a){
    let s=_big(a);
    const extra='<rect id="ab-dirt" x="104" y="80" width="16" height="100" fill="#6b4a22" opacity="0" style="transition:opacity 1s"/>'+
      '<path id="ab-fr" class="ah-flow" d="M190 40 L84 40"/>'+
      '<g id="ab-cond" style="opacity:0;transition:opacity 1s">'+[0,1,2].map(i=>'<circle class="ab-drip" fill="#9fd3ff" cx="'+(a.mz?376+i*6:336+i*6)+'" cy="'+(a.mz?218:178)+'" r="1.8" style="animation-duration:1.'+(2+i)+'s;animation-delay:-'+(i*.4)+'s"/>').join('')+'</g>';
    return s.replace(/<\/svg>$/,extra+'</svg>');
  };
}
if(typeof ahuDetRefresh==='function'){
  const _det=ahuDetRefresh;
  ahuDetRefresh=function(A){
    _det(A);
    const a=ahuVals().find(x=>x.dev===AHSEL);if(!a)return;const x=a.v,on=x.fan_status===1;
    const fc=$('ab-fc'),fh=$('ab-fh'),fr=$('ab-fr');
    if(fc)fc.style.stroke=x.cd==null?'':plTc(x.cd);
    if(fh)fh.style.stroke=x.hd==null?'':plTc(Math.min(95,x.hd-20));
    if(fr){fr.classList.toggle('on',on);if(x.space!=null)fr.style.stroke=plTc(x.space)}
    const d=$('ab-dirt');if(d)d.setAttribute('opacity',x.filter_dp==null?0:(plClamp((x.filter_dp-.3)/1,0,1)*.75).toFixed(2));
    const cd=$('ab-cond');if(cd)cd.style.opacity=on&&(x.chw_vlv||0)>30?'1':'0';
    ['ab-cdT','ab-hdT','ab-matT','ab-spT'].forEach(id=>{const e=$(id);if(e&&e.textContent!==e.dataset.t){const t=e.textContent;e.textContent=e.dataset.t||t;plTween(e,t)}});
  };
}

/* ---------- hook into the plant screen ---------- */
(function(){
  const _draw=drawPlant;
  drawPlant=function(){
    _draw();
    if(PLVIEW!=='plant'||!$('plFig'))return;
    $('plFig').insertAdjacentHTML('beforebegin',plxStripHtml());
    const bar=document.querySelector('#plantBody .plbar');
    if(bar&&!$('plWallB'))bar.insertAdjacentHTML('beforeend','<button class="btn-2" id="plWallB" onclick="plxWall()" title="Fullscreen view for a wall screen or the HVAC PC">Wall display</button>');
    PLX_SEEN=null;plxHits();plRefresh();
  };
  const _ref=plRefresh;
  plRefresh=function(){
    _ref();
    if(TAB!=='plant')return;
    let V,A;try{V=plView();A=plAlarms()}catch(e){return}
    if(PLVIEW==='plant'){plxHits();plxStrip(V,A);plxAlarmMotion(A);plxWallAlarms()}
    if(PLX_SEL)plxRefresh();
  };
})();
