/* Central plant screen: live equipment drawing, alarms, readings, trends,
   York fault lookup, and gateway setup. Server side lives in plant.js.
   With no gateway feeding data yet, the screen runs a demo simulation of
   the club's plant in the browser. Demo data never reaches the server. */
let PL=null, PLMODE='demo', PLFORCE='', PLVIEW='plant', PLTREND='chw', PLFQ='';
let PLSIM=null, PLHIST=[], PLDEMO_ALM={}, PLDEMO_LOG=[], PLDEMO_ACK=new Set(), PLPAUSE=false, PLSPEED=5, PLSCEN='normal';
let plTick=null, plPoll=null, plBuilt='';

(function plStyle(){
  const s=document.createElement('style');
  s.textContent=
  '.role-staff .nostaff{display:none!important}'+
  '.plfig{position:relative;border-radius:var(--r);overflow:hidden;background:#0f2240;box-shadow:var(--shadow);margin-bottom:12px}'+
  '.plfig svg{display:block;width:100%;height:auto}'+
  '@media(max-width:640px){.plfig{overflow-x:auto}.plfig svg{width:900px}}'+
  '.plhint{display:none;font-size:12.5px;color:var(--dim);margin:-6px 0 12px}@media(max-width:640px){.plhint{display:block}}'+
  '.plbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}'+
  '.plbar select{width:auto;min-height:40px;margin:0}.plbar .btn-2{padding:8px 14px;min-height:40px}'+
  '.plmode{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:6px 12px;border-radius:99px}'+
  '.plmode i{width:9px;height:9px;border-radius:50%;display:inline-block}'+
  '.plmode.pl-live{background:#E4F3EC;color:var(--mint)}.plmode.pl-live i{background:var(--mint);animation:plblink 1.6s ease-in-out infinite}'+
  '.plmode.pl-demo{background:#FBF1DC;color:#8A5A00}.plmode.pl-demo i{background:#D99A06}'+
  '.plalm{border-left:5px solid var(--rose);padding:12px 14px;border-radius:var(--r-s);background:var(--panel);border-top:1px solid var(--edge);border-right:1px solid var(--edge);border-bottom:1px solid var(--edge);margin-bottom:10px}'+
  '.plalm.pl-warn{border-left-color:#D99A06}.plalm h4{margin:0 0 3px;font-size:16px}.plalm p{margin:0 0 6px;font-size:14px}.plalm ul{margin:4px 0 10px;padding-left:20px;font-size:14px}'+
  '.plalm .m{font-size:12.5px;color:var(--dim);margin-bottom:6px}.plalm .acts{display:flex;gap:8px;flex-wrap:wrap}'+
  '.pltiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}'+
  '.pltile{background:var(--deep);border:1.5px solid var(--edge);border-radius:var(--r-s);padding:9px 11px}'+
  '.pltile .l{font-size:12px;color:var(--dim)}.pltile .v{font-size:24px;font-weight:700;color:var(--text);line-height:1.15}.pltile .u{font-size:13px;color:var(--dim);margin-left:3px;font-weight:600}'+
  '.pltile.pl-bad{border-color:var(--rose);background:#FBEBE9}.pltile.pl-warn{border-color:#D99A06;background:#FBF1DC}'+
  '.plchart{position:relative;height:280px}.plchart svg{position:absolute;inset:0;width:100%;height:100%}'+
  '.pllegend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;margin:4px 0 8px}.pllegend i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:6px;vertical-align:middle}'+
  '.plfault{border-top:1px solid var(--edge);padding:10px 0}.plfault:first-child{border-top:0}.plfault summary{cursor:pointer;font-weight:700;font-size:14.5px}'+
  '.plfault ul{font-size:14px;padding-left:20px}.plk{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:6px;white-space:nowrap}'+
  '.plk.cyc{background:#FBF1DC;color:#8A5A00}.plk.saf{background:#FBEBE9;color:var(--rose)}'+
  '.pllog{font-size:13.5px}.pllog div{padding:6px 0;border-top:1px solid var(--edge)}.pllog div:first-child{border-top:0}'+
  '.plpts{width:100%;border-collapse:collapse;font-size:13.5px}.plpts td,.plpts th{padding:6px 4px;border-top:1px solid var(--edge);text-align:left}.plpts td.n{text-align:right;white-space:nowrap}'+
  '.plcode{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--deep);border:1px solid var(--edge);border-radius:8px;padding:10px;overflow-x:auto;white-space:pre}'+
  /* drawing */
  '.pl-flow{fill:none;stroke:#fff;stroke-width:3.5;stroke-linecap:round;stroke-dasharray:1 21;opacity:0;animation:plflow 1s linear infinite}.pl-flow.on{opacity:.9}'+
  '.pl-spin{transform-box:fill-box;transform-origin:center;animation:plspin 1s linear infinite}.pl-spin.stop{animation-play-state:paused}'+
  '.pl-rain{stroke:#9fd3ff;stroke-width:2;stroke-dasharray:5 9;animation:plrain .7s linear infinite}'+
  '.pl-halo{fill:none;stroke:#ff5a47;stroke-width:4;opacity:0;rx:18}.pl-halo.on{animation:plpulse 1.3s ease-in-out infinite}'+
  '.pl-halo.pl-warnh.on{stroke:#ffc53d}'+
  '@keyframes plflow{to{stroke-dashoffset:-22}}@keyframes plspin{to{transform:rotate(360deg)}}@keyframes plrain{to{stroke-dashoffset:-14}}'+
  '@keyframes plpulse{0%,100%{opacity:.25}50%{opacity:1}}@keyframes plblink{50%{opacity:.35}}'+
  /* enhanced plant motion */
  '#plFig path[id^="pl"]:not(.pl-flow){transition:stroke .9s ease}'+
  '.pl-steam{fill:#e8f1fb;opacity:0;transform-box:fill-box;transform-origin:center;animation:plsteam 3.2s ease-out infinite}'+
  '.pl-smoke{fill:#c9d3df;opacity:0;transform-box:fill-box;transform-origin:center;animation:plsmoke 2.6s ease-out infinite}'+
  '.pl-drop{fill:#9fd3ff;animation:pldrop .9s linear infinite}'+
  '.pl-splash{fill:none;stroke:#bfe4ff;stroke-width:1.2;opacity:0;transform-box:fill-box;transform-origin:center;animation:plsplash .9s ease-out infinite}'+
  '.pl-hum{animation:plhum .09s linear infinite}.pl-hum.stop{animation:none}'+
  '.pl-flame{transform-box:fill-box;transform-origin:50% 100%;animation:plflame .22s ease-in-out infinite alternate}'+
  '.pl-flame2{animation-duration:.31s;animation-delay:-.1s}.pl-flame3{animation-duration:.27s;animation-delay:-.2s}'+
  '.pl-beacon{opacity:0}.pl-beacon.on{animation:plbeacon .8s steps(2) infinite}'+
  '.pl-lampon{animation:pllamp 1.8s ease-in-out infinite}'+
  '.pl-sheen{animation:plsheen 1.6s linear infinite}.pl-sheen2{animation:plsheen2 4.5s ease-in-out infinite;opacity:.6}'+
  '.pl-star{fill:#fff;animation:pltw 3s ease-in-out infinite}'+
  '.pl-halo.on{animation:plpulse 1.3s ease-in-out infinite,plring 1.3s ease-in-out infinite}'+
  '.pltile{position:relative;overflow:hidden;transition:background .4s,border-color .4s}.pltile .sp{position:absolute;left:0;bottom:0;width:100%;height:26px;opacity:.55;pointer-events:none}'+
  '.pltile .l,.pltile .v,.pltile .u{position:relative}.pltile.tick .v{animation:pltick .7s ease}'+
  '.plchart .now{animation:plnow 1.6s ease-in-out infinite}'+
  '.plchart .draw{stroke-dasharray:1;stroke-dashoffset:1;animation:pldraw 1.1s cubic-bezier(.4,0,.2,1) forwards}'+
  '.plchart .area{opacity:0;animation:plfade .9s .4s forwards}'+
  '.plchart .xh{pointer-events:none}.pltip{position:absolute;pointer-events:none;background:#0f2240;color:#fff;font-size:12.5px;line-height:1.5;padding:7px 10px;border-radius:9px;box-shadow:0 6px 18px rgba(0,0,0,.25);white-space:nowrap;display:none;z-index:2}'+
  '.pltip i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px}'+
  '@keyframes plsteam{0%{opacity:0;transform:translate(0,0) scale(.5)}20%{opacity:.5}100%{opacity:0;transform:translate(14px,-46px) scale(1.9)}}'+
  '@keyframes plsmoke{0%{opacity:0;transform:translate(0,0) scale(.5)}25%{opacity:.45}100%{opacity:0;transform:translate(8px,-30px) scale(1.7)}}'+
  '@keyframes pldrop{from{transform:translateY(0)}to{transform:translateY(72px)}}'+
  '@keyframes plsplash{0%{opacity:.9;transform:scale(.2)}100%{opacity:0;transform:scale(1.6)}}'+
  '@keyframes plhum{0%{transform:translate(0,0)}25%{transform:translate(.6px,-.4px)}50%{transform:translate(-.5px,.5px)}75%{transform:translate(.4px,.3px)}}'+
  '@keyframes plflame{from{transform:scale(.86,.78)}to{transform:scale(1.06,1.12)}}'+
  '@keyframes plbeacon{50%{opacity:1}}@keyframes pllamp{0%,100%{opacity:1}50%{opacity:.55}}'+
  '@keyframes plsheen{from{transform:translateX(-60px)}to{transform:translateX(120px)}}@keyframes plsheen2{0%{transform:translateX(0)}60%,100%{transform:translateX(420px)}}'+
  '@keyframes pltw{0%,100%{opacity:.25}50%{opacity:1}}@keyframes plring{0%,100%{stroke-width:3}50%{stroke-width:7}}'+
  '@keyframes pltick{0%{color:var(--ice);transform:translateY(-2px)}100%{transform:none}}'+
  '@keyframes plnow{0%,100%{r:4;opacity:1}50%{r:7;opacity:.5}}@keyframes pldraw{to{stroke-dashoffset:0}}@keyframes plfade{to{opacity:1}}'+
  '@media(prefers-reduced-motion:reduce){.pl-flow,.pl-spin,.pl-rain,.pl-halo.on,.plmode.pl-live i,.pl-steam,.pl-smoke,.pl-drop,.pl-splash,.pl-hum,.pl-flame,.pl-beacon.on,.pl-lampon,.pl-sheen,.pl-sheen2,.pl-star,.plchart .draw,.plchart .area,.plchart .now{animation:none}.pl-halo.on,.pl-beacon.on,.plchart .area{opacity:1}.plchart .draw{stroke-dashoffset:0}}';
  document.head.appendChild(s);
})();

/* ================= reference data ================= */
const PL_SCEN=[
  ['normal','Normal day','Chiller on leaving chilled water control, tower tracking its setpoint, walk-in holding temperature.'],
  ['flow','Chilled water flow switch trip','Like 11/7 and 11/13: chilled water flow drops, the chiller trips on the flow switch, then restarts when flow comes back.'],
  ['lowtemp','Low temperature short cycling','Like the 10/19 history: light load drives leaving water to the cutout, the chiller trips, waits out anti-recycle, restarts, repeats.'],
  ['tower','Tower VFD ignoring the BAS','The drive runs 60 Hz on AI1 while the BAS signal reads 3%. Condenser water gets overcooled.'],
  ['lowdt','Low chilled water delta T','Like 10/13: 833 gpm and about a 3.5°F delta T. Points to 3-way valves, wide-open coil valves, or too much pump flow.'],
  ['walkin','Walk-in loses condenser water','Chiller off, the BAS stops the condenser water pump, and the water-cooled walk-in trips on head pressure.'],
  ['phx','PHX-1 free cooling with no flow','Like 11/13 and 11/14: PHX-1 on, its temperatures frozen, chilled water supply climbing, front of house warming.'],
  ['ahufan','Kitchen AHU fan failure','AHU-7 is commanded on but the supply fan never proves. Kitchen heat builds and the alarm goes critical.'],
  ['boiler','Boiler no-flow lockout','Like the Commons Raypak on 11/14: the hot water pump motor runs but the coupler is gone. No flow, the boiler locks out, and hot water supply falls.']
];
const PL_FAULTS=[
  ['LEAVING CHILLED LIQUID - FLOW SWITCH OPEN','c','The chilled water flow switch stayed open about 5 seconds while running, or never closed at the end of prelube. Restarts on its own once the switch closes.',['Building CHW pump running? Hz and amps at the drive, gpm on the BAS.','Changeover valves: in PHX-1 position the water can bypass the evaporator (11/7 trip).','Manual isolation valves, CHW strainer, air in the loop.','Flow switch paddle and wiring at the I/O board.']],
  ['LEAVING CHILLED LIQUID - LOW TEMPERATURE','c','Leaving chilled water fell below the low temperature cutout. Common at light load. Restarts once the water warms past the restart temperature and anti-recycle times out.',['Raise the LCHW restart offset (try 4 to 6°F).','Check the remote setpoint the BAS sends (AV 1 read 0) and narrow Remote Min/Max.','Vane and VGD response at low load. Raise hot gas bypass with Bruce.','Check the leaving water thermistor against a test thermometer.']],
  ['CONDENSER - FLOW SWITCH OPEN','c','After 30 seconds of running, the condenser flow switch stayed open about 5 seconds. Restarts when the switch closes.',['Condenser water pump running and proved.','Tower basin level, basin strainer, tower bypass valve.','Condenser flow switch and wiring.']],
  ['EVAPORATOR - LOW PRESSURE','c','Evaporator pressure dropped below the shutdown threshold. Three in 90 minutes locks out as a safety.',['Low chilled water flow or low load.','Low refrigerant charge: sight glass, leak check.','Condenser water too cold (under about 50°F).','Fouled evaporator tubes.']],
  ['LEAVING CONDENSER LIQUID - HIGH TEMPERATURE','c','Condenser water leaving the chiller is above the high limit.',['Tower fan running and the VFD following the BAS.','Tower fill, nozzles, scale.','Condenser flow and tower setpoint.']],
  ['CONDENSER - HIGH PRESSURE','s','Condenser pressure hit the high pressure safety. Manual reset after the cause is fixed.',['Condenser water flow and temperature, tower operation.','Fouled condenser tubes: plan a brushing.','Non-condensables in the system.']],
  ['MOTOR CONTROLLER - LOSS OF CURRENT','c','Motor current dropped out while the chiller should have been running (seen 10/22).',['Utility blip or power interruption.','Starter contactor and fault contacts.','Current module (CM-2) and CT wiring.']],
  ['MOTOR - LACK OF BEARING LUBRICATION','c','The motor bearing grease interval ran out. This chiller is near that shutdown.',['Check the Motor Lubrication screen hours.','Schedule York or a motor shop to grease the bearings.','Reset the timer only after greasing.']],
  ['OIL - LOW DIFFERENTIAL PRESSURE','s','Oil pump differential pressure is below the minimum. Manual reset.',['Oil level and oil temperature.','Oil filter differential.','Oil pump and its VSD.']],
  ['CONTROL PANEL - POWER FAILURE','c','Control power was lost. Whether it restarts depends on the auto-restart setting.',['Control power transformer and fuses.','History screen time vs utility events.']]
];
const PL_CHECKS={
  walkin:['Is the condenser water pump running? If off, start it and reset the walk-in high pressure control.','Keep the condenser pump on 24/7 until Northwest ties it to the walk-in call.'],
  tower:['At the ABB keypad: Hand/Off/Auto and the speed reference source.','AI1 wiring and scaling from the BAS output.','Do not change drive modes without knowing what it runs.'],
  coldcw:['Tower fan speed and bypass valve.','If PHX-1 is also running, check the changeover sequence.'],
  lowdt:['AHUs with CHW valves at 100% and satisfied spaces.','3-way coil valves bypassing water.','Building CHW pump speed.'],
  phx:['Pressure drop across the PHX-1 CHW side. None means no flow.','IR the PHX-1 piping and compare to the BAS.','Walk the changeover and isolation valves, check the strainer.','Consider disabling PHX-1 and letting the chiller carry the load.'],
  boiler:['Is the hot water pump shaft actually turning? Look through the coupler guard. A motor can run with a failed coupler.','Boiler display: error 59 or a no-flow code, flow reading at 0 gpm.','Isolation valves, strainer, and air in the loop.','Once flow is back, reset the boiler and watch supply climb toward setpoint.'],
  stale:['Is the gateway box powered and on the BAS network?','Can it reach the internet? Check the PLANT_INGEST_KEY on both ends.']
};
const PL_EQ={trip:'chiller',short:'chiller',walkin:'walk',tower:'tower',coldcw:'tower',lowdt:'bld',phx:'phx',boiler:'boil'};
const PL_TRENDS={
  chw:{n:'Chilled water',s:[['lchwt','Leaving CHW','#3d8fd6'],['chwr','Return CHW','#e0663a'],['chws','Supply to building','#8DB8E0']]},
  cw:{n:'Condenser water',s:[['ecwt','Cond to chiller','#2f8c94'],['lcwt','Cond from chiller','#e0663a'],['oa_wb','Outside wet bulb','#9aa3ad']]},
  tower:{n:'Tower drive vs BAS',s:[['tower_sig_hz','BAS signal (as Hz)','#2f8c94'],['tower_hz','Drive output Hz','#B8322A']]},
  motor:{n:'Motor % FLA',s:[['fla_pct','% FLA','#17325C']]},
  walkin:{n:'Walk-in cooler',s:[['walkin_temp','Walk-in box','#3d8fd6']]},
  hw:{n:'Heating hot water',s:[['hws','HW supply','#d2452b'],['hwr','HW return','#e9a23b']]}
};

/* ================= helpers ================= */
const plClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const plR=s=>(Math.random()-.5)*s;
const plF=(v,d=1)=>v==null||isNaN(v)?'?':(+v).toFixed(d);
const PL_R134=[[20,18.4],[30,26.1],[40,35],[50,45.4],[60,57.4],[70,71.1],[80,86.7],[90,104.3],[100,124.1],[110,146.3],[120,171.2]];
function plPsig(t){for(let i=1;i<PL_R134.length;i++){const[a,pa]=PL_R134[i-1],[b,pb]=PL_R134[i];if(t<=b)return pa+(pb-pa)*(t-a)/(b-a)}return 171}
function plClock(m){const h=Math.floor(m/60)%24,mm=Math.floor(m%60);return(h%12||12)+':'+String(mm).padStart(2,'0')+(h<12?' AM':' PM')}
function plAgo(ts){if(!ts)return'never';const m=Math.round((Date.now()-Date.parse(ts))/60000);return m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' hr ago'}
function plTime(ts){try{return new Date(ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}catch(e){return ts}}
// water temperature to pipe colour: 40°F blue, 60°F teal, 85°F orange
function plTc(t){
  if(t==null||isNaN(t))return'#5d6b7d';
  const stops=[[38,[52,132,214]],[55,[78,170,196]],[68,[86,176,160]],[80,[232,150,70]],[95,[226,92,52]]];
  if(t<=stops[0][0])return'rgb('+stops[0][1]+')';
  for(let i=1;i<stops.length;i++){const[a,ca]=stops[i-1],[b,cb]=stops[i];if(t<=b){const k=(t-a)/(b-a);return'rgb('+ca.map((c,j)=>Math.round(c+(cb[j]-c)*k)).join(',')+')'}}
  return'rgb('+stops[stops.length-1][1]+')';
}

/* ================= demo simulation ================= */
function plSimReset(){
  PLSIM={t:300,st:0,run:true,fault:'',starts:[200],ar:0,lchw:44,chwr:52,chws:44.4,flow:480,ecwt:78,lcwt:86,oaDb:65,oaWb:58,sig:55,hz:33,fla:60,walk:36,cwp:true,chwp:true,phx:false,phxIn:57.5,phxOut:52.7,load:150,sp:44,hws:150,hwr:136,hwp:true,hwFlow:60,b1:0,b2:0,bLock:false};
  PLHIST=[];PLDEMO_ALM={};PLDEMO_LOG=[];PLDEMO_ACK=new Set();
  if(typeof ahuSimReset==='function')ahuSimReset();
  if(typeof eqSimReset==='function')eqSimReset();
  const keep=PLSCEN;PLSCEN='normal';for(let i=0;i<240;i++)plStep(true);PLSCEN=keep;PLSIM.st=0;
}
function plStep(warm){
  const s=PLSIM,sc=PLSCEN,st=s.st;s.t++;s.st++;
  const hr=(s.t/60)%24;
  s.oaDb=66+11*Math.sin((hr-9)/24*2*Math.PI)+plR(.4);s.oaWb=s.oaDb-7+plR(.3);
  if(sc==='phx'){s.oaDb=50+plR(.4);s.oaWb=44+plR(.3)}
  s.load=plClamp(40+(s.oaDb-55)*7,20,220)+plR(4);
  if(sc==='lowtemp')s.load=24+plR(2);
  s.flow=480+plR(6);s.chwp=true;s.cwp=true;s.phx=false;
  if(sc==='lowdt'){s.flow=833+plR(6);s.load=121+plR(4)}
  if(sc==='flow'&&st%90>=20&&st%90<30)s.flow=Math.max(0,s.flow*(st%90<22?.4:.02));
  if(sc==='walkin'){s.run=false;s.fault='';s.cwp=false}
  if(sc==='phx'){s.run=false;s.fault='';s.phx=true}
  // operator overrides from the Controls screen (demo)
  const O=s.ov||{};
  if(O.chw_pump===0){s.chwp=false;s.flow=0}else if(O.chw_pump===1)s.chwp=true;
  if(O.cw_pump===0)s.cwp=false;else if(O.cw_pump===1)s.cwp=true;
  if(O.chiller_en===0&&s.run){s.run=false;plDemoLog('Chiller stopped: enable turned off from Controls')}
  if(s.ar>0)s.ar--;
  if(s.run){
    if(s.flow<150)plTrip('LEAVING CHILLED LIQUID - FLOW SWITCH OPEN');
    else if(s.lchw<40)plTrip('LEAVING CHILLED LIQUID - LOW TEMPERATURE');
  }else if(s.fault){
    const ok=s.fault.indexOf('FLOW')>=0?s.flow>300:s.lchw>s.sp+2;
    if(ok&&s.ar===0)plStart();
  }else if(sc!=='walkin'&&sc!=='phx'&&O.chiller_en!==0)plStart();
  const dT=s.flow>50?s.load*24/s.flow:0;
  if(s.run){
    if(sc==='lowtemp')s.lchw+=-0.35+plR(.05);else s.lchw+=(s.sp-s.lchw)*.25+plR(.15);
    s.fla=plClamp(25+70*s.load/220,20,100)+plR(1.5);
  }else{s.lchw+=(54-s.lchw)*.08+plR(.1);s.fla=0}
  s.chwr=s.lchw+dT+(s.run?0:.2);s.chws=s.lchw+.4;
  if(sc==='phx'){s.chws=Math.min(56,(s._chws||46)+.09);s._chws=s.chws;s.lchw=s.chws-.4;s.chwr=s.chws+2.2}else s._chws=0;
  const tsp=Math.max(s.twMin==null?70:s.twMin,s.oaWb+(s.appr==null?5:s.appr)),target=s.run||s.phx?tsp:s.oaDb-3;
  s.sig+=(plClamp((s.ecwt-tsp)*22+50,0,100)-s.sig)*.3;
  if(O.tower_fan_sig!=null)s.sig=O.tower_fan_sig;
  if(O.tower_fan_en===0)s.sig=0;
  if(sc==='tower'){s.sig=3+plR(.5);s.hz=60;s.ecwt+=((s.oaWb+3)-s.ecwt)*.08}
  else{s.hz=plClamp(s.sig*.6,0,60)+plR(.3);if(s.hz<0)s.hz=0;
    // with the fan held, water temperature follows fan speed, not the setpoint
    const tgt=O.tower_fan_sig!=null||O.tower_fan_en===0?s.oaWb+3+(1-s.hz/60)*16:target;
    s.ecwt+=((s.run||s.phx?tgt:target)-s.ecwt)*.15+plR(.2)}
  s.lcwt=s.ecwt+(s.run?3+7*s.load/220:.4);
  if(sc==='walkin')s.walk=Math.min(55,s.walk+.13+plR(.02));else s.walk+=(36-s.walk)*.2+plR(.25);
  // heating hot water: outdoor reset, lead/lag boilers on firing rate
  const hwMax=s.hwMax==null?160:s.hwMax,hwSp=plClamp(hwMax-(s.oaDb-40)*1.1,Math.min(120,hwMax),hwMax);
  s.hwp=O.hw_pump!==0;s.hwFlow=s.hwp?60+plR(1.5):0;
  if((sc==='boiler'&&st>=8)||!s.hwp){s.hwFlow=0;s.bLock=true}else s.bLock=false;
  const need=plClamp((hwSp-s.hws)*9+(78-s.oaDb)*2.2+18,0,100);
  if(s.bLock||O.boiler_en===0){s.b1=0;s.b2=0}
  else{s.b1+=(Math.min(need,100)-s.b1)*.35;s.b2+=((need>70?(need-70)*3:0)-s.b2)*.35;s.b1=plClamp(s.b1+plR(1),0,100);s.b2=plClamp(s.b2,0,100);if(s.b2<4)s.b2=0}
  const heat=(s.b1+s.b2)*.05;
  s.hws+=heat-(s.hws-70)*.012-(s.bLock?.9:0)+plR(.15);s.hws=plClamp(s.hws,58,185);
  s.hwr=s.bLock?Math.max(58,s.hwr+(s.hws-4-s.hwr)*.1):s.hws-(6+s.b1*.08+s.b2*.06)+plR(.2);
  if(sc!=='phx'){s.phxIn=s.lchw+1.5;s.phxOut=s.lchw}
  else{s.phxIn=57.5;s.phxOut=52.7}
  const ms=Date.now()-(PLHIST.length?0:0);
  PLHIST.push({t:s.t,lchwt:s.lchw,chwr:s.chwr,chws:s.chws,ecwt:s.ecwt,lcwt:s.lcwt,oa_wb:s.oaWb,tower_sig_hz:s.sig*.6,tower_hz:s.hz,fla_pct:s.fla,walkin_temp:s.walk,hws:s.hws,hwr:s.hwr,chw_gpm:s.flow});
  if(PLHIST.length>1440)PLHIST.shift();
  if(typeof ahuSimStep==='function')ahuSimStep(s);
  if(typeof eqSimStep==='function')eqSimStep(s);
  if(!warm)plDemoAlarms();
}
function plTrip(m){PLSIM.run=false;PLSIM.fault=m;plDemoLog('Chiller tripped: '+m)}
function plStart(){const s=PLSIM;if(s.fault)plDemoLog('Chiller restarted after '+s.fault.toLowerCase());s.run=true;s.fault='';s.starts.push(s.t);s.starts=s.starts.filter(x=>x>s.t-240);s.ar=30}
function plDemoLog(m){if(!PLSIM)return;PLDEMO_LOG.unshift({t:plClock(PLSIM.t),m});PLDEMO_LOG=PLDEMO_LOG.slice(0,60)}

/* One view model, from the simulation or from the server. */
function plView(){
  if(PLMODE==='demo'){
    const s=PLSIM;
    return {run:s.run,fault:s.fault,lchw:s.lchw,chwr:s.chwr,chws:s.chws,flow:s.flow,ecwt:s.ecwt,lcwt:s.lcwt,evap:s.run?plPsig(s.lchw-3):plPsig(s.lchw),cond:plPsig(s.lcwt+2),
      fla:s.fla,sig:s.sig,hz:s.hz,oaDb:s.oaDb,oaWb:s.oaWb,cwp:s.cwp,chwp:s.chwp,phx:s.phx,phxIn:s.phxIn,phxOut:s.phxOut,walk:s.walk,
      hws:s.hws,hwr:s.hwr,hwp:s.hwp,hwFlow:s.hwFlow,b1:s.b1,b2:s.b2,bLock:s.bLock,hour:(s.t/60)%24,
      starts1h:s.starts.filter(x=>x>s.t-60).length,starts2h:s.starts.filter(x=>x>s.t-120).length,clock:plClock(s.t)};
  }
  const v={};(PL.points||[]).forEach(p=>v[p.key]=p);
  const n=k=>v[k]&&v[k].value!=null?+v[k].value:null, b=k=>n(k)===1;
  return {run:b('comp_running'),fault:v.fault_text&&v.fault_text.text?v.fault_text.text:'',lchw:n('lchwt'),chwr:n('chwr')!=null?n('chwr'):n('echwt'),chws:n('chws'),flow:n('chw_gpm'),
    ecwt:n('ecwt'),lcwt:n('lcwt'),evap:n('evap_psi'),cond:n('cond_psi'),fla:n('fla_pct'),sig:n('tower_signal'),hz:n('tower_hz'),oaDb:n('oa_db'),oaWb:n('oa_wb'),
    cwp:b('cw_pump'),chwp:b('chw_pump'),phx:b('phx_on'),hws:n('hws'),hwr:n('hwr'),hwp:b('hw_pump'),hwFlow:n('hw_gpm'),b1:n('boiler1_fire')!=null?n('boiler1_fire'):(b('boiler1_on')?60:null),b2:n('boiler2_fire')!=null?n('boiler2_fire'):(b('boiler2_on')?60:null),bLock:false,hour:new Date().getHours()+new Date().getMinutes()/60,phxIn:n('phx_chw_in'),phxOut:n('phx_chw_out'),walk:n('walkin_temp'),
    starts1h:PL.starts_1h,starts2h:PL.starts_2h,clock:PL.last_ts?'Updated '+plAgo(PL.last_ts):'No data yet'};
}

/* Demo alarm rules: same rules the server runs on live data. */
function plRules(V){
  const out=[], dt=V.chwr!=null&&V.lchw!=null?V.chwr-V.lchw:null;
  if(V.fault)out.push({rule:'trip',level:'critical',equipment:'Chiller (York YK)',title:'Chiller shutdown: '+V.fault,detail:'Leaving chilled water '+plF(V.lchw)+'°F, flow '+Math.round(V.flow||0)+' gpm.',fault:V.fault});
  if(V.starts2h>=4)out.push({rule:'short',level:'warn',equipment:'Chiller (York YK)',title:'Chiller short cycling',detail:V.starts2h+' starts in the last 2 hours.',fault:'LEAVING CHILLED LIQUID - LOW TEMPERATURE'});
  if(V.walk>41)out.push({rule:'walkin',level:'critical',equipment:'Walk-in cooler',title:'Walk-in cooler above 41°F',detail:'Box at '+plF(V.walk)+'°F. Condenser water pump is '+(V.cwp?'on':'off')+'. Tell the chef so product can be moved.'});
  if(V.sig!=null&&V.hz!=null&&Math.abs(V.sig*.6-V.hz)>10)out.push({rule:'tower',level:'warn',equipment:'Tower VFD 505002',title:'Tower VFD not following the BAS',detail:'BAS signal '+Math.round(V.sig)+'% (about '+Math.round(V.sig*.6)+' Hz) but the drive runs '+Math.round(V.hz)+' Hz.'});
  if(V.run&&V.ecwt<55)out.push({rule:'coldcw',level:'warn',equipment:'Condenser water',title:'Condenser water too cold for the chiller',detail:'Entering condenser water '+plF(V.ecwt)+'°F.'});
  if(V.run&&V.fla>45&&V.flow>300&&dt!=null&&dt<5)out.push({rule:'lowdt',level:'warn',equipment:'Chilled water loop',title:'Low chilled water delta T',detail:'Delta T '+dt.toFixed(1)+'°F at '+Math.round(V.flow)+' gpm.'});
  if(typeof plAhuRules==='function')out.push(...plAhuRules(V));
  if(typeof plEqRules==='function')out.push(...plEqRules(V));
  if(V.hws!=null&&V.hws<120&&(PLMODE==='live'?V.hwp:(V.bLock||(V.hwFlow!=null&&V.hwFlow<5))))out.push({rule:'boiler',level:'critical',equipment:'Boilers B-1 / B-2',title:'Hot water supply low: boilers not making heat',detail:'HW supply '+plF(V.hws)+'°F, flow '+(V.hwFlow==null?'?':Math.round(V.hwFlow)+' gpm')+'. Hot decks and fan coils on this loop lose heat.'});
  if(V.phx&&V.chws>50)out.push({rule:'phx',level:'critical',equipment:'PHX-1 heat exchanger',title:'PHX-1 on but chilled water is not cooling',detail:'CHW supply '+plF(V.chws)+'°F and climbing. PHX-1 CHW in/out '+plF(V.phxIn)+'/'+plF(V.phxOut)+'°F, not changing.'});
  return out;
}
function plDemoAlarms(){
  const now=plRules(plView()),ids=new Set(now.map(a=>a.rule));
  now.forEach(a=>{if(!PLDEMO_ALM[a.rule]){PLDEMO_ALM[a.rule]=Object.assign({id:'d-'+a.rule,started:plClock(PLSIM.t)},a);plDemoLog('Alarm: '+a.title)}else Object.assign(PLDEMO_ALM[a.rule],{detail:a.detail})});
  Object.keys(PLDEMO_ALM).forEach(r=>{if(!ids.has(r)){plDemoLog('Cleared: '+PLDEMO_ALM[r].title);delete PLDEMO_ALM[r];PLDEMO_ACK.delete('d-'+r)}});
}
function plAlarms(){
  if(PLMODE==='demo')return Object.values(PLDEMO_ALM).map(a=>Object.assign({},a,{acked:PLDEMO_ACK.has(a.id),since:a.started}));
  return (PL.alarms||[]).map(a=>Object.assign({},a,{acked:!!a.acked_by,since:plTime(a.started_at)}));
}

/* ================= the drawing ================= */
function plBadge(id,x,y,w,cap){
  return '<g id="'+id+'" transform="translate('+x+','+y+')"><rect width="'+w+'" height="46" rx="10" fill="#0b1a33" fill-opacity=".86" stroke="#ffffff" stroke-opacity=".14"/>'+
    '<text x="12" y="17" font-size="12" fill="#a9bdd6" font-weight="600">'+cap+'</text><text class="v" x="12" y="38" font-size="18" fill="#fff" font-weight="800">--</text></g>';
}
function plPipe(id,d){
  return '<path d="'+d+'" fill="none" stroke="#071226" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<path id="'+id+'" d="'+d+'" fill="none" stroke="#5d6b7d" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<path d="'+d+'" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3" stroke-linejoin="round" transform="translate(0,-2.5)"/>'+
    '<path id="'+id+'F" class="pl-flow" d="'+d+'"/>';
}
function plPump(id,cx,cy,label){
  return '<g id="'+id+'"><rect x="'+(cx-34)+'" y="'+(cy+22)+'" width="68" height="9" rx="2" fill="#2b3b52"/>'+
    '<rect x="'+(cx-14)+'" y="'+(cy-64)+'" width="28" height="40" rx="5" fill="url(#plMetal)" stroke="#0b1a33"/>'+
    [0,1,2,3,4].map(i=>'<line x1="'+(cx-14)+'" x2="'+(cx+14)+'" y1="'+(cy-58+i*7)+'" y2="'+(cy-58+i*7)+'" stroke="#0b1a33" stroke-opacity=".35"/>').join('')+
    '<rect x="'+(cx-9)+'" y="'+(cy-26)+'" width="18" height="8" fill="#e0a83b"/>'+
    '<circle cx="'+cx+'" cy="'+cy+'" r="24" fill="url(#plSteel)" stroke="#0b1a33" stroke-width="2"/>'+
    '<g class="pl-spin stop" id="'+id+'Imp"><circle cx="'+cx+'" cy="'+cy+'" r="15" fill="#22344d"/>'+
    [0,120,240].map(a=>'<path d="M'+cx+' '+cy+' q8 -4 13 -12" stroke="#9fb4cc" stroke-width="3" fill="none" transform="rotate('+a+' '+cx+' '+cy+')"/>').join('')+'</g>'+
    '<circle id="'+id+'Lamp" cx="'+(cx+22)+'" cy="'+(cy-60)+'" r="5" fill="#5d6b7d" stroke="#0b1a33"/>'+
    '<text x="'+cx+'" y="'+(cy+50)+'" text-anchor="middle" font-size="13" font-weight="700" fill="#cfdcec">'+label+'</text></g>';
}
function plBoiler(id,x,y,label){
  const fl=(cls,d,fill)=>'<path class="pl-flame '+cls+'" d="'+d+'" fill="'+fill+'"/>';
  return '<g id="'+id+'" filter="url(#plShadow)">'+
    // flue stack and smoke
    '<rect x="'+(x+48)+'" y="'+(y-22)+'" width="16" height="24" fill="url(#plMetal)" stroke="#55657a"/>'+
    '<rect x="'+(x+45)+'" y="'+(y-26)+'" width="22" height="6" rx="2" fill="#7d8b9c"/>'+
    '<g id="'+id+'Smoke" style="opacity:0;transition:opacity 1s">'+[0,1,2].map(i=>'<circle class="pl-smoke" style="animation-delay:'+(i*.85)+'s" cx="'+(x+56)+'" cy="'+(y-30)+'" r="6"/>').join('')+'</g>'+
    // cabinet
    '<rect x="'+x+'" y="'+y+'" width="84" height="96" rx="8" fill="url(#plBoilerG)" stroke="#0b1a33" stroke-width="2"/>'+
    '<rect x="'+(x+6)+'" y="'+(y+6)+'" width="72" height="20" rx="4" fill="#0b1a33"/>'+
    '<text x="'+(x+12)+'" y="'+(y+20)+'" font-size="11" font-weight="800" fill="#fff">'+label+'</text>'+
    '<text id="'+id+'Pct" x="'+(x+72)+'" y="'+(y+20)+'" text-anchor="end" font-size="11" font-weight="800" fill="#7f97b5">OFF</text>'+
    // flame window
    '<rect x="'+(x+16)+'" y="'+(y+34)+'" width="52" height="40" rx="6" fill="#120a05" stroke="#55657a" stroke-width="2"/>'+
    '<clipPath id="'+id+'Clip"><rect x="'+(x+18)+'" y="'+(y+36)+'" width="48" height="36" rx="5"/></clipPath>'+
    '<g clip-path="url(#'+id+'Clip)"><rect id="'+id+'Glow" x="'+(x+16)+'" y="'+(y+34)+'" width="52" height="40" fill="url(#plFireGlow)" opacity="0" style="transition:opacity .8s"/>'+
     '<g id="'+id+'Fire" style="opacity:0;transition:opacity .6s">'+
      [0,1,2,3].map(i=>{const cx=x+24+i*12;return fl(['','pl-flame2','pl-flame3',''][i],'M'+(cx-6)+' '+(y+72)+' Q'+(cx-7)+' '+(y+58)+' '+cx+' '+(y+44)+' Q'+(cx+7)+' '+(y+58)+' '+(cx+6)+' '+(y+72)+'Z','url(#plFlame)')}).join('')+
      [0,1,2,3].map(i=>{const cx=x+24+i*12;return '<path class="pl-flame pl-flame3" d="M'+(cx-3)+' '+(y+72)+' Q'+cx+' '+(y+60)+' '+(cx+3)+' '+(y+72)+'Z" fill="#7fc4ff" opacity=".85"/>'}).join('')+
     '</g></g>'+
    '<rect x="'+(x+16)+'" y="'+(y+70)+'" width="52" height="3" fill="#3d6fd6" opacity=".8"/>'+
    '<circle id="'+id+'Led" cx="'+(x+14)+'" cy="'+(y+84)+'" r="4" fill="#5d6b7d"/>'+
    '<rect x="'+(x+24)+'" y="'+(y+80)+'" width="50" height="7" rx="3.5" fill="#0b1a33"/><rect id="'+id+'Bar" x="'+(x+24)+'" y="'+(y+80)+'" width="0" height="7" rx="3.5" fill="#ff8a3d" style="transition:width .9s"/>'+
  '</g>';
}
function plSvg(){
  const louv=[];for(let y=160;y<=220;y+=8)louv.push('<line x1="'+(78-(y-86)*.08)+'" x2="'+(242+(y-86)*.08)+'" y1="'+y+'" y2="'+y+'" stroke="#55657a" stroke-width="3"/>');
  const rain=[];for(let x=92;x<=228;x+=12)rain.push('<line class="pl-rain" x1="'+x+'" x2="'+x+'" y1="'+(150+((x*7)%9))+'" y2="226"/>');
  const plates=[];for(let x=536;x<=602;x+=5)plates.push('<rect x="'+x+'" y="512" width="4" height="80" fill="'+(x%10?'#b7c3d1':'#93a1b2')+'"/>');
  const wins=[];[[120,0],[160,1]].forEach(([y,r])=>[0,1,2,3,4,5].forEach(i=>{const x=988+i*27+(i>2?18:0);wins.push('<rect class="plWin" x="'+x+'" y="'+y+'" width="14" height="'+(r?22:20)+'" rx="2" fill="#ffe7a6"/>')}));
  const blades=[0,90,180,270].map(a=>'<path d="M0 0 C 10 -14, 44 -16, 56 -4 C 40 2, 12 4, 0 0Z" fill="#c7d3e0" transform="rotate('+a+')"/>').join('');
  const stars=[];for(let i=0;i<40;i++){const hx=Math.sin(i*12.9898)*43758.5453,hy=Math.sin(i*78.233)*12543.17,x=Math.round((hx-Math.floor(hx))*1190)+5,y=Math.round((hy-Math.floor(hy))*200)+6;if(x>460&&x<800&&y<100)continue;stars.push('<circle class="pl-star" cx="'+x+'" cy="'+y+'" r="'+(i%3?1:1.6)+'" style="animation-delay:'+((i*.37)%3).toFixed(2)+'s"/>')}
  const drops=[];for(let i=0;i<16;i++){const x=88+i*9.5;drops.push('<circle class="pl-drop" cx="'+x.toFixed(1)+'" cy="'+(148+(i*7)%12)+'" r="1.8" style="animation-duration:'+(.62+(i*13)%7*.06).toFixed(2)+'s;animation-delay:-'+((i*.29)%.9).toFixed(2)+'s"/>')}
  const spl=[];for(let i=0;i<6;i++)spl.push('<ellipse class="pl-splash" cx="'+(96+i*26)+'" cy="235" rx="7" ry="2" style="animation-delay:'+(i*.17).toFixed(2)+'s"/>');
  return '<svg viewBox="0 0 1200 772" role="img" aria-label="Central plant drawing: cooling tower, York chiller, pumps, PHX-1, boilers, clubhouse and walk-in">'+
  '<defs>'+
   '<linearGradient id="plBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18345f"/><stop offset="1" stop-color="#0d1e3a"/></linearGradient>'+
   '<pattern id="plGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>'+
   '<linearGradient id="plMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ee"/><stop offset=".5" stop-color="#9eacbd"/><stop offset="1" stop-color="#6c7a8c"/></linearGradient>'+
   '<radialGradient id="plSteel" cx=".35" cy=".3"><stop offset="0" stop-color="#c9d4e1"/><stop offset="1" stop-color="#55657a"/></radialGradient>'+
   '<linearGradient id="plShell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb0b7"/><stop offset=".45" stop-color="#2d7f86"/><stop offset="1" stop-color="#174b51"/></linearGradient>'+
   '<linearGradient id="plBox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8f95"/><stop offset="1" stop-color="#15444a"/></linearGradient>'+
   '<linearGradient id="plTower" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#aeb9c7"/><stop offset=".55" stop-color="#d6dde6"/><stop offset="1" stop-color="#8f9cad"/></linearGradient>'+
   '<linearGradient id="plStone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4efe4"/><stop offset="1" stop-color="#d9d0bf"/></linearGradient>'+
   '<linearGradient id="plFlame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a1f"/><stop offset=".45" stop-color="#ffa62b"/><stop offset=".85" stop-color="#ffe28a"/><stop offset="1" stop-color="#fff6d0" stop-opacity="0"/></linearGradient>'+
   '<radialGradient id="plFireGlow" cx=".5" cy=".9" r=".9"><stop offset="0" stop-color="#ff9a3d" stop-opacity=".9"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>'+
   '<linearGradient id="plBoilerG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c94a35"/><stop offset=".5" stop-color="#a6382a"/><stop offset="1" stop-color="#6e2219"/></linearGradient>'+
   '<linearGradient id="plSheenG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'+
   '<radialGradient id="plSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".6" stop-color="#ffc84a"/><stop offset="1" stop-color="#ffc84a" stop-opacity="0"/></radialGradient>'+
   '<filter id="plGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
   '<filter id="plShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".35"/></filter>'+
  '</defs>'+
  '<rect width="1200" height="772" fill="url(#plBg)"/>'+
  '<rect id="plNight" width="1200" height="772" fill="#040b1a" opacity="0" style="transition:opacity 2s"/>'+
  '<g id="plStars" style="opacity:0;transition:opacity 2s">'+stars.join('')+'</g>'+
  '<rect width="1200" height="772" fill="url(#plGrid)"/>'+
  // sky glow behind clubhouse
  
  // mechanical room
  '<rect x="236" y="186" width="736" height="424" rx="20" fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".1" stroke-dasharray="6 6"/>'+
  '<text x="252" y="208" font-size="12.5" font-weight="700" fill="#7f97b5" letter-spacing=".5">MECHANICAL ROOM</text>'+
  // outside chip
  '<g transform="translate(480,34)"><rect width="300" height="54" rx="12" fill="#0b1a33" fill-opacity=".7" stroke="#fff" stroke-opacity=".12"/>'+
   '<text x="16" y="22" font-size="12" font-weight="600" fill="#a9bdd6">Outside</text><text id="plOa" x="16" y="44" font-size="19" font-weight="800" fill="#fff">--</text>'+
   '<text id="plFree" x="284" y="22" text-anchor="end" font-size="12" font-weight="700" fill="#7fd8a6"></text>'+
   '<g id="plSunG" transform="translate(268,38)" style="transition:opacity 1.5s"><circle r="13" fill="url(#plSun)"/><circle r="6" fill="#ffd25e"/></g>'+
   '<g id="plMoonG" transform="translate(268,38)" style="opacity:0;transition:opacity 1.5s"><path d="M3 -8 A9 9 0 1 0 6 6 A7 7 0 1 1 3 -8Z" fill="#e6ecf7"/></g></g>'+
  // boiler room
  '<rect x="236" y="628" width="914" height="136" rx="18" fill="#ff7a3d" fill-opacity=".04" stroke="#ffb08a" stroke-opacity=".16" stroke-dasharray="6 6"/>'+
  '<text x="252" y="650" font-size="12.5" font-weight="700" fill="#b58f80" letter-spacing=".5">BOILER ROOM · HEATING HOT WATER</text>'+
  plPipe('plHwr','M1158 170 H1192 V752 H600 V690 H640')+plPipe('plHwx','M724 690 H760')+
  plPipe('plHws','M844 690 H936')+plPipe('plHws2','M984 690 H1176 V200 H1158')+
  // pipes (drawn in flow direction)
  plPipe('plCws','M160 250 V470 H276')+plPipe('plCws2','M324 470 H380 V338 H420')+
  plPipe('plCwr','M420 300 H310 V80 H262')+
  plPipe('plWalkP','M230 470 V522 H214')+
  plPipe('plChs','M806 390 H870 V470 H876')+plPipe('plChs2','M924 470 H1060 V234')+
  plPipe('plChr','M1120 234 V560 H840 V425 H806')+
  plPipe('plPxc','M380 470 V540 H522')+plPipe('plPxh','M618 560 H840')+
  // valves
  '<g id="plV1" transform="translate(380,505)"><path d="M-12 -10 L12 10 L12 -10 L-12 10Z" fill="#5d6b7d" stroke="#0b1a33" stroke-width="2" transform="rotate(90)"/><rect x="-3" y="-22" width="6" height="12" fill="#9fb4cc"/></g>'+
  '<g id="plV2" transform="translate(730,560)"><path d="M-12 -10 L12 10 L12 -10 L-12 10Z" fill="#5d6b7d" stroke="#0b1a33" stroke-width="2"/><rect x="-3" y="-22" width="6" height="12" fill="#9fb4cc"/></g>'+
  // cooling tower
  '<g filter="url(#plShadow)">'+
   '<path d="M80 86 H240 L254 232 H66 Z" fill="url(#plTower)" stroke="#55657a" stroke-width="2"/>'+
   '<line x1="125" y1="88" x2="120" y2="150" stroke="#8592a3"/><line x1="195" y1="88" x2="200" y2="150" stroke="#8592a3"/>'+
   '<rect x="72" y="150" width="176" height="78" fill="#2a3a50"/>'+louv.join('')+
   '<g id="plRain" style="transition:opacity .8s">'+rain.join('')+drops.join('')+spl.join('')+'</g>'+
   '<rect x="58" y="228" width="204" height="24" rx="5" fill="#33445c" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="62" y="232" width="196" height="6" rx="3" fill="#4f8fc8" opacity=".75"/>'+
   '<rect x="98" y="56" width="124" height="32" fill="url(#plMetal)" stroke="#55657a" stroke-width="2"/>'+
   '<ellipse cx="160" cy="88" rx="62" ry="8" fill="#7d8b9c"/>'+
   '<ellipse cx="160" cy="56" rx="62" ry="13" fill="#1a2a40" stroke="#55657a" stroke-width="2"/>'+
   '<g transform="translate(160,56) scale(1,.21)"><g id="plFan" class="pl-spin stop">'+blades+'<circle r="9" fill="#55657a"/></g><circle id="plFanBlur" r="56" fill="#c7d3e0" opacity="0" style="transition:opacity .8s"/></g>'+
   '<g id="plSteam" style="opacity:0;transition:opacity 1.5s">'+[0,1,2,3,4].map(i=>'<circle class="pl-steam" style="animation-delay:'+(i*.64).toFixed(2)+'s" cx="'+(132+i*14)+'" cy="44" r="'+(9+i%2*3)+'"/>').join('')+'</g>'+
   '<text x="160" y="124" text-anchor="middle" font-size="15" font-weight="800" fill="#33445c">CT-1</text>'+
  '</g>'+
  plBadge('plBTower',6,262,148,'Tower fan')+
  // walk-in
  '<g filter="url(#plShadow)">'+
   '<rect x="48" y="500" width="166" height="104" rx="6" fill="#e9eef3" stroke="#8b98a8" stroke-width="2"/>'+
   [90,132,174].map(x=>'<line x1="'+x+'" y1="502" x2="'+x+'" y2="602" stroke="#c3ccd7"/>').join('')+
   '<rect x="70" y="516" width="58" height="80" rx="3" fill="#d7dee6" stroke="#8b98a8"/><rect x="118" y="548" width="6" height="18" rx="2" fill="#55657a"/>'+
   '<rect id="plWalkFrost" x="48" y="500" width="166" height="104" rx="6" fill="#bfe6ff" opacity=".0"/>'+
   '<rect x="136" y="520" width="70" height="44" rx="6" fill="#0b1a33"/><text id="plWalkT" x="171" y="550" text-anchor="middle" font-size="19" font-weight="800" fill="#7fd8a6">--</text>'+
   '<rect x="214" y="510" width="22" height="26" rx="3" fill="url(#plMetal)" stroke="#55657a"/>'+
   '<text x="131" y="616" text-anchor="middle" font-size="12.5" font-weight="700" fill="#cfdcec">Walk-in cooler</text>'+
  '</g>'+
  // pumps
  plPump('plCwp',300,470,'CW pump')+plPump('plChp',900,470,'CHW pump')+
  // chiller
  '<g id="plChiller" filter="url(#plShadow)">'+
   [470,560,690,770].map(x=>'<rect x="'+(x-8)+'" y="440" width="16" height="34" fill="#2b3b52"/>').join('')+
   '<rect x="436" y="368" width="352" height="78" rx="39" fill="url(#plShell)" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="420" y="364" width="30" height="86" rx="7" fill="url(#plBox)" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="776" y="362" width="32" height="90" rx="7" fill="url(#plBox)" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="448" y="288" width="324" height="66" rx="33" fill="url(#plShell)" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect id="plCondTint" x="448" y="288" width="324" height="66" rx="33" fill="#ff8a3d" opacity="0" style="transition:opacity 1.2s"/>'+
   '<rect id="plEvapTint" x="436" y="368" width="352" height="78" rx="39" fill="#7fc4ff" opacity="0" style="transition:opacity 1.2s"/>'+
   '<clipPath id="plShellClip"><rect x="448" y="288" width="324" height="66" rx="33"/><rect x="436" y="368" width="352" height="78" rx="39"/></clipPath>'+
   '<g clip-path="url(#plShellClip)"><g id="plShellSheen" style="opacity:0;transition:opacity 1s"><rect class="pl-sheen pl-sheen2" x="400" y="280" width="70" height="180" fill="url(#plSheenG)"/></g></g>'+
   '<g id="plComp" class="pl-hum stop">'+
   '<rect x="420" y="282" width="32" height="78" rx="7" fill="url(#plBox)" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="770" y="286" width="20" height="70" rx="6" fill="url(#plBox)" stroke="#0b1a33" stroke-width="2"/>'+
   // compressor and motor
   '<path d="M565 288 V276" stroke="#55657a" stroke-width="16"/>'+
   '<circle cx="565" cy="246" r="38" fill="url(#plSteel)" stroke="#0b1a33" stroke-width="2"/>'+
   '<path d="M546.6 264.4 A26 26 0 1 1 583.4 264.4" fill="none" stroke="#33445c" stroke-width="6" stroke-linecap="round"/>'+
   '<path id="plFlaArc" d="M546.6 264.4 A26 26 0 1 1 583.4 264.4" fill="none" stroke="#4ee08f" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" style="transition:stroke-dasharray .9s,stroke .6s"/>'+
   '<text id="plFlaTxt" x="565" y="251" text-anchor="middle" font-size="13" font-weight="800" fill="#17325C">--</text><text x="565" y="264" text-anchor="middle" font-size="7.5" font-weight="700" fill="#33445c">% FLA</text>'+
   '<rect id="plMotor" x="600" y="222" width="138" height="52" rx="14" fill="url(#plMetal)" stroke="#0b1a33" stroke-width="2"/>'+
   [0,1,2,3,4,5,6,7].map(i=>'<line x1="'+(614+i*15)+'" x2="'+(614+i*15)+'" y1="226" y2="270" stroke="#0b1a33" stroke-opacity=".28" stroke-width="2"/>').join('')+
   '<path d="M738 248 H760 V288" stroke="#55657a" stroke-width="10" fill="none"/>'+
   '</g>'+
   // OptiView panel
   '<rect x="424" y="192" width="92" height="82" rx="6" fill="#d9dfe6" stroke="#0b1a33" stroke-width="2"/>'+
   '<rect x="432" y="200" width="76" height="46" rx="3" fill="#06210f"/>'+
   '<text id="plOv1" x="436" y="214" font-size="9" font-weight="700" fill="#7CFF8E">SYSTEM RUN</text>'+
   '<text id="plOv2" x="436" y="228" font-size="9" fill="#7CFF8E">LCHW --</text>'+
   '<text id="plOv3" x="436" y="241" font-size="9" fill="#7CFF8E">FLA --</text>'+
   '<g class="pl-beacon" id="plBeacon"><circle cx="508" cy="186" r="16" fill="#ff5a47" opacity=".35"/><circle cx="508" cy="186" r="7" fill="#ff5a47" filter="url(#plGlow)"/></g><rect x="503" y="186" width="10" height="7" rx="2" fill="#55657a"/>'+
   '<circle id="plLamp" cx="444" cy="260" r="6" fill="#2f9a63"/><text x="456" y="264" font-size="10" font-weight="700" fill="#33445c">OptiView</text>'+
   '<text x="610" y="327" text-anchor="middle" font-size="17" font-weight="800" fill="#eaf6f6">York YK chiller · condenser</text>'+
   '<text id="plChTxt" x="610" y="414" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">--</text>'+
   '<text x="610" y="434" text-anchor="middle" font-size="12" font-weight="600" fill="#bfe0e2">evaporator</text>'+
  '</g>'+
  plBadge('plBEcwt',236,360,134,'Cond water in')+plBadge('plBLcwt',322,118,140,'Cond water out')+
  plBadge('plBChs',882,394,172,'CHW supply')+plBadge('plBChr',946,500,140,'CHW return')+
  // PHX-1
  '<g id="plPhx" filter="url(#plShadow)">'+
   '<rect x="520" y="504" width="14" height="96" rx="2" fill="#55657a"/><rect x="606" y="504" width="14" height="96" rx="2" fill="#55657a"/>'+plates.join('')+
   '<line x1="520" y1="508" x2="620" y2="508" stroke="#2b3b52" stroke-width="3"/><line x1="520" y1="596" x2="620" y2="596" stroke="#2b3b52" stroke-width="3"/>'+
   '<clipPath id="plPhxClip"><rect x="536" y="512" width="70" height="80"/></clipPath><g clip-path="url(#plPhxClip)"><g id="plPhxSheen" style="opacity:0;transition:opacity .8s"><rect class="pl-sheen" x="480" y="508" width="40" height="90" fill="url(#plSheenG)"/></g></g>'+
   '<text x="570" y="616" text-anchor="middle" font-size="12.5" font-weight="700" fill="#cfdcec">PHX-1</text>'+
   '<text id="plPhxTxt" x="570" y="496" text-anchor="middle" font-size="12" font-weight="800" fill="#7f97b5">OFF</text>'+
  '</g>'+
  // clubhouse
  '<g filter="url(#plShadow)">'+
   '<g id="plChim" style="opacity:0;transition:opacity 1.5s">'+[0,1].map(i=>'<circle class="pl-smoke" style="animation-delay:'+(i*1.3)+'s" cx="1047" cy="30" r="5"/><circle class="pl-smoke" style="animation-delay:'+(i*1.3+.6)+'s" cx="1117" cy="36" r="5"/>').join('')+'</g>'+
   '<rect x="1040" y="34" width="14" height="40" fill="#8c7b66"/><rect x="1110" y="40" width="14" height="34" fill="#8c7b66"/>'+
   '<path d="M958 112 L1065 50 L1172 112 Z" fill="#34465f" stroke="#1d2b40" stroke-width="2"/>'+
   '<rect x="972" y="110" width="186" height="124" fill="url(#plStone)" stroke="#a69a85"/>'+
   wins.join('')+
   '<path d="M1036 112 L1065 92 L1094 112Z" fill="#f7f3ea" stroke="#a69a85"/>'+
   [1042,1056,1074,1088].map(x=>'<rect x="'+x+'" y="112" width="6" height="122" fill="#fbf8f2" stroke="#cfc4b0"/>').join('')+
   '<rect x="1056" y="196" width="18" height="38" fill="#5a4636"/>'+
   '<text x="1065" y="20" text-anchor="middle" font-size="12.5" font-weight="700" fill="#cfdcec">Clubhouse AHUs and FCUs</text>'+
  '</g>'+
  plBoiler('plB1',640,644,'B-1')+plBoiler('plB2',760,644,'B-2')+
  plPump('plHwp',960,690,'HW pump')+
  plBadge('plBHws',996,636,152,'HW supply')+plBadge('plBHwr',420,662,150,'HW return')+plBadge('plBBoil',252,662,156,'Boilers')+
  // alarm halos
  '<rect id="plHtower" class="pl-halo" x="46" y="26" width="226" height="238" rx="18"/>'+
  '<rect id="plHchiller" class="pl-halo" x="410" y="184" width="408" height="296" rx="18"/>'+
  '<rect id="plHwalk" class="pl-halo" x="38" y="490" width="208" height="128" rx="14"/>'+
  '<rect id="plHphx" class="pl-halo" x="506" y="480" width="128" height="140" rx="14"/>'+
  '<rect id="plHbld" class="pl-halo" x="950" y="24" width="230" height="236" rx="18"/>'+
  '<rect id="plHboil" class="pl-halo" x="626" y="606" width="236" height="150" rx="18"/>'+
  '</svg>';
}
/* Count numbers in a label from the old value to the new one, keeping the
   words and units. Falls back to a plain swap if the shape changed. */
const PL_TW=new WeakMap();
function plTween(el,txt){
  if(!el)return;const prev=el.dataset.t;el.dataset.t=txt;
  if(prev==null||prev===txt||matchMedia('(prefers-reduced-motion: reduce)').matches){el.textContent=txt;return}
  const re=/-?\d+(?:\.\d+)?/g,a=prev.match(re)||[],b=txt.match(re)||[];
  if(a.length!==b.length||!b.length||prev.replace(re,'#')!==txt.replace(re,'#')){el.textContent=txt;return}
  const parts=txt.split(re),dec=b.map(x=>(x.split('.')[1]||'').length),A=a.map(Number),B=b.map(Number),t0=performance.now(),D=650;
  const old=PL_TW.get(el);if(old)cancelAnimationFrame(old);
  const f=now=>{const k=Math.min(1,(now-t0)/D),e=1-Math.pow(1-k,3);
    el.textContent=parts.map((p,i)=>p+(i<B.length?(A[i]+(B[i]-A[i])*e).toFixed(dec[i]):'')).join('');
    if(k<1)PL_TW.set(el,requestAnimationFrame(f));else{PL_TW.delete(el);el.textContent=txt}};
  PL_TW.set(el,requestAnimationFrame(f));
}
function plHc(t){if(t==null||isNaN(t))return'#5d6b7d';const k=plClamp((t-90)/80,0,1);return'rgb('+Math.round(232-(232-200)*k)+','+Math.round(160-(160-52)*k)+','+Math.round(70-(70-34)*k)+')'}
function plSetFlowSpeed(id,secs){const f=$(id+'F');if(f)f.style.animationDuration=secs+'s'}
function plSetBadge(id,val,warn){const g=$(id);if(!g)return;plTween(g.querySelector('.v'),val);g.querySelector('rect').setAttribute('stroke',warn?'#ff5a47':'#ffffff');g.querySelector('rect').setAttribute('stroke-opacity',warn?'.9':'.14')}
function plSetPipe(id,t,on,hot){const p=$(id),f=$(id+'F');if(p)p.setAttribute('stroke',on?(hot?plHc(t):plTc(t)):'#4a5668');if(f)f.classList.toggle('on',!!on)}
function plSetSpin(id,on,secs){const g=$(id);if(!g)return;g.classList.toggle('stop',!on);if(on)g.style.animationDuration=secs+'s'}
function plUpdateSvg(V,alarms){
  if(!$('plFan'))return;
  const cw=V.cwp, ch=V.chwp&&(V.flow||0)>50, phxFlow=V.phx&&PLSCEN!=='phx';
  plSetPipe('plCws',V.ecwt,cw);plSetPipe('plCws2',V.ecwt,cw);plSetPipe('plCwr',V.lcwt,cw);plSetPipe('plWalkP',V.ecwt,cw);
  plSetPipe('plChs',V.chws,ch);plSetPipe('plChs2',V.chws,ch);plSetPipe('plChr',V.chwr,ch);
  plSetPipe('plPxc',V.ecwt,V.phx&&(PLMODE==='live'||phxFlow));plSetPipe('plPxh',V.phxOut,V.phx&&(PLMODE==='live'||phxFlow));
  if(!V.phx){$('plPxc').setAttribute('stroke','#3a4558');$('plPxh').setAttribute('stroke','#3a4558')}
  ['plV1','plV2'].forEach(id=>$(id).querySelector('path').setAttribute('fill',V.phx?'#2f9a63':'#5d6b7d'));
  const hz=V.hz||0;plSetSpin('plFan',hz>1,(0.9*60/Math.max(hz,6)).toFixed(2));
  $('plRain').style.opacity=cw?'1':'0';
  // flow speed follows real flow
  const chwSec=plClamp(480/Math.max(V.flow||1,60)*.9,.35,3).toFixed(2);
  ['plChs','plChs2','plChr'].forEach(id=>plSetFlowSpeed(id,chwSec));
  $('plFanBlur').setAttribute('opacity',(plClamp(hz/60,0,1)*.45).toFixed(2));
  // tower plume: more vapour with more heat rejected and humid air
  const rej=V.run?plClamp((V.lcwt-V.ecwt)/10,.2,1):(V.phx?.25:0);
  $('plSteam').style.opacity=cw&&hz>1?(.35+.65*rej).toFixed(2):'0';
  // chiller body
  $('plComp').classList.toggle('stop',!V.run);
  const fla=V.run&&V.fla!=null?plClamp(V.fla,0,100):0;
  $('plFlaArc').setAttribute('stroke-dasharray',(fla*.75).toFixed(1)+' 100');
  $('plFlaArc').setAttribute('stroke',fla>95?'#ff5a47':fla>85?'#ffc53d':'#4ee08f');
  plTween($('plFlaTxt'),V.run&&V.fla!=null?String(Math.round(V.fla)):'0');
  $('plCondTint').setAttribute('opacity',V.run&&V.lcwt!=null?(plClamp((V.lcwt-75)/20,0,1)*.32).toFixed(2):'0');
  $('plEvapTint').setAttribute('opacity',V.lchw!=null?(plClamp((48-V.lchw)/8,0,1)*.3).toFixed(2):'0');
  $('plShellSheen').style.opacity=V.run?'1':'0';
  $('plBeacon').classList.toggle('on',!!V.fault);
  $('plPhxSheen').style.opacity=V.phx&&(PLMODE==='live'||phxFlow)?'1':'0';
  ['plCwpLamp','plChpLamp','plHwpLamp'].forEach(id=>{const l=$(id);if(l)l.classList.toggle('pl-lampon',l.getAttribute('fill')!=='#5d6b7d')});
  // heating hot water and boilers
  const hwOn=V.hwp!==false&&V.hwp!=null, hwFlow=hwOn&&!(V.hwFlow!=null&&V.hwFlow<5);
  plSetPipe('plHws',V.hws,hwFlow,1);plSetPipe('plHws2',V.hws,hwFlow,1);plSetPipe('plHwr',V.hwr,hwFlow,1);plSetPipe('plHwx',(V.hws+V.hwr)/2,hwFlow,1);
  plSetSpin('plHwpImp',hwOn&&!V.bLock,.5);$('plHwpLamp').setAttribute('fill',hwOn?'#4ee08f':'#5d6b7d');
  let anyFire=false;
  [['plB1',V.b1],['plB2',V.b2]].forEach(([id,f])=>{
    const on=f!=null&&f>2;anyFire=anyFire||on;
    $(id+'Fire').style.opacity=on?(.45+.55*plClamp(f/100,0,1)).toFixed(2):'0';
    $(id+'Glow').setAttribute('opacity',on?(.3+.6*f/100).toFixed(2):'0');
    $(id+'Smoke').style.opacity=on?'1':'0';
    $(id+'Bar').setAttribute('width',on?(50*plClamp(f/100,0,1)).toFixed(1):'0');
    $(id+'Led').setAttribute('fill',V.bLock?'#ff5a47':on?'#ffb347':'#5d6b7d');
    $(id+'Pct').textContent=V.bLock?'LOCK':f==null?'--':on?Math.round(f)+'%':'IDLE';
    $(id+'Pct').setAttribute('fill',V.bLock?'#ff8a7a':on?'#ffcf8a':'#7f97b5');
  });
  $('plChim').style.opacity=anyFire?'1':'0';
  plSetBadge('plBHws',(V.hws==null?'--':plF(V.hws,0)+'°F')+(V.hwFlow==null?'':' · '+Math.round(V.hwFlow)+' gpm'),V.hws!=null&&V.hws<120&&hwOn);
  plSetBadge('plBHwr',V.hwr==null?'--':plF(V.hwr,0)+'°F',false);
  plSetBadge('plBBoil',V.bLock?'No-flow lockout':'B-1 '+(V.b1==null?'--':Math.round(V.b1)+'%')+' · B-2 '+(V.b2==null?'--':Math.round(V.b2)+'%'),!!V.bLock);
  // time of day
  const h=V.hour==null?12:V.hour, night=h<6||h>=19.5?1:h<7.5?(7.5-h)/1.5:h>18?(h-18)/1.5:0;
  $('plNight').setAttribute('opacity',(night*.45).toFixed(2));$('plStars').style.opacity=night.toFixed(2);
  $('plSunG').style.opacity=(1-night).toFixed(2);$('plMoonG').style.opacity=night.toFixed(2);
  plSetSpin('plCwpImp',cw,.5);plSetSpin('plChpImp',V.chwp,.5);
  $('plCwpLamp').setAttribute('fill',cw?'#4ee08f':'#5d6b7d');$('plChpLamp').setAttribute('fill',V.chwp?'#4ee08f':'#5d6b7d');
  const st=V.fault?'TRIPPED':V.run?'RUNNING':'OFF';
  $('plChTxt').textContent=st+(V.run&&V.fla!=null?' · '+Math.round(V.fla)+'% FLA':'');
  $('plChTxt').setAttribute('fill',V.fault?'#ffb4aa':'#fff');
  $('plLamp').setAttribute('fill',V.fault?'#ff5a47':V.run?'#4ee08f':'#8592a3');
  $('plOv1').textContent=V.fault?'SAFETY/CYCLING':V.run?'SYSTEM RUN':'SYSTEM STOP';$('plOv1').setAttribute('fill',V.fault?'#ff9d8f':'#7CFF8E');
  $('plOv2').textContent='LCHW '+plF(V.lchw)+'°F';$('plOv3').textContent='FLA '+(V.fla==null?'--':Math.round(V.fla)+'%');
  $('plMotor').setAttribute('stroke',V.run?'#4ee08f':'#0b1a33');
  $('plOa').textContent=plF(V.oaDb,0)+'°F · wet bulb '+plF(V.oaWb,0)+'°F';
  $('plFree').textContent=V.oaWb!=null&&V.oaWb<52?'Free cooling weather':'';
  plSetBadge('plBTower',Math.round(hz)+' Hz · BAS '+(V.sig==null?'--':Math.round(V.sig)+'%'),V.sig!=null&&Math.abs(V.sig*.6-hz)>10);
  plSetBadge('plBEcwt',plF(V.ecwt)+'°F',V.run&&V.ecwt<55);
  plSetBadge('plBLcwt',plF(V.lcwt)+'°F',false);
  plSetBadge('plBChs',plF(V.chws)+'°F · '+(V.flow==null?'--':Math.round(V.flow))+' gpm',(V.flow!=null&&V.flow<150)||V.chws>50);
  plSetBadge('plBChr',plF(V.chwr)+'°F',false);
  const w=V.walk;$('plWalkT').textContent=plF(w)+'°';$('plWalkT').setAttribute('fill',w>41?'#ff8a7a':'#7fd8a6');
  $('plWalkFrost').setAttribute('opacity',w!=null&&w<38?'.22':'0');
  $('plPhxTxt').textContent=V.phx?'FREE COOLING ON':'OFF';$('plPhxTxt').setAttribute('fill',V.phx?'#7fd8a6':'#7f97b5');
  const warm=V.chws>50,nt=$('plNight')&&+$('plNight').getAttribute('opacity')>.2;document.querySelectorAll('.plWin').forEach(x=>{x.setAttribute('fill',warm?'#ffb070':'#ffe7a6');x.setAttribute('filter',nt?'url(#plGlow)':'')});
  const hal={tower:0,chiller:0,walk:0,phx:0,bld:0,boil:0},lv={};
  alarms.forEach(a=>{const e=PL_EQ[a.rule]||(/^(ahu|fcu|ef|ref|zone|dev)\./.test(String(a.rule))?'bld':'');if(e){hal[e]=1;if(a.level==='critical'||lv[e]!=='critical')lv[e]=a.level}});
  Object.keys(hal).forEach(k=>{const h=$('plH'+k);h.classList.toggle('on',!!hal[k]);h.classList.toggle('pl-warnh',lv[k]==='warn')});
}

/* ================= screens ================= */
async function loadPlant(){
  const b=$('plantBody');if(!b)return;
  if(!PL)b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading the plant</span></div>';
  try{PL=await api('/plant')}catch(e){PL={live:false,points:[],alarms:[],history:[],error:e.message}}
  PLMODE=PLFORCE||(PL.live?'live':'demo');
  if(PLMODE==='demo'&&!PLSIM)plSimReset();
  plBuilt='';drawPlant();plStartTimers();
}
function plantStop(){clearInterval(plTick);clearInterval(plPoll);plTick=plPoll=null}
function plStartTimers(){
  plantStop();
  if(PLMODE==='demo')plTick=setInterval(()=>{if(TAB!=='plant'){plantStop();return}if(PLPAUSE)return;for(let i=0;i<PLSPEED;i++)plStep();plRefresh()},1000);
  else plPoll=setInterval(async()=>{if(TAB!=='plant'){plantStop();return}try{PL=await api('/plant');plRefresh()}catch(e){}},60000);
}
function plSetMode(m){PLFORCE=m;PLMODE=m;if(m==='demo'&&!PLSIM)plSimReset();plBuilt='';drawPlant();plStartTimers()}
function drawPlant(){
  const nav=[['plant','Plant'],['controls','Controls'],['ahus','Air handlers'],['fcus','Fan coils'],['efs','Exhaust fans'],['refs','Walk-ins'],['zones','Zones'],['bas','All BAS'],['trends','Trends'],['faults','York faults'],['setup','Gateway']];
  let h='<div class="filters">'+nav.map(([k,l])=>'<div class="'+(PLVIEW===k?'on':'')+'" onclick="PLVIEW=\''+k+'\';plBuilt=\'\';drawPlant()">'+l+'</div>').join('')+'</div>';
  h+='<div class="plbar">';
  if(PLMODE==='live')h+='<span class="plmode pl-live"><i></i>Live from the BAS</span><span class="dim" style="font-size:13px" id="plWhen"></span>';
  else h+='<span class="plmode pl-demo"><i></i>Demo mode</span><span class="dim" style="font-size:13px" id="plWhen"></span>'+
    '<select id="plScen" aria-label="Demo scenario" onchange="plScenario(this.value)">'+PL_SCEN.map(([k,n])=>'<option value="'+k+'"'+(k===PLSCEN?' selected':'')+'>'+n+'</option>').join('')+'</select>'+
    '<select aria-label="Speed" onchange="PLSPEED=+this.value">'+[[1,'1 min/sec'],[5,'5 min/sec'],[15,'15 min/sec']].map(([v,l])=>'<option value="'+v+'"'+(v===PLSPEED?' selected':'')+'>'+l+'</option>').join('')+'</select>'+
    '<button class="btn-2" id="plPauseB" onclick="PLPAUSE=!PLPAUSE;this.textContent=PLPAUSE?\'Resume\':\'Pause\'">'+(PLPAUSE?'Resume':'Pause')+'</button>'+
    (PL&&PL.live?'<button class="btn-2" onclick="plSetMode(\'live\')">Back to live</button>':'');
  h+='</div>';
  if(PLMODE==='demo')h+='<div class="note" style="background:#FBF1DC;color:#6B4A00"><b>Simulated data</b><span id="plScenNote">'+esc(PL_SCEN.find(s=>s[0]===PLSCEN)[2])+'</span> '+(PL&&PL.live?'':(PL&&PL.last_ts?'<b style="display:block;margin-top:4px">The plant gateway last sent data '+esc(plAgo(PL.last_ts))+' ('+esc(new Date(PL.last_ts).toLocaleString())+'). Check that the HVAC PC is on and the Clubhouse IQ Gateway task is running. This screen shows the demo until it reports again.</b>':'No gateway is sending plant data yet, so this screen runs a demo of the club\'s plant.'))+'</div>';
  if(PLVIEW==='plant'){
    h+='<div class="plfig" id="plFig">'+plSvg()+'</div><div class="plhint">Swipe the drawing sideways to see the whole plant.</div>'+
      '<div class="panel"><div class="eyebrow">Active alarms <span id="plAlmN"></span></div><div id="plAlm"></div></div>'+
      (typeof ahuStripHtml==='function'?ahuStripHtml():'')+
      '<div class="panel"><div class="eyebrow">Readings</div><div class="pltiles" id="plTiles"></div></div>'+
      '<div class="panel"><div class="eyebrow">'+(PLMODE==='demo'?'Demo event log':'Alarm history')+'</div><div class="pllog" id="plLog"></div></div>';
  }else if(PLVIEW==='controls'&&typeof ctlViewHtml==='function'){
    h+=ctlViewHtml();
  }else if(PLVIEW==='ahus'){
    h+=ahuViewHtml();
  }else if(typeof eqViewHtml==='function'&&['fcus','efs','refs','zones','bas'].includes(PLVIEW)){
    h+=eqViewHtml(PLVIEW);
  }else if(PLVIEW==='trends'){
    h+='<div class="panel"><div class="plbar" style="justify-content:space-between"><div class="eyebrow" style="margin:0">Last 4 hours</div>'+
      '<select aria-label="Trend" onchange="PLTREND=this.value;plChart()">'+Object.entries(PL_TRENDS).map(([k,t])=>'<option value="'+k+'"'+(k===PLTREND?' selected':'')+'>'+t.n+'</option>').join('')+'</select></div>'+
      '<div class="pllegend" id="plLeg"></div><div class="plchart" id="plChartBox"><svg id="plChart"></svg></div></div>';
  }else if(PLVIEW==='faults'){
    h+='<div class="panel"><input type="search" placeholder="Search a panel message, like flow switch" value="'+esc(PLFQ)+'" oninput="PLFQ=this.value;plFaults()" aria-label="Search York faults">'+
      '<div id="plFaults" style="margin-top:8px"></div><div class="dim" style="font-size:12.5px;margin-top:8px">Summarized from York forms 160.54-M1 and the Style H OptiView operation manual. Check the manual for your software version before acting.</div></div>';
  }else h+=plSetupHtml();
  $('plantBody').innerHTML=h;plBuilt=PLVIEW;PLCH_KEY='';
  if(PLVIEW==='bas'&&typeof eqBasLoad==='function')eqBasLoad();
  if(PLVIEW==='trends'){plChart();try{new ResizeObserver(()=>plChart()).observe($('plChartBox'))}catch(e){}}
  if(PLVIEW==='faults')plFaults();
  plRefresh();
}
function plScenario(k){
  PLSCEN=k;PLSIM.st=0;PLSIM.fault='';if(k!=='walkin'&&k!=='phx'&&!PLSIM.run)plStart();
  plDemoLog('Demo scenario: '+PL_SCEN.find(s=>s[0]===k)[1]);
  const n=$('plScenNote');if(n)n.textContent=PL_SCEN.find(s=>s[0]===k)[2];plRefresh();
}
function plRefresh(){
  if(!$('plantBody')||TAB!=='plant')return;
  const V=plView(),A=plAlarms();
  if($('plWhen'))$('plWhen').textContent=PLMODE==='demo'?'Plant time '+V.clock:V.clock;
  if(PLVIEW==='plant'){plUpdateSvg(V,A);plAlarmCards(A);plTiles(V);plLog();if(typeof ahuStrip==='function')ahuStrip(A)}
  if(PLVIEW==='ahus')ahuRefresh(V,A);
  if(typeof eqRefresh==='function'&&['fcus','efs','refs','zones'].includes(PLVIEW))eqRefresh(PLVIEW,A);
  if(PLVIEW==='trends'&&PLMODE==='demo'&&!(document.querySelector('.pltip')&&document.querySelector('.pltip').style.display==='block'))plChart();
}
function plAlarmCards(A){
  $('plAlmN').textContent=A.length?'· '+A.length:'';
  if(!A.length){$('plAlm').innerHTML='<div class="dim" style="font-size:14px">No active alarms. The plant is running inside its limits.</div>';return}
  const wr=!(ME&&(ME.role==='viewer'||ME.role==='staff'));
  $('plAlm').innerHTML=A.sort((a,b)=>(a.level==='critical'?0:1)-(b.level==='critical'?0:1)).map(a=>{
    const f=a.fault?PL_FAULTS.find(x=>x[0]===a.fault):null, checks=PL_CHECKS[a.rule]||(typeof plAhuChecks==='function'&&plAhuChecks(a.rule))||(typeof plEqChecks==='function'&&plEqChecks(a.rule))||(f?f[3]:[]);
    return '<div class="plalm '+(a.level==='critical'?'':'pl-warn')+'"><h4>'+esc(a.title)+'</h4><p>'+esc(a.detail)+'</p>'+
      '<div class="m">'+esc(a.equipment||'')+' · since '+esc(a.since||'')+(a.acked?' · acknowledged'+(a.acked_by?' by '+esc(a.acked_by):''):'')+(a.wo_id?' · work order #'+a.wo_id:'')+'</div>'+
      (f?'<p>'+esc(f[2])+'</p>':'')+(checks.length?'<ul>'+checks.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>':'')+
      (wr?'<div class="acts">'+(a.acked?'':'<button class="btn-2" onclick="plAck(\''+a.id+'\')">Acknowledge</button>')+
        (a.wo_id?'':'<button class="btn" onclick="plWo(\''+a.id+'\')">Make work order</button>')+'</div>':'')+'</div>';
  }).join('');
}
function plTile(l,v,u,cls){return '<div class="pltile '+(cls?'pl-'+cls:'')+'"><div class="l">'+l+'</div><span class="v">'+v+'</span><span class="u">'+(u||'')+'</span></div>'}
/* Tiles are built once, then updated in place so numbers can count and a
   small trace of the last two hours sits behind each one (demo history). */
function plTiles(V){
  const dt=V.chwr!=null&&V.lchw!=null?V.chwr-V.lchw:null;
  const T=[
    ['Chiller',V.fault?'TRIP':V.run?'RUN':'OFF','',V.fault?'bad':''],
    ['Leaving CHW',plF(V.lchw),'°F',V.lchw<40?'bad':'','lchwt','#3d8fd6'],
    ['Return CHW',plF(V.chwr),'°F','','chwr','#e0663a'],
    ['Delta T',dt==null?'?':dt.toFixed(1),'°F',V.run&&V.fla>45&&dt<5?'warn':''],
    ['CHW flow',V.flow==null?'?':String(Math.round(V.flow)),'gpm',V.flow!=null&&V.flow<150?'bad':'','chw_gpm','#3d8fd6'],
    ['Cond to chiller',plF(V.ecwt),'°F',V.run&&V.ecwt<55?'warn':'','ecwt','#2f8c94'],
    ['Cond from chiller',plF(V.lcwt),'°F','','lcwt','#e0663a'],
    ['Evap pressure',plF(V.evap),'psig'],
    ['Cond pressure',plF(V.cond),'psig'],
    ['Motor current',V.fla==null?'?':String(Math.round(V.fla)),'% FLA','','fla_pct','#17325C'],
    ['Starts, last hour',V.starts1h==null?'?':String(V.starts1h),'',V.starts1h>=3?'warn':''],
    ['Tower drive',V.hz==null?'?':String(Math.round(V.hz)),'Hz',V.sig!=null&&V.hz!=null&&Math.abs(V.sig*.6-V.hz)>10?'warn':'','tower_hz','#2f8c94'],
    ['BAS fan signal',V.sig==null?'?':String(Math.round(V.sig)),'%'],
    ['Outside wet bulb',plF(V.oaWb,0),'°F','','oa_wb','#9aa3ad'],
    ['PHX-1',V.phx?'ON':'OFF',''],
    ['Walk-in cooler',plF(V.walk),'°F',V.walk>41?'bad':'','walkin_temp','#3d8fd6'],
    ['HW supply',V.hws==null?'?':plF(V.hws,0),'°F',V.hws!=null&&V.hws<120&&V.hwp?'bad':'','hws','#d2452b'],
    ['HW return',V.hwr==null?'?':plF(V.hwr,0),'°F','','hwr','#e9a23b'],
    ['Boilers',V.bLock?'LOCK':V.b1==null?'?':String(Math.round((V.b1||0)+(V.b2||0)>0?Math.max(V.b1||0,V.b2||0):0)),V.bLock?'':'% fire',V.bLock?'bad':'']
  ];
  const box=$('plTiles');if(!box)return;
  if(box.dataset.n!==String(T.length)){
    box.dataset.n=T.length;
    box.innerHTML=T.map((t,i)=>'<div class="pltile" id="plT'+i+'">'+(t[4]?'<svg class="sp" viewBox="0 0 100 26" preserveAspectRatio="none"></svg>':'')+'<div class="l">'+t[0]+'</div><span class="v"></span><span class="u"></span></div>').join('');
  }
  const hist=PLMODE==='demo'?PLHIST.slice(-120):null;
  T.forEach((t,i)=>{
    const el=$('plT'+i);if(!el)return;
    el.className='pltile'+(t[3]?' pl-'+t[3]:'');
    const v=el.querySelector('.v');if(v.dataset.t!==t[1]&&v.dataset.t!=null){el.classList.remove('tick');void el.offsetWidth;el.classList.add('tick')}
    plTween(v,t[1]);el.querySelector('.u').textContent=t[2]||'';
    const sp=el.querySelector('.sp');
    if(sp&&hist&&hist.length>2){
      const ys=hist.map(r=>r[t[4]]).filter(x=>x!=null);if(ys.length<2){sp.innerHTML='';return}
      let lo=Math.min(...ys),hi=Math.max(...ys);const mr=Math.max(.6,Math.abs((lo+hi)/2)*.06);if(hi-lo<mr){const m=(hi+lo)/2;hi=m+mr/2;lo=m-mr/2}
      const pts=ys.map((y,j)=>(j*100/(ys.length-1)).toFixed(1)+','+(24-22*(y-lo)/(hi-lo)).toFixed(1)).join(' ');
      sp.innerHTML='<polygon points="0,26 '+pts+' 100,26" fill="'+t[5]+'" opacity=".14"/><polyline points="'+pts+'" fill="none" stroke="'+t[5]+'" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
    }else if(sp)sp.innerHTML='';
  });
}
function plLog(){
  let rows;
  if(PLMODE==='demo')rows=PLDEMO_LOG.map(l=>'<div><b>'+l.t+'</b> '+esc(l.m)+'</div>');
  else rows=(PL.history||[]).map(a=>'<div><b>'+plTime(a.started_at)+'</b> '+esc(a.title)+(a.cleared_at?' <span class="dim">· cleared '+plTime(a.cleared_at)+'</span>':' <span style="color:var(--rose);font-weight:700">· active</span>')+'</div>');
  $('plLog').innerHTML=rows.length?rows.slice(0,25).join(''):'<div class="dim">Nothing yet.</div>';
}
async function plAck(id){
  if(String(id).startsWith('d-')){PLDEMO_ACK.add(id);plRefresh();return}
  try{PL=await api('/plant/alarms/'+id+'/ack',{method:'POST'});plRefresh()}catch(e){toast(e.message)}
}
async function plWo(id){
  const a=plAlarms().find(x=>String(x.id)===String(id));if(!a)return;
  if(String(id).startsWith('d-')){toast('Demo alarm. No work order made.');return}
  const f=a.fault?PL_FAULTS.find(x=>x[0]===a.fault):null, checks=PL_CHECKS[a.rule]||(typeof plAhuChecks==='function'&&plAhuChecks(a.rule))||(typeof plEqChecks==='function'&&plEqChecks(a.rule))||(f?f[3]:[]);
  const ahu=String(a.rule).startsWith('ahu.')&&typeof ahuMeta==='function'?ahuMeta().find(x=>'ahu.'+x.dev===String(a.rule).split('.').slice(0,2).join('.')):null;
  try{
    const r=await api('/workorders',{method:'POST',body:{title:a.title.slice(0,160),building:ahu?ahu.building:'Central plant',location:ahu?ahu.tag+' · '+ahu.name:(a.equipment||''),
      category:a.rule==='tower'||a.rule==='coldcw'?'Cooling tower':'HVAC',priority:a.level==='critical'?'high':'normal',
      description:'From plant alarm at '+(a.since||'')+'.\n'+a.detail+'\n\nChecks:\n'+checks.map(c=>'- '+c).join('\n')}});
    const wo=r.workorder&&r.workorder.id;
    if(wo)await api('/plant/alarms/'+id+'/wo',{method:'POST',body:{wo_id:wo}});
    toast('Work order #'+wo+' opened');PL=await api('/plant');plRefresh();
  }catch(e){toast(e.message)}
}
function plFaults(){
  const q=PLFQ.trim().toLowerCase(),list=PL_FAULTS.filter(f=>!q||(f[0]+' '+f[2]).toLowerCase().includes(q));
  $('plFaults').innerHTML=list.length?list.map(f=>'<div class="plfault"><details><summary>'+esc(f[0])+'<span class="plk '+(f[1]==='s'?'saf':'cyc')+'">'+(f[1]==='s'?'Safety, manual reset':'Cycling, auto restart')+'</span></summary>'+
    '<p style="font-size:14px">'+esc(f[2])+'</p><ul>'+f[3].map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></details></div>').join(''):'<div class="dim">No match. Try fewer words, like "oil" or "flow".</div>';
}
let PLCH_KEY='',PLCH={};
async function plChart(){
  const svg=$('plChart');if(!svg)return;
  const t=PL_TRENDS[PLTREND];$('plLeg').innerHTML=t.s.map(([,n,c])=>'<span><i style="background:'+c+'"></i>'+n+'</span>').join('');
  let series={};
  if(PLMODE==='demo'){const d=PLHIST.slice(-240);t.s.forEach(([k])=>series[k]=d.map((r,i)=>[i,r[k]]).filter(p=>p[1]!=null));series._lab=i=>d[i]?plClock(d[i].t):''}
  else{
    const keys=t.s.map(s=>s[0]==='tower_sig_hz'?'tower_signal':s[0]==='chwr'?'chwr':s[0]);
    try{const r=await api('/plant/trend?hours=4&keys='+keys.join(','));t.s.forEach(([k])=>{const src=k==='tower_sig_hz'?'tower_signal':k;series[k]=(r.series[src]||[]).map(([ts,v])=>[ts,k==='tower_sig_hz'?v*.6:v])})}catch(e){}
    series._lab=ts=>plTime(ts);
  }
  const W=svg.clientWidth||600,H=svg.clientHeight||280,all=t.s.flatMap(([k])=>series[k]||[]);
  if(all.length<2){svg.innerHTML='<text x="20" y="40" fill="var(--dim)" font-size="14">No readings in this window yet.</text>';return}
  const xs=all.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs);
  let lo=Math.min(...all.map(p=>p[1])),hi=Math.max(...all.map(p=>p[1]));
  if(PLTREND==='walkin'){lo=Math.min(lo,32);hi=Math.max(hi,44)}
  const pad=(hi-lo)*.12||2;lo-=pad;hi+=pad;
  const L=W<520?34:44,R=10,T=10,B=26,X=v=>L+(W-L-R)*(v-x0)/((x1-x0)||1),Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  // animate the lines in only when the chart changes, not on every tick
  const key=PLTREND+'|'+PLMODE+'|'+W, fresh=key!==PLCH_KEY;PLCH_KEY=key;
  let o='<defs>'+t.s.map(([k,,c],i)=>'<linearGradient id="plAr'+i+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+c+'" stop-opacity=".28"/><stop offset="1" stop-color="'+c+'" stop-opacity="0"/></linearGradient>').join('')+'</defs>';
  const nt=W<520?3:5;
  for(let i=0;i<=nt;i++){const v=lo+(hi-lo)*i/nt;o+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="var(--edge)"/><text x="'+(L-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="var(--dim)">'+v.toFixed(0)+'</text>'}
  const nx=W<520?3:5;for(let i=0;i<=nx;i++){const v=x0+(x1-x0)*i/nx;o+='<text x="'+X(v)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':i===nx?'end':'middle')+'" font-size="11" fill="var(--dim)">'+esc(series._lab(PLMODE==='demo'?Math.round(v):v))+'</text>'}
  if(PLTREND==='walkin')o+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(41)+'" y2="'+Y(41)+'" stroke="var(--rose)" stroke-dasharray="5 4"/><text x="'+(W-R)+'" y="'+(Y(41)-5)+'" text-anchor="end" font-size="11" fill="var(--rose)">41°F limit</text>';
  const base=H-B;
  t.s.forEach(([k,,c],i)=>{const s=series[k]||[];if(s.length<2)return;
    const pts=s.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ');
    if(t.s.length<=2||i===0)o+='<polygon class="'+(fresh?'area':'')+'" points="'+X(s[0][0]).toFixed(1)+','+base+' '+pts+' '+X(s[s.length-1][0]).toFixed(1)+','+base+'" fill="url(#plAr'+i+')"/>';
    o+='<polyline class="'+(fresh?'draw':'')+'" pathLength="1" fill="none" stroke="'+c+'" stroke-width="2.4" stroke-linejoin="round" points="'+pts+'"/>';
    const e=s[s.length-1];o+='<circle class="now" cx="'+X(e[0]).toFixed(1)+'" cy="'+Y(e[1]).toFixed(1)+'" r="4" fill="'+c+'" stroke="#fff" stroke-width="1.5"/>';
  });
  o+='<g class="xh" id="plXh" style="display:none"><line id="plXhL" y1="'+T+'" y2="'+base+'" stroke="var(--mid)" stroke-dasharray="3 3"/>'+t.s.map((x,i)=>'<circle id="plXhD'+i+'" r="4.5" fill="'+x[2]+'" stroke="#fff" stroke-width="2"/>').join('')+'</g>';
  o+='<rect id="plHit" x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(base-T)+'" fill="transparent"/>';
  svg.innerHTML=o;
  PLCH={t,series,X,Y,L,W,R};
  const boxEl=$('plChartBox');let tip=boxEl.querySelector('.pltip');if(!tip){tip=document.createElement('div');tip.className='pltip';boxEl.appendChild(tip)}
  const hit=$('plHit');
  const move=ev=>{
    const rc=svg.getBoundingClientRect(),cx=(ev.touches?ev.touches[0].clientX:ev.clientX)-rc.left,{t,series,X,Y}=PLCH;
    const first=series[t.s[0][0]]||[];if(!first.length)return;
    let best=0,bd=1e9;first.forEach((p,i)=>{const d=Math.abs(X(p[0])-cx);if(d<bd){bd=d;best=i}});
    const xv=first[best][0],px=X(xv);$('plXh').style.display='';$('plXhL').setAttribute('x1',px);$('plXhL').setAttribute('x2',px);
    let rows='<b>'+esc(series._lab(xv))+'</b>';
    t.s.forEach(([k,n,c],i)=>{const s=series[k]||[];let q=s.reduce((a,p)=>Math.abs(p[0]-xv)<Math.abs(a[0]-xv)?p:a,s[0]||[xv,null]);const d=$('plXhD'+i);
      if(q&&q[1]!=null){d.setAttribute('cx',X(q[0]));d.setAttribute('cy',Y(q[1]));d.style.display='';rows+='<br><i style="background:'+c+'"></i>'+n+' <b>'+q[1].toFixed(1)+'</b>'}else d.style.display='none'});
    tip.innerHTML=rows;tip.style.display='block';
    const tw=tip.offsetWidth;tip.style.left=Math.min(Math.max(4,px+12),rc.width-tw-4)+'px';tip.style.top='12px';
  };
  const out=()=>{$('plXh')&&($('plXh').style.display='none');tip.style.display='none'};
  hit.addEventListener('mousemove',move);hit.addEventListener('touchmove',move,{passive:true});hit.addEventListener('touchstart',move,{passive:true});
  hit.addEventListener('mouseleave',out);hit.addEventListener('touchend',()=>setTimeout(out,1500));
}
function plSetupHtml(){ return plSetupHtml0()+plDemoSwitchHtml(); }
function plSetupHtml0(){
  const p=PL||{},url=location.origin+'/api/plant/ingest';
  return '<div class="panel"><div class="eyebrow">Gateway status</div>'+
    '<div style="font-size:14px;line-height:1.7">Last reading: <b>'+(p.last_ts?plAgo(p.last_ts):'none yet')+'</b><br>Plant key on the server: <b>'+(p.gateway_key_set?'set':'not set')+'</b>'+
    (p.gateway_key_set?'':'<br><span class="dim">Add PLANT_INGEST_KEY (24 characters or more) in Render, Environment.</span>')+'</div></div>'+
    '<div class="panel"><div class="eyebrow">How data gets here</div><p style="font-size:14px;margin-top:0">A small box on the BAS network reads the points below over BACnet (read only) and posts them here every minute. Nothing in Clubhouse IQ can write to the BAS.</p>'+
    '<div class="plcode">curl -X POST '+esc(url)+' \\\n  -H "Content-Type: application/json" \\\n  -H "X-Plant-Key: $PLANT_INGEST_KEY" \\\n  -d \'{"values":{"lchwt":44.1,"comp_running":1,"tower_hz":38}}\'</div></div>'+
    '<div class="panel"><div class="eyebrow">Points</div><table class="plpts"><thead><tr><th>Point</th><th>BACnet</th><th class="n">Latest</th></tr></thead><tbody>'+
    (p.points||[]).map(x=>'<tr><td>'+esc(x.label)+'<div class="dim" style="font-size:11.5px">'+esc(x.key)+'</div></td><td>'+(x.device?esc(x.device+(x.object?' · '+x.object:'')):'')+'</td><td class="n">'+
      (x.ts?esc(x.text||(x.value==null?'':(+x.value).toFixed(1)+' '+(x.units||'')))+'<div class="dim" style="font-size:11.5px">'+plAgo(x.ts)+'</div>':'<span class="dim">none</span>')+'</td></tr>').join('')+
    '</tbody></table></div>'+
    '<div class="panel"><div class="eyebrow">Air handler points</div><p style="font-size:14px;margin-top:0">Send each AHU point as <b>ahu.&lt;device&gt;.&lt;point&gt;</b>, for example <b>ahu.101102.cd</b> for the AHU-2 cold deck. Single-zone units use <b>cd</b> and <b>cd_sp</b> for supply air.</p>'+
    '<table class="plpts"><thead><tr><th>Point</th><th>Key</th></tr></thead><tbody>'+(p.ahu_points||[]).map(x=>'<tr><td>'+esc(x.label)+(x.units?' <span class="dim">('+esc(x.units)+')</span>':'')+'</td><td><b>'+esc(x.key)+'</b></td></tr>').join('')+'</tbody></table>'+
    '<table class="plpts" style="margin-top:10px"><thead><tr><th>Unit</th><th>BAS device</th><th class="n">Last data</th></tr></thead><tbody>'+(p.ahus||[]).map(a=>'<tr><td>'+esc(a.tag)+'<div class="dim" style="font-size:11.5px">'+esc(a.name)+'</div></td><td>'+a.dev+'</td><td class="n">'+(a.ts?plAgo(a.ts):'<span class="dim">none</span>')+'</td></tr>').join('')+'</tbody></table></div>';
}

function plDemoSwitchHtml(){
  return '<div class="panel"><div class="eyebrow">Demo mode</div><p style="font-size:14px;margin-top:0">Runs a simulation of the plant with real fault scenarios, for training or showing the app. It does not change any real data.</p>'+
    (PLMODE==='live'?'<button class="btn-2" onclick="PLVIEW=\'plant\';plSetMode(\'demo\')">Switch to demo mode</button>':(PL&&PL.live?'<button class="btn" onclick="PLVIEW=\'plant\';plSetMode(\'live\')">Back to live data</button>':'<span class="dim" style="font-size:13px">Demo runs on its own until the gateway sends data.</span>'))+'</div>';
}
