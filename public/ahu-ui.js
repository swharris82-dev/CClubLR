/* Clubhouse IQ: main air handlers on the Plant screen.
   Live data comes from the plant gateway as ahu.<device>.<point> (plant.js).
   In demo mode each AHU is simulated off the demo plant's chilled water, so a
   warm loop shows up at the air handlers the way it does in the building.
   The demo starts with the real 11/13 findings: AHU-2 hot water output held
   at 100% with the OA damper held closed, AHU-5 cooling valve wide open with
   no fresh air. */
let AHSIM=null, AHHIST={}, AHSEL=null, AHFILT='all', AHTR='temps';

const AHU_FALLBACK=[
  {dev:101101,tag:'AHU-1',name:'Ballroom',building:'Clubhouse',mz:false},
  {dev:101102,tag:'AHU-2',name:'Upper administration',building:'Clubhouse',mz:true},
  {dev:101103,tag:'AHU-3',name:'Adams, Washington, Jefferson',building:'Clubhouse',mz:true},
  {dev:101104,tag:'AHU-4',name:'Garden Room, Centennial Bar, Presidents Lounge',building:'Clubhouse',mz:true},
  {dev:101105,tag:'AHU-5',name:'Locker rooms, grills, veg prep',building:'Clubhouse',mz:true},
  {dev:101106,tag:'AHU-6',name:'Pro Shop',building:'Golf Shop',mz:false},
  {dev:101107,tag:'AHU-7',name:'Kitchen',building:'Clubhouse',mz:false},
  {dev:101109,tag:'AHU-9',name:'Garden Room',building:'Clubhouse',mz:false},
  {dev:101110,tag:'AHU-10',name:"Men's Bar, Mixed Grill",building:'Clubhouse',mz:false},
  {dev:101111,tag:'AHU-11',name:'Terrace Room',building:'Clubhouse',mz:false},
  {dev:201101,tag:'DOAS-1',name:'Commons dedicated outside air',building:'Fitness Center',mz:false}
];
const AHU_CHECKS={
  fan:['Check the disconnect, starter or VFD, and the overloads.','Look at the belt and sheaves. A broken belt reads as fan commanded with no airflow.','Confirm the fan is really off before chasing the motor. A bad current switch can fake a failure.'],
  fight:['On the Compass graphic, look at the white entry box beside each valve. A number instead of null means the output is being held. Select NULL and Save.','Find the zone calling 100% heat and check its sensor and setpoint.','Feel the coil leaving pipes. A hot HW return with the valve at 0% means a passing valve.'],
  nocool:['Check chilled water supply at the plant first. Warm CHW means start at the chiller or PHX-1, not the AHU.','Compare CHW coil supply and return pipe temps. Same temperature means no flow: valve, actuator, strainer, or air.','Check the actuator wiring. AH-1 had a disconnected CHW actuator wire on 11/3.','Filters and coil face.'],
  hothd:['Check the HW valve entry box for an override (100 instead of null). Release with NULL.','Make sure the unit is not stuck in warmup (115°F warmup setpoint).','Hot deck reset settings on the Setup page.'],
  nooa:['Open the OA damper output and check Present Value and priority for an override.','Check the damper minimum position on the Setup page. 0% means no fresh air while occupied.','Linkage and actuator stroke.']
};
function ahuMeta(){ return PL&&PL.ahus&&PL.ahus.length?PL.ahus:AHU_FALLBACK; }
function plAhuChecks(rule){ const m=String(rule||'').match(/^ahu\.\d+\.(\w+)$/); return m?AHU_CHECKS[m[1]]:null; }

/* ---------- demo simulation ---------- */
function ahuSimReset(){
  AHSIM={}; AHHIST={};
  const hours={101102:86582,101107:25752,101106:0,101109:76486,101111:41762,101110:30410,101101:52240,101103:61880,101104:58920,101105:64400,201101:18300};
  ahuMeta().forEach(a=>{ AHSIM[a.dev]={a,space:72+plR(2),cd:60,hd:a.mz?95:null,chw:30,hw:a.mz?30:0,oa:20,hours:hours[a.dev]||40000,dp:a.dev===101109?1.15:0.35+Math.random()*.4}; AHHIST[a.dev]=[]; });
}
function ahuSimStep(s){
  if(!AHSIM) ahuSimReset();
  const hr=(s.t/60)%24, oa=s.oaDb, chwApp=(s.chwp&&s.flow>150?s.chws:Math.min(70,(s.chws||50)+6))+4;
  Object.values(AHSIM).forEach(u=>{
    const a=u.a, dev=a.dev;
    const occ=dev===101107?(hr>=5):(hr>=6&&hr<23);
    u.occ=occ?1:0; u.cmd=(occ||dev===101102)?1:0;
    u.status=u.cmd; if(PLSCEN==='ahufan'&&dev===101107&&u.cmd) u.status=0;
    const on=u.status===1;
    // outside air damper
    let oaT=occ?(oa<62&&oa>45?65:20):0;
    if(dev===101102) oaT=0;           // AO 3 held at 0.0 (priority 8)
    if(dev===101105) oaT=0;           // min position 0%, economizer locked out
    if(dev===201101) oaT=occ?100:0;   // dedicated outside air
    u.oa+=(oaT-u.oa)*.4; if(!on) u.oa+=(0-u.oa)*.5;
    u.mat=oa*u.oa/100+u.space*(1-u.oa/100)+plR(.2);
    u.cdsp=a.mz?plClamp(60-(oa-60)*.5,52,60):55;
    u.hdsp=a.mz?plClamp(105-(oa-40)*.75,75,105):null;
    if(on){
      if(dev===101102){ u.chw=100; u.hw=100; u.cd+=(79.5-u.cd)*.3+plR(.3); u.hd+=(114-u.hd)*.3+plR(.3); }
      else if(dev===101105){ u.chw=100; u.cd+=(u.mat-2.5-u.cd)*.3+plR(.2); }
      else{
        const ach=Math.max(chwApp,u.mat-(u.mat-chwApp)*u.chw/100);
        u.cd+=(ach-u.cd)*.5+plR(.2);
        u.chw=plClamp(u.chw+(u.cd-u.cdsp)*7,0,100);
      }
      if(a.mz&&dev!==101102){ const hdA=u.mat+(150-u.mat)*u.hw/100*.55; u.hd+=(hdA-u.hd)*.5+plR(.3); u.hw=plClamp(u.hw+(u.hdsp-u.hd)*2.5,0,100); }
      u.hours+=1/60;
      const cool=a.mz?(u.cd<u.space-4?1:0):(u.cd<u.space-6?1:0);
      u.space+=((dev===101107?75:72)+(oa-70)*.04-u.space)*.05+(cool?-.02:.05)+plR(.05);
    }else{
      u.chw+=(0-u.chw)*.5; u.hw+=(0-u.hw)*.5;
      u.cd+=(u.space-u.cd)*.1; if(a.mz) u.hd+=(u.space-u.hd)*.08;
      u.space+=((oa*.25+72*.75)-u.space)*.01;
    }
    u.dp=Math.max(.2,u.dp+(on?.00002:0));
    const h=AHHIST[dev]; h.push({t:s.t,cd:u.cd,hd:a.mz?u.hd:null,mat:u.mat,space:u.space,chw:u.chw,hw:u.hw,oa:u.oa,cdsp:u.cdsp});
    if(h.length>480) h.shift();
  });
}
/* one view model per AHU, demo or live */
function ahuVals(){
  return ahuMeta().map(a=>{
    if(PLMODE==='demo'){
      const u=AHSIM&&AHSIM[a.dev]; if(!u) return Object.assign({},a,{v:{}});
      return Object.assign({},a,{v:{occ:u.occ,fan_cmd:u.cmd,fan_status:u.status,mat:u.mat,cd:u.cd,cd_sp:u.cdsp,hd:a.mz?u.hd:null,hd_sp:u.hdsp,
        chw_vlv:u.chw,hw_vlv:a.mz?u.hw:null,oa_dmp:u.oa,chw_req:u.chw>20?1:0,space:u.space,sf_hours:u.hours,filter_dp:u.dp},ts:'demo'});
    }
    return Object.assign({},a,{v:a.values||{}});
  });
}
/* Same rules as plant.js ahuHits. */
function plAhuRules(V){
  const out=[];
  ahuVals().forEach(a=>{
    const x=a.v, on=x.fan_status===1, dk=a.mz?'cold deck':'supply air';
    const add=(r,level,title,detail)=>out.push({rule:'ahu.'+a.dev+'.'+r,level,equipment:a.tag,title,detail});
    if(x.fan_cmd===1&&x.fan_status===0) add('fan','critical',a.tag+' supply fan commanded on but not running',a.name+'. Fan status off with the command on.');
    if(on&&x.chw_vlv>=40&&x.hw_vlv>=40) add('fight','warn',a.tag+' heating and cooling at the same time','CHW valve '+Math.round(x.chw_vlv)+'%, HW valve '+Math.round(x.hw_vlv)+'%. Look for an override on one of the valve outputs.');
    if(on&&x.chw_vlv>=95&&x.cd!=null&&x.cd_sp!=null&&x.cd-x.cd_sp>8) add('nocool','warn',a.tag+' not making its '+dk+' temperature',dk[0].toUpperCase()+dk.slice(1)+' '+plF(x.cd)+'°F against '+plF(x.cd_sp)+'°F with the CHW valve wide open. Plant CHW supply '+plF(V&&V.chws)+'°F.');
    if(on&&a.mz&&x.hd!=null&&x.hd_sp!=null&&x.hd-x.hd_sp>10) add('hothd','warn',a.tag+' hot deck '+Math.round(x.hd-x.hd_sp)+'°F over setpoint','Hot deck '+plF(x.hd)+'°F, setpoint '+plF(x.hd_sp)+'°F, HW valve '+(x.hw_vlv==null?'?':Math.round(x.hw_vlv)+'%')+'.');
    if(on&&x.occ===1&&x.oa_dmp!=null&&x.oa_dmp<1) add('nooa','warn',a.tag+' outside air damper closed while occupied','OA damper '+Math.round(x.oa_dmp)+'%. No fresh air to '+a.name+'.');
  });
  return out;
}
function ahuState(a,A){
  const mine=A.filter(x=>String(x.rule||'').startsWith('ahu.'+a.dev+'.'));
  if(mine.some(x=>x.level==='critical')) return 'bad';
  if(mine.length) return 'warn';
  if(a.v.fan_status===1) return 'run';
  if(a.v.fan_status==null&&a.v.cd==null) return 'none';
  return 'off';
}

/* ---------- styles ---------- */
(function(){
  const s=document.createElement('style');
  s.textContent=
  '.ahsum{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}'+
  '.ahsum div{background:var(--panel);border:1px solid var(--edge);border-radius:var(--r-s);padding:9px 10px;text-align:center}'+
  '.ahsum b{display:block;font-size:22px;color:var(--ice)}.ahsum span{font-size:11.5px;color:var(--dim)}'+
  '.ahgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}'+
  '.ahc{background:#0f2240;border-radius:var(--r);color:#fff;padding:10px 12px 12px;cursor:pointer;position:relative;box-shadow:var(--shadow);transition:transform .15s;border:2px solid transparent;animation:ahin .5s both}'+
  '.ahc:active{transform:scale(.98)}.ahc.st-bad{border-color:#ff5a47;animation:ahin .5s both,ahglow 1.4s ease-in-out infinite}.ahc.st-warn{border-color:#ffc53d}'+
  '.ahc .hd{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.ahc .tg{font-weight:800;font-size:17px}.ahc .nm{font-size:12px;color:#a9bdd6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.ahc .chip{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;background:#1f3a63;color:#cfe0f5;letter-spacing:.3px}'+
  '.ahc.st-run .chip{background:#1e6b4f;color:#d6f5e6}.ahc.st-bad .chip{background:#b3362d;color:#fff}.ahc.st-warn .chip{background:#9a7b32;color:#fff}'+
  '.ahc svg{display:block;width:100%;height:auto;margin:6px 0 4px}'+
  '.ahc .rd{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:11px;color:#a9bdd6}.ahc .rd b{display:block;font-size:15px;color:#fff}'+
  '.ah-flow{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:1 13;opacity:0;animation:ahflow .8s linear infinite}.ah-flow.on{opacity:.75}'+
  '.ahdet{background:#0f2240;border-radius:var(--r);overflow:hidden;margin-bottom:12px}.ahdet svg{display:block;width:100%;height:auto}'+
  
  '.ahbars{display:grid;gap:8px}.ahbar .l{display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px}.ahbar .t{height:10px;border-radius:6px;background:var(--deep);overflow:hidden;border:1px solid var(--edge)}'+
  '.ahbar .t i{display:block;height:100%;border-radius:6px;transition:width .8s cubic-bezier(.2,.8,.2,1)}'+
  '@keyframes ahflow{to{stroke-dashoffset:-14}}@keyframes ahin{from{opacity:0;transform:translateY(10px)}}'+
  '@keyframes ahglow{0%,100%{box-shadow:0 0 0 0 rgba(255,90,71,.0)}50%{box-shadow:0 0 0 6px rgba(255,90,71,.25)}}'+
  '@media(prefers-reduced-motion:reduce){.ahc,.ah-flow,.ahc.st-bad{animation:none}.ah-flow.on{opacity:.75}}';
  document.head.appendChild(s);
})();

/* ---------- mini schematic on each card ---------- */
function ahuMini(a){
  const d=a.dev, mz=a.mz;
  let s='<svg viewBox="0 0 260 86" aria-hidden="true">';
  // OA louver + damper
  s+='<rect x="4" y="22" width="26" height="42" rx="3" fill="#18325a" stroke="#3b5a85"/>';
  for(let i=0;i<4;i++) s+='<line id="am-'+d+'-dmp'+i+'" x1="13" y1="'+(29+i*9)+'" x2="21" y2="'+(29+i*9)+'" stroke="#8DB8E0" stroke-width="2.2" stroke-linecap="round" style="transform-box:fill-box;transform-origin:center;transition:transform .8s"/>';
  // duct + filter
  s+='<defs><linearGradient id="ahCab'+d+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d4c78"/><stop offset="1" stop-color="#132a4c"/></linearGradient>'+
     '<pattern id="ahFin'+d+'" width="3" height="6" patternUnits="userSpaceOnUse"><line x1="1.5" y1="0" x2="1.5" y2="6" stroke="#dfeaf7" stroke-width=".7" opacity=".7"/></pattern></defs>';
  s+='<rect x="30" y="26" width="'+(mz?92:150)+'" height="34" fill="url(#ahCab'+d+')" stroke="#4d6e9a"/>';
  s+='<rect x="64" y="64" width="14" height="10" rx="2" fill="#5a7fae" stroke="#8DB8E0"/><line x1="71" y1="64" x2="78" y2="56" stroke="#8DB8E0" stroke-width="1.4"/>';
  s+='<rect x="40" y="26" width="8" height="34" fill="url(#ahHatch'+d+')" stroke="#5d7aa3"/>';
  s+='<defs><pattern id="ahHatch'+d+'" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#2b4670"/><line x1="0" y1="0" x2="0" y2="4" stroke="#7f9cc4" stroke-width="1.4"/></pattern></defs>';
  // fan
  s+='<circle cx="78" cy="43" r="15" fill="#0b1a33" stroke="#5d7aa3" stroke-width="2"/>';
  s+='<g id="am-'+d+'-fan" class="pl-spin stop" style="animation-duration:.9s">'+[0,72,144,216,288].map(r=>'<path d="M78 43 L78 31 Q84 34 80 43Z" fill="#8DB8E0" transform="rotate('+r+' 78 43)"/>').join('')+'</g>';
  s+='<circle cx="78" cy="43" r="3" fill="#cfe0f5"/>';
  if(mz){
    s+='<path d="M122 26 L150 10 L250 10 L250 36 L150 36 L136 43" fill="#13294b" stroke="#2f4f7a"/>';
    s+='<path d="M122 60 L150 76 L250 76 L250 50 L150 50 L136 43" fill="#13294b" stroke="#2f4f7a"/>';
    s+='<rect id="am-'+d+'-hc" x="156" y="12" width="12" height="22" rx="2" fill="#e2603a"/><rect x="156" y="12" width="12" height="22" fill="url(#ahFin'+d+')"/><rect id="am-'+d+'-cc" x="156" y="52" width="12" height="22" rx="2" fill="#3d8fd6"/><rect x="156" y="52" width="12" height="22" fill="url(#ahFin'+d+')"/>';
    s+='<path id="am-'+d+'-fh" class="ah-flow" d="M96 40 L140 23 L246 23"/><path id="am-'+d+'-fc" class="ah-flow" d="M96 46 L140 63 L246 63"/>';
    s+='<text id="am-'+d+'-hdT" x="240" y="27" text-anchor="end" font-size="12" font-weight="800" fill="#fff">--</text><text id="am-'+d+'-cdT" x="240" y="67" text-anchor="end" font-size="12" font-weight="800" fill="#fff">--</text>';
    s+='<text x="172" y="27" font-size="9" fill="#a9bdd6">HOT</text><text x="172" y="67" font-size="9" fill="#a9bdd6">COLD</text>';
  }else{
    s+='<rect id="am-'+d+'-cc" x="126" y="28" width="14" height="30" rx="2" fill="#3d8fd6"/><rect x="126" y="28" width="14" height="30" fill="url(#ahFin'+d+')"/>';
    s+='<path d="M180 26 L250 26 L250 60 L180 60" fill="#13294b" stroke="#2f4f7a"/>';
    s+='<path id="am-'+d+'-fc" class="ah-flow" d="M34 43 L246 43"/>';
    s+='<text x="150" y="38" font-size="9" fill="#a9bdd6">SUPPLY</text><text id="am-'+d+'-cdT" x="244" y="48" text-anchor="end" font-size="13" font-weight="800" fill="#fff">--</text>';
  }
  return s+'</svg>';
}
function ahuCard(a,i){
  return '<div class="ahc" id="ac-'+a.dev+'" style="animation-delay:'+(i*45)+'ms" onclick="ahuOpen('+a.dev+')">'+
    '<div class="hd"><span class="tg">'+esc(a.tag)+'</span><span class="chip" id="ac-'+a.dev+'-st">--</span></div>'+
    '<div class="nm">'+esc(a.name)+'</div>'+ahuMini(a)+
    '<div class="rd"><div>Mixed air<b id="ac-'+a.dev+'-mat">--</b></div><div>CHW valve<b id="ac-'+a.dev+'-chw">--</b></div><div>'+(a.mz?'HW valve':'OA damper')+'<b id="ac-'+a.dev+'-x">--</b></div></div></div>';
}

/* ---------- screen ---------- */
function ahuViewHtml(){
  return '<div class="ahsum" id="ahSum"></div>'+
    '<div class="filters" id="ahF" style="margin-bottom:10px">'+[['all','All'],['alarm','Alarms'],['run','Running'],['off','Off']].map(([k,l])=>'<div class="'+(AHFILT===k?'on':'')+'" onclick="AHFILT=\''+k+'\';ahuFilter()">'+l+'</div>').join('')+'</div>'+
    '<div class="ahgrid" id="ahGrid">'+ahuMeta().map(ahuCard).join('')+'</div>'+
    '<div class="dim" style="font-size:12.5px;margin-top:10px">Tap an air handler for its full picture, alarms, and trend. '+(PLMODE==='demo'?'Demo values start from the 11/13 findings on AHU-2 and AHU-5.':'Values come from the plant gateway.')+'</div>';
}
function ahuFilter(){
  document.querySelectorAll('#ahF > div').forEach((d,i)=>d.classList.toggle('on',['all','alarm','run','off'][i]===AHFILT));
  ahuRefresh(null,plAlarms());
}
const AH_ST_LBL={bad:'ALARM',warn:'CHECK',run:'RUNNING',off:'OFF',none:'NO DATA'};
function ahuRefresh(V,A){
  const list=ahuVals(); let run=0,alm=0,off=0,nd=0;
  list.forEach(a=>{
    const st=ahuState(a,A), x=a.v, c=$('ac-'+a.dev); if(!c) return;
    if(st==='run')run++; else if(st==='bad'||st==='warn'){alm++; if(x.fan_status===1)run++;} else if(st==='off')off++; else nd++;
    c.className='ahc st-'+st;
    const show=AHFILT==='all'||(AHFILT==='alarm'&&(st==='bad'||st==='warn'))||(AHFILT==='run'&&x.fan_status===1)||(AHFILT==='off'&&x.fan_status!==1);
    c.style.display=show?'':'none';
    $('ac-'+a.dev+'-st').textContent=AH_ST_LBL[st];
    const on=x.fan_status===1, fan=$('am-'+a.dev+'-fan'); if(fan) fan.classList.toggle('stop',!on);
    ['fc','fh'].forEach(k=>{ const f=$('am-'+a.dev+'-'+k); if(f) f.classList.toggle('on',on); });
    const ang=x.oa_dmp==null?0:(90-x.oa_dmp*.9); for(let i=0;i<4;i++){ const l=$('am-'+a.dev+'-dmp'+i); if(l) l.style.transform='rotate('+ang+'deg)'; }
    const cc=$('am-'+a.dev+'-cc'); if(cc) cc.setAttribute('opacity',x.chw_vlv==null?.35:.35+.65*x.chw_vlv/100);
    const hc=$('am-'+a.dev+'-hc'); if(hc) hc.setAttribute('opacity',x.hw_vlv==null?.35:.35+.65*x.hw_vlv/100);
    const cdT=$('am-'+a.dev+'-cdT'); if(cdT){ cdT.textContent=x.cd==null?'--':plF(x.cd,0)+'°'; cdT.setAttribute('fill',x.cd!=null&&x.cd_sp!=null&&x.cd-x.cd_sp>8?'#ffb3a8':'#fff'); }
    const hdT=$('am-'+a.dev+'-hdT'); if(hdT){ hdT.textContent=x.hd==null?'--':plF(x.hd,0)+'°'; hdT.setAttribute('fill',x.hd!=null&&x.hd_sp!=null&&x.hd-x.hd_sp>10?'#ffb3a8':'#fff'); }
    $('ac-'+a.dev+'-mat').textContent=x.mat==null?'--':plF(x.mat,0)+'°';
    $('ac-'+a.dev+'-chw').textContent=x.chw_vlv==null?'--':Math.round(x.chw_vlv)+'%';
    $('ac-'+a.dev+'-x').textContent=a.mz?(x.hw_vlv==null?'--':Math.round(x.hw_vlv)+'%'):(x.oa_dmp==null?'--':Math.round(x.oa_dmp)+'%');
  });
  const sm=$('ahSum'); if(sm) sm.innerHTML='<div><b>'+list.length+'</b><span>Air handlers</span></div><div><b>'+run+'</b><span>Running</span></div><div><b style="color:'+(alm?'var(--rose)':'var(--mint)')+'">'+alm+'</b><span>Need a look</span></div><div><b>'+(off+nd)+'</b><span>Off'+(nd?' / no data':'')+'</span></div>';
  if($('ahDet')&&AHSEL) ahuDetRefresh(A);
}
/* strip on the main plant view */
function ahuStripHtml(){ return '<div class="panel" style="cursor:pointer" onclick="PLVIEW=\'ahus\';plBuilt=\'\';drawPlant()"><div class="eyebrow" style="display:flex;justify-content:space-between">Air handlers <span style="color:var(--ice)">Open ›</span></div><div id="plAhuStrip" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>'; }
function ahuStrip(A){
  const el=$('plAhuStrip'); if(!el) return;
  const col={bad:'#B3362D',warn:'#9A7B32',run:'#1F7A56',off:'#737D8C',none:'#BFC9D5'};
  el.innerHTML=ahuVals().map(a=>{ const st=ahuState(a,A); return '<span title="'+esc(a.name)+'" style="font-size:12px;font-weight:800;padding:5px 9px;border-radius:99px;color:#fff;background:'+col[st]+'">'+esc(a.tag)+'</span>'; }).join('');
}

/* ---------- detail sheet ---------- */
function ahuOpen(dev){
  AHSEL=dev; const a=ahuVals().find(x=>x.dev===dev); if(!a) return;
  const wr=!(ME&&(ME.role==='viewer'||ME.role==='staff'));
  let h='<div class="ahdet">'+ahuBig(a)+'</div>'+
    '<div class="panel"><div class="eyebrow">Alarms</div><div id="ahDetAlm"></div></div>'+
    '<div class="panel"><div class="eyebrow">Outputs</div><div class="ahbars" id="ahDetBars"></div></div>'+
    '<div class="panel"><div class="eyebrow">Readings</div><div class="pltiles" id="ahDetTiles"></div></div>'+
    '<div class="panel"><div class="plbar" style="justify-content:space-between;margin-bottom:4px"><div class="eyebrow" style="margin:0">Last 4 hours</div>'+
      '<select aria-label="Trend" onchange="AHTR=this.value;ahuChart()"><option value="temps"'+(AHTR==='temps'?' selected':'')+'>Air temperatures</option><option value="outs"'+(AHTR==='outs'?' selected':'')+'>Valves and damper</option></select></div>'+
      '<div class="pllegend" id="ahLeg"></div><div class="plchart" style="height:220px"><svg id="ahChart"></svg></div></div>'+
    '<div class="panel"><div class="eyebrow">BAS points'+(typeof isMgr==='function'&&isMgr()?' and mapping':'')+'</div><div id="eqDetPts" class="dim" style="font-size:13px">'+(PLMODE==='demo'?'Shows every point on this controller once the BAS scanner sends data.':'Loading…')+'</div></div>'+
    '<div class="acts" style="margin-bottom:12px">'+(typeof canWork==='function'&&canWork()?'<button class="btn-2" onclick="ahuRecord(\''+esc(a.tag)+'\')">Equipment record</button>':'')+
      (wr?'<button class="btn" onclick="ahuWo('+dev+')">Make work order</button>':'')+'</div>'+
    '<div id="ahDet"></div>';
  sheet(a.tag+' · '+a.name,a.building+(a.mz?' · multizone':'')+' · BAS '+a.dev,h);
  ahuDetRefresh(plAlarms()); ahuChart();
  if(PLMODE!=='demo'&&typeof eqPts==='function') eqPts('ahu.'+dev);
}
function ahuBig(a){
  const d='big', mz=a.mz;
  let s='<svg viewBox="0 0 640 260" role="img" aria-label="'+esc(a.tag)+' air path">';
  s+='<text x="16" y="62" font-size="11" fill="#a9bdd6" font-weight="700">OUTSIDE AIR</text>';
  s+='<rect x="16" y="70" width="54" height="120" rx="6" fill="#18325a" stroke="#3b5a85" stroke-width="2"/>';
  for(let i=0;i<6;i++) s+='<line id="ab-dmp'+i+'" x1="35" y1="'+(84+i*19)+'" x2="51" y2="'+(84+i*19)+'" stroke="#8DB8E0" stroke-width="4" stroke-linecap="round" style="transform-box:fill-box;transform-origin:center;transition:transform 1s cubic-bezier(.2,.8,.2,1)"/>';
  s+='<text id="ab-oaT" x="43" y="210" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">--</text>';
  s+='<rect x="70" y="80" width="'+(mz?230:470)+'" height="100" fill="#13294b" stroke="#2f4f7a" stroke-width="2"/>';
  s+='<path d="M70 70 L70 40 L200 40" stroke="#2f4f7a" stroke-width="2" fill="none"/><text x="78" y="34" font-size="11" fill="#a9bdd6">RETURN AIR</text><text id="ab-spT" x="200" y="34" font-size="12" fill="#fff" font-weight="800">--</text>';
  s+='<defs><pattern id="abH" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#2b4670"/><line x1="0" y1="0" x2="0" y2="6" stroke="#7f9cc4" stroke-width="2"/></pattern></defs>';
  s+='<rect x="104" y="80" width="16" height="100" fill="url(#abH)" stroke="#5d7aa3"/><text x="112" y="198" text-anchor="middle" font-size="11" fill="#a9bdd6">FILTER</text><text id="ab-dpT" x="112" y="212" text-anchor="middle" font-size="12" fill="#fff" font-weight="700">--</text>';
  s+='<text x="150" y="98" text-anchor="middle" font-size="11" fill="#a9bdd6">MIXED</text><text id="ab-matT" x="150" y="116" text-anchor="middle" font-size="16" fill="#fff" font-weight="800">--</text>';
  s+='<defs><pattern id="abFin" width="4" height="8" patternUnits="userSpaceOnUse"><line x1="2" y1="0" x2="2" y2="8" stroke="#eaf2fb" stroke-width=".9" opacity=".65"/></pattern>'+
     '<radialGradient id="abHub"><stop offset="0" stop-color="#1d3a63"/><stop offset="1" stop-color="#081428"/></radialGradient></defs>';
  s+='<path d="M170 168 L205 150 M178 178 L212 160" stroke="#8DB8E0" stroke-width="2"/>';
  s+='<rect x="150" y="164" width="34" height="20" rx="3" fill="#5a7fae" stroke="#8DB8E0"/><text x="167" y="177" text-anchor="middle" font-size="8" fill="#fff">MOTOR</text>';
  s+='<circle cx="222" cy="130" r="38" fill="url(#abHub)" stroke="#5d7aa3" stroke-width="3"/>';
  s+='<g id="ab-fan" class="pl-spin stop" style="animation-duration:.8s">'+[0,51,103,154,206,257,309].map(r=>'<path d="M222 130 L222 98 Q236 106 227 130Z" fill="#8DB8E0" transform="rotate('+r+' 222 130)"/>').join('')+'</g><circle cx="222" cy="130" r="7" fill="#cfe0f5"/>';
  s+='<text id="ab-fanT" x="222" y="190" text-anchor="middle" font-size="12" fill="#fff" font-weight="700">--</text>';
  if(mz){
    s+='<path d="M300 80 L350 40 L630 40 L630 110 L350 110 L320 130" fill="#13294b" stroke="#2f4f7a" stroke-width="2"/>';
    s+='<path d="M300 180 L350 220 L630 220 L630 150 L350 150 L320 130" fill="#13294b" stroke="#2f4f7a" stroke-width="2"/>';
    s+='<rect id="ab-hc" x="370" y="44" width="22" height="62" rx="4" fill="#e2603a"/><rect x="370" y="44" width="22" height="62" fill="url(#abFin)"/><rect id="ab-cc" x="370" y="154" width="22" height="62" rx="4" fill="#3d8fd6"/><rect x="370" y="154" width="22" height="62" fill="url(#abFin)"/>';
    s+='<text x="381" y="32" text-anchor="middle" font-size="11" fill="#a9bdd6">HW COIL</text><text x="381" y="240" text-anchor="middle" font-size="11" fill="#a9bdd6">CHW COIL</text>';
    s+='<path id="ab-fh" class="ah-flow" style="stroke-width:3.5;stroke-dasharray:1 18" d="M262 118 L340 75 L620 75"/><path id="ab-fc" class="ah-flow" style="stroke-width:3.5;stroke-dasharray:1 18" d="M262 142 L340 185 L620 185"/>';
    s+='<text x="610" y="62" text-anchor="end" font-size="11" fill="#a9bdd6">HOT DECK</text><text id="ab-hdT" x="610" y="100" text-anchor="end" font-size="20" fill="#fff" font-weight="800">--</text>';
    s+='<text x="610" y="172" text-anchor="end" font-size="11" fill="#a9bdd6">COLD DECK</text><text id="ab-cdT" x="610" y="210" text-anchor="end" font-size="20" fill="#fff" font-weight="800">--</text>';
    s+='<text id="ab-hsp" x="404" y="100" font-size="11" fill="#a9bdd6">--</text><text id="ab-csp" x="404" y="210" font-size="11" fill="#a9bdd6">--</text>';
  }else{
    s+='<rect id="ab-cc" x="330" y="84" width="24" height="92" rx="4" fill="#3d8fd6"/><rect x="330" y="84" width="24" height="92" fill="url(#abFin)"/><text x="342" y="198" text-anchor="middle" font-size="11" fill="#a9bdd6">CHW COIL</text>';
    s+='<path id="ab-fc" class="ah-flow" style="stroke-width:3.5;stroke-dasharray:1 18" d="M262 130 L620 130"/>';
    s+='<text x="610" y="104" text-anchor="end" font-size="11" fill="#a9bdd6">SUPPLY AIR</text><text id="ab-cdT" x="610" y="160" text-anchor="end" font-size="22" fill="#fff" font-weight="800">--</text><text id="ab-csp" x="610" y="176" text-anchor="end" font-size="11" fill="#a9bdd6">--</text>';
  }
  return s+'</svg>';
}
function ahuDetRefresh(A){
  const a=ahuVals().find(x=>x.dev===AHSEL); if(!a||!$('ahDetTiles')) return;
  const x=a.v, on=x.fan_status===1, set=(id,t)=>{ const e=$(id); if(e) e.textContent=t; };
  const fan=$('ab-fan'); if(fan) fan.classList.toggle('stop',!on);
  ['ab-fc','ab-fh'].forEach(k=>{ const f=$(k); if(f) f.classList.toggle('on',on); });
  const ang=x.oa_dmp==null?0:(90-x.oa_dmp*.9); for(let i=0;i<6;i++){ const l=$('ab-dmp'+i); if(l) l.style.transform='rotate('+ang+'deg)'; }
  if($('ab-cc')) $('ab-cc').setAttribute('opacity',x.chw_vlv==null?.3:.3+.7*x.chw_vlv/100);
  if($('ab-hc')) $('ab-hc').setAttribute('opacity',x.hw_vlv==null?.3:.3+.7*x.hw_vlv/100);
  const V=plView();
  set('ab-oaT',V.oaDb==null?'--':plF(V.oaDb,0)+'°F'); set('ab-spT',x.space==null?'--':plF(x.space,1)+'°F'); set('ab-matT',x.mat==null?'--':plF(x.mat,1)+'°F');
  set('ab-dpT',x.filter_dp==null?'--':plF(x.filter_dp,2)+'"'); set('ab-fanT',x.fan_cmd==null?'--':(on?'RUNNING':x.fan_cmd===1?'NO STATUS':'OFF'));
  set('ab-cdT',x.cd==null?'--':plF(x.cd,1)+'°F'); set('ab-hdT',x.hd==null?'--':plF(x.hd,1)+'°F');
  set('ab-csp',x.cd_sp==null?'':'setpoint '+plF(x.cd_sp,1)+'°F'); set('ab-hsp',x.hd_sp==null?'':'setpoint '+plF(x.hd_sp,1)+'°F');
  if($('ab-cdT')) $('ab-cdT').setAttribute('fill',x.cd!=null&&x.cd_sp!=null&&x.cd-x.cd_sp>8?'#ffb3a8':'#fff');
  if($('ab-hdT')) $('ab-hdT').setAttribute('fill',x.hd!=null&&x.hd_sp!=null&&x.hd-x.hd_sp>10?'#ffb3a8':'#fff');
  const mine=A.filter(r=>String(r.rule||'').startsWith('ahu.'+a.dev+'.'));
  $('ahDetAlm').innerHTML=mine.length?mine.map(r=>'<div class="plalm '+(r.level==='critical'?'':'pl-warn')+'"><h4>'+esc(r.title)+'</h4><p>'+esc(r.detail)+'</p><ul>'+(plAhuChecks(r.rule)||[]).map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>').join(''):'<div class="dim" style="font-size:14px">No alarms on this unit.</div>';
  const bar=(l,v,c)=>'<div class="ahbar"><div class="l"><span>'+l+'</span><b>'+(v==null?'--':Math.round(v)+'%')+'</b></div><div class="t"><i style="width:'+(v==null?0:plClamp(v,0,100))+'%;background:'+c+'"></i></div></div>';
  $('ahDetBars').innerHTML=bar('Chilled water valve',x.chw_vlv,'#3d8fd6')+(a.mz?bar('Hot water valve',x.hw_vlv,'#e2603a'):'')+bar('Outside air damper',x.oa_dmp,'#8DB8E0');
  const hrs=x.sf_hours;
  $('ahDetTiles').innerHTML=[
    plTile('Mode',x.occ==null?'?':x.occ?'OCC':'UNOCC',''),
    plTile('Supply fan',x.fan_cmd==null?'?':on?'ON':x.fan_cmd?'FAIL':'OFF','',x.fan_cmd===1&&!on?'bad':''),
    plTile(a.mz?'Cold deck':'Supply air',plF(x.cd),'°F',x.cd!=null&&x.cd_sp!=null&&x.cd-x.cd_sp>8&&on?'warn':''),
    a.mz?plTile('Hot deck',plF(x.hd),'°F',x.hd!=null&&x.hd_sp!=null&&x.hd-x.hd_sp>10&&on?'warn':''):'',
    plTile('Mixed air',plF(x.mat),'°F'),
    plTile('Space / return',plF(x.space),'°F'),
    plTile('CHW request',x.chw_req==null?'?':x.chw_req?'YES':'NO',''),
    plTile('Fan runtime',hrs==null?'?':Math.round(hrs).toLocaleString(),'hr',hrs>60000?'warn':''),
    plTile('Filter drop',x.filter_dp==null?'?':plF(x.filter_dp,2),'in. wc',x.filter_dp>1?'warn':'')
  ].join('');
  if(PLMODE==='demo') ahuChart();
}
async function ahuChart(){
  const svg=$('ahChart'); if(!svg) return;
  const a=ahuMeta().find(x=>x.dev===AHSEL); if(!a) return;
  const S=AHTR==='temps'?[['cd',a.mz?'Cold deck':'Supply air','#3d8fd6'],['hd','Hot deck','#e2603a'],['mat','Mixed air','#9aa3ad'],['space','Space','#17325C']].filter(z=>a.mz||z[0]!=='hd')
    :[['chw','CHW valve %','#3d8fd6'],['hw','HW valve %','#e2603a'],['oa','OA damper %','#8DB8E0']].filter(z=>a.mz||z[0]!=='hw');
  $('ahLeg').innerHTML=S.map(([,n,c])=>'<span><i style="background:'+c+'"></i>'+n+'</span>').join('');
  let series={}, lab;
  if(PLMODE==='demo'){ const d=(AHHIST[a.dev]||[]).slice(-240); S.forEach(([k])=>series[k]=d.map((r,i)=>[i,r[k]]).filter(p=>p[1]!=null)); lab=i=>d[i]?plClock(d[i].t):''; }
  else{
    const map={cd:'cd',hd:'hd',mat:'mat',space:'space',chw:'chw_vlv',hw:'hw_vlv',oa:'oa_dmp'};
    try{ const r=await api('/plant/trend?hours=4&keys='+S.map(([k])=>'ahu.'+a.dev+'.'+map[k]).join(',')); S.forEach(([k])=>series[k]=r.series['ahu.'+a.dev+'.'+map[k]]||[]); }catch(e){}
    lab=ts=>plTime(ts);
  }
  const W=svg.clientWidth||600,H=svg.clientHeight||220,all=S.flatMap(([k])=>series[k]||[]);
  if(all.length<2){ svg.innerHTML='<text x="20" y="40" fill="var(--dim)" font-size="14">No readings in this window yet.</text>'; return; }
  const xs=all.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs);
  let lo=Math.min(...all.map(p=>p[1])),hi=Math.max(...all.map(p=>p[1])); if(AHTR==='outs'){lo=-5;hi=105} const pad=(hi-lo)*.1||2; lo-=pad; hi+=pad;
  const L=34,R=8,T=8,B=24,X=v=>L+(W-L-R)*(v-x0)/((x1-x0)||1),Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  let o=''; for(let i=0;i<=4;i++){ const v=lo+(hi-lo)*i/4; o+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="var(--edge)"/><text x="'+(L-5)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="var(--dim)">'+v.toFixed(0)+'</text>'; }
  for(let i=0;i<=3;i++){ const v=x0+(x1-x0)*i/3; o+='<text x="'+X(v)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':i===3?'end':'middle')+'" font-size="11" fill="var(--dim)">'+esc(lab(PLMODE==='demo'?Math.round(v):v))+'</text>'; }
  S.forEach(([k,,c])=>{ const s=series[k]||[]; if(s.length>1) o+='<polyline fill="none" stroke="'+c+'" stroke-width="2.2" points="'+s.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ')+'"/>'; });
  svg.innerHTML=o;
}
function ahuRecord(tag){ closeSheet(); if($('aptIn')){ $('aptIn').value=tag; showTab('record'); if(typeof openUnit==='function') openUnit(); } }
async function ahuWo(dev){
  const a=ahuVals().find(x=>x.dev===dev); if(!a) return;
  const mine=plAlarms().filter(r=>String(r.rule||'').startsWith('ahu.'+dev+'.'));
  if(PLMODE==='demo'){ toast('Demo data. No work order made.'); return; }
  const x=a.v;
  const desc=(mine.length?mine.map(r=>r.title+': '+r.detail+'\nChecks:\n'+(plAhuChecks(r.rule)||[]).map(c=>'- '+c).join('\n')).join('\n\n')+'\n\n':'')+
    'Readings: '+(a.mz?'cold deck '+plF(x.cd)+'°F, hot deck '+plF(x.hd)+'°F':'supply '+plF(x.cd)+'°F')+', mixed air '+plF(x.mat)+'°F, CHW valve '+(x.chw_vlv==null?'?':Math.round(x.chw_vlv))+'%'+(a.mz?', HW valve '+(x.hw_vlv==null?'?':Math.round(x.hw_vlv))+'%':'')+', OA damper '+(x.oa_dmp==null?'?':Math.round(x.oa_dmp))+'%.';
  try{
    const r=await api('/workorders',{method:'POST',body:{title:(mine[0]?mine[0].title:a.tag+' '+a.name+' check').slice(0,160),building:a.building,location:a.tag+' · '+a.name,
      category:'HVAC',priority:mine.some(m=>m.level==='critical')?'high':'normal',description:desc}});
    const wo=r.workorder&&r.workorder.id;
    for(const m of mine) if(!m.wo_id) try{ await api('/plant/alarms/'+m.id+'/wo',{method:'POST',body:{wo_id:wo}}); }catch(e){}
    toast('Work order #'+wo+' opened');
  }catch(e){ toast(e.message); }
}
