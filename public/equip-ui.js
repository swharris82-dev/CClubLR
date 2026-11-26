/* Clubhouse IQ: fan coils, exhaust fans, walk-ins, zones and every other BAS
   device on the Plant screen. Live values come from the BAS scanner on the
   plant gateway (bas.js). Demo mode simulates each unit, seeded with what
   was found on Compass in October and November. */
let EQSIM=null, EQHIST={}, EQSEL=null, EQBAS=null;
const EQ_VIEWS={fcus:'fcu',efs:'ef',refs:'ref',zones:'zone'};
const EQ_TITLE={fcu:'Fan coils',ef:'Exhaust fans',ref:'Walk-ins and refrigeration',zone:'Zones',other:'Other BAS devices'};
const EQ_CHECKS={
  fan:['Is it spinning? No: disconnect, breaker, motor, belt, starter or relay (RIB). Yes: bad status switch or current sensor.','Check the HOA switch at the fan. EF-5 was found in Auto, not running, and had to go to Hand.','After the fix, reset the fan alarm on the Compass page.'],
  sensor:['A reading like -148°F is an open or unplugged sensor, not the room.','Check the wall sensor and its wiring at the controller.','Until it is fixed the unit runs blind. Look for overrides people set to compensate (FCU-13 had its CHW valve held at 100%).'],
  temp:['Compare the wall sensor with a thermometer.','Check Command Mode for a manual override and the schedule.','Check the valve outputs for a held override (a number instead of null in the entry box).'],
  nocool:['Look for an override holding the valve.','Feel the CHW pipes at the coil. Both warm: no flow (isolation valves, strainer, actuator, air-bound coil).','Confirm the plant chilled water supply temperature.'],
  hot:['Put a thermometer in the box before acting. A defrost cycle runs warm for 20 to 30 minutes.','Check the door gasket, the evaporator for ice, the condenser and its water or fan.','If it is real and climbing, tell the kitchen and move product.']
};
function plEqChecks(rule){ const m=String(rule||'').match(/^(fcu|ef|ref|zone|dev)\.[\w-]+\.(\w+)$/); return m?EQ_CHECKS[m[2]]:null; }
function eqList(){ return PL&&Array.isArray(PL.equip)?PL.equip:[]; }
function eqRoles(kind){ return (PL&&PL.equip_roles&&(PL.equip_roles[kind]||PL.equip_roles.zone))||[]; }

/* ---------- demo simulation ---------- */
function eqSimReset(){
  EQSIM={}; EQHIST={};
  eqList().filter(e=>!e.discovered).forEach(e=>{
    const kit=/kitchen|pastry|grill/i.test(e.name);
    EQSIM[e.id]={e,space:kit?73:71+plR(1),sp:kit?70:72,chw:20,hw:0,sat:60,temp:e.hi===10?12.5:(e.tag==='REF-2'?35.5:36.9),def:0};
  });
}
function eqSimStep(s){
  if(!EQSIM||!Object.keys(EQSIM).length) eqSimReset();
  const hr=(s.t/60)%24, oa=s.oaDb, chws=(s.chws||46);
  Object.values(EQSIM).forEach(u=>{
    const e=u.e, t=e.tag; let v={};
    if(e.kind==='fcu'){
      const kit=/kitchen|pastry|grill/i.test(e.name);
      const occ=t==='FCU-6'?0:(kit?(hr>=5):(hr>=6&&hr<23));
      const cmd=occ?1:0; let st=cmd;
      if(t==='FCU-13'||t==='FCU-11') st=0;
      if(t==='FCU-3'){ u.vals=null; return; } // offline on the BAS
      const load=(oa-60)*.03+(kit?.12:.02);
      if(st){
        const err=u.space-u.sp;
        u.chw=plClamp(u.chw+err*10,0,100); u.hw=plClamp(u.hw-err*10,0,100);
        if(t==='FCU-4'){ u.chw=100; u.sat+=(68.6-u.sat)*.3; }
        else if(u.hw>5){ u.sat+=(u.space+u.hw*.35-u.sat)*.4; u.chw=0; }
        else u.sat+=(u.space-(u.space-(chws+6))*u.chw/100*.85-u.sat)*.4;
        u.space+=load-(u.space-u.sat)*.02+plR(.04);
      }else{ u.chw*=.5; u.hw=t==='FCU-11'?100:u.hw*.5; u.sat+=(u.space-u.sat)*.2; u.space+=((oa*.2+70*.8)-u.space)*.01+(t==='FCU-11'?-.01:0); }
      if(t==='FCU-11') u.space=Math.max(60,u.space);
      u.space=plClamp(u.space,t==='FCU-11'?60:66,t==='FCU-4'?75.5:78);
      v={occ:occ?1:0,fan_cmd:t==='FCU-13'?1:cmd,fan_status:st,space_sp:u.sp,space:t==='FCU-13'?-148:u.space,sat:u.sat,chw_vlv:t==='FCU-13'?30:u.chw,hw_vlv:u.hw,rh:t==='FCU-13'?3:48+plR(2)};
    }else if(e.kind==='ef'){
      const st=(t==='EF-9'||t==='EF-MR')?0:1;
      v={cmd:1,status:st,temp:t==='EF-MR'?79+Math.sin(s.t/90)*2+plR(.2):null};
    }else if(e.kind==='ref'){
      // defrost every 6 hours for 25 minutes
      const inDef=(s.t%360)<25 && e.hi===10;
      const base=e.hi===10?12.5:(t==='REF-2'?35.5:(t==='WI-BEER'?37.5:36.9));
      u.temp+=((inDef?32:base)-u.temp)*(inDef?.15:.08)+plR(.15);
      v={temp:u.temp,sp:e.hi===10?0:36};
    }else if(e.kind==='zone'){
      if(t==='Z-5-1') v={occ:1,space_sp:68,space:71+plR(.2),sat:90+plR(.4),damper:0,htg:0,clg:100};
      else v={occ:1,space_sp:72,space:71+plR(.2),sat:77.9+plR(.4),damper:58,htg:17,clg:0};
    }
    u.vals=v;
    const h=EQHIST[e.id]=EQHIST[e.id]||[]; h.push(Object.assign({t:s.t},v)); if(h.length>480) h.shift();
  });
}
function eqVals(){
  return eqList().map(e=>{
    if(PLMODE==='demo'){ const u=EQSIM&&EQSIM[e.id]; return Object.assign({},e,{v:u&&u.vals?u.vals:{},ts:u&&u.vals?'demo':null}); }
    return Object.assign({},e,{v:e.values||{}});
  });
}
function plEqRules(V){
  const out=[];
  eqVals().forEach(e=>{
    if(!e.ts) return;
    const x=e.v, add=(r,level,title,detail)=>out.push({rule:e.id+'.'+r,level,equipment:e.tag,title,detail});
    const bad=t=>t!=null&&(t<10||t>120);
    if(e.kind==='fcu'||e.kind==='zone'){
      if(x.fan_cmd===1&&x.fan_status===0) add('fan','critical',e.tag+' fan commanded on but not running',e.name+'. Fan status off with the command on.');
      if(bad(x.space)) add('sensor','warn',e.tag+' space sensor reads '+plF(x.space)+'°F',e.name+'. A reading like this is a failed or open wall sensor, not the room.');
      else if(x.space!=null&&x.space_sp!=null&&Math.abs(x.space-x.space_sp)>5&&x.occ!==0) add('temp','warn',e.tag+' space '+Math.round(Math.abs(x.space-x.space_sp))+'°F '+(x.space>x.space_sp?'over':'under')+' setpoint',e.name+': '+plF(x.space)+'°F against '+plF(x.space_sp)+'°F.');
      if(x.chw_vlv>=95&&x.sat!=null&&x.sat>62&&x.fan_status!==0) add('nocool','warn',e.tag+' CHW valve wide open, supply '+plF(x.sat)+'°F',e.name+". The coil isn't cooling: check CHW flow, isolation valves, actuator, or an override holding the valve.");
    }
    if(e.kind==='ef'&&x.cmd===1&&x.status===0) add('fan','warn',e.tag+' commanded on but not proven',e.name+'. Fan status off with the command on.');
    if(e.kind==='ref'&&x.temp!=null&&e.hi!=null){
      if(x.temp>e.hi+10) add('hot','critical',e.tag+' at '+plF(x.temp)+'°F',e.name+' is '+Math.round(x.temp-e.hi)+'°F over its '+e.hi+'°F limit.');
      else if(x.temp>e.hi) add('hot','warn',e.tag+' at '+plF(x.temp)+'°F',e.name+' is over its '+e.hi+'°F limit. Could be defrost; check again in 30 minutes.');
    }
  });
  return out;
}
function eqState(e,A){
  const mine=A.filter(a=>String(a.rule||'').startsWith(e.id+'.'));
  if(mine.some(a=>a.level==='critical')) return 'bad';
  if(mine.length) return 'warn';
  if(!e.ts) return 'none';
  const x=e.v;
  if(e.kind==='ref') return 'run';
  if(e.kind==='ef') return x.status===1?'run':x.cmd===0?'off':'run';
  if(e.kind==='fcu') return x.fan_status===1?'run':x.fan_status===0?'off':'run';
  return 'run';
}

/* ---------- styles ---------- */
(function(){
  const s=document.createElement('style');
  s.textContent=
  '.eqc{background:linear-gradient(160deg,#13294b,#0c1c36);border-radius:var(--r);color:#fff;padding:10px 12px 12px;cursor:pointer;box-shadow:var(--shadow);border:2px solid transparent;animation:ahin .45s both;position:relative;overflow:hidden}'+
  '.eqc:active{transform:scale(.98)}.eqc.st-bad{border-color:#ff5a47;animation:ahin .45s both,ahglow 1.4s ease-in-out infinite}.eqc.st-warn{border-color:#ffc53d}.eqc.st-none{opacity:.72}'+
  '.eqc .hd{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.eqc .tg{font-weight:800;font-size:17px}.eqc .nm{font-size:12px;color:#a9bdd6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.eqc .chip{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;background:#1f3a63;color:#cfe0f5}.eqc.st-run .chip{background:#1e6b4f;color:#d6f5e6}.eqc.st-bad .chip{background:#b3362d}.eqc.st-warn .chip{background:#9a7b32}'+
  '.eqc svg{display:block;width:100%;height:auto;margin:6px 0 2px}.eqc .rd{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:11px;color:#a9bdd6}.eqc .rd b{display:block;font-size:15px;color:#fff}'+
  '.eqc .vf{position:absolute;right:10px;bottom:8px;font-size:10px;color:#ffd77a}'+
  '.eqbig{background:linear-gradient(160deg,#13294b,#0c1c36);border-radius:var(--r);padding:8px;margin-bottom:12px}.eqbig svg{display:block;width:100%;height:auto}'+
  '.eqpts{width:100%;border-collapse:collapse;font-size:13px}.eqpts td{padding:6px 4px;border-bottom:1px solid var(--edge);vertical-align:middle}.eqpts td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'+
  '.eqpts select{font-size:12px;padding:3px 4px;max-width:120px}.eqpts .ob{font-family:var(--mono);font-size:11.5px;color:var(--dim)}'+
  '.eq-wheel{transform-box:fill-box;transform-origin:center;animation:eqspin .7s linear infinite}.eq-wheel.stop{animation-play-state:paused}'+
  '.eq-slide{animation:eqslide .25s linear infinite}.eq-slide.stop{animation-play-state:paused}@keyframes eqslide{to{transform:translateX(8px)}}'+
  '.eq-up{animation:equp 1.3s linear infinite;opacity:0}.eq-up.on{opacity:1}'+
  '.eq-frost{animation:eqtw 2.4s ease-in-out infinite}.eq-led{animation:eqled 1.2s steps(2) infinite}'+
  '@keyframes eqspin{to{transform:rotate(360deg)}}@keyframes equp{0%{transform:translateY(8px);opacity:0}30%{opacity:.9}100%{transform:translateY(-16px);opacity:0}}'+
  '@keyframes eqtw{0%,100%{opacity:.2}50%{opacity:1}}@keyframes eqled{50%{opacity:.25}}'+
  '@media(prefers-reduced-motion:reduce){.eq-slide,.eq-wheel,.eq-up,.eq-frost,.eq-led{animation:none}.eq-up.on{opacity:.8}}';
  document.head.appendChild(s);
})();

/* ---------- machine drawings ---------- */
const EQG='<defs>'+
  '<linearGradient id="eqMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c5f8f"/><stop offset="1" stop-color="#1b3358"/></linearGradient>'+
  '<linearGradient id="eqMetal2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a7fae"/><stop offset="1" stop-color="#243f66"/></linearGradient>'+
  '<linearGradient id="eqBox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8f2"/><stop offset="1" stop-color="#a9b9cc"/></linearGradient>'+
  '<pattern id="eqFins" width="3" height="6" patternUnits="userSpaceOnUse"><rect width="3" height="6" fill="#1a3155"/><line x1="1.5" y1="0" x2="1.5" y2="6" stroke="#9fb7d6" stroke-width=".8"/></pattern>'+
  '</defs>';
function eqTempCol(t,lo,hi){ if(t==null) return '#6b7d95'; const k=plClamp((t-lo)/(hi-lo),0,1); return k<.5?'#3d8fd6':k<.8?'#e0a23a':'#e2603a'; }
function eqSvg(e,big){
  const id=(big?'b':'c')+'-'+e.id.replace(/[^\w]/g,'_'), x=e.v||{};
  let s='<svg viewBox="0 0 260 110" aria-hidden="true">'+EQG;
  if(e.kind==='fcu'){
    const on=x.fan_status===1, cw=(x.chw_vlv||0)/100, hw=(x.hw_vlv||0)/100;
    // return grille, cabinet
    s+='<rect x="8" y="24" width="214" height="66" rx="7" fill="url(#eqMetal)" stroke="#5d7aa3"/>';
    s+='<rect x="8" y="24" width="214" height="9" rx="4" fill="#4d70a0" opacity=".6"/>';
    for(let i=0;i<6;i++) s+='<line x1="16" y1="'+(40+i*8)+'" x2="34" y2="'+(40+i*8)+'" stroke="#7f9cc4" stroke-width="2"/>';
    // filter
    s+='<rect x="40" y="36" width="7" height="48" fill="#cfd8e3" opacity=".7"/>';
    // blower
    s+='<circle cx="82" cy="58" r="22" fill="#0b1a33" stroke="#8DB8E0" stroke-width="2"/>';
    s+='<g class="eq-wheel'+(on?'':' stop')+'">'+Array.from({length:12},(_,i)=>'<line x1="82" y1="58" x2="'+(82+18*Math.cos(i*Math.PI/6)).toFixed(1)+'" y2="'+(58+18*Math.sin(i*Math.PI/6)).toFixed(1)+'" stroke="#8DB8E0" stroke-width="2.2"/>').join('')+'<circle cx="82" cy="58" r="17" fill="none" stroke="#8DB8E0" stroke-width="1.5"/></g>';
    s+='<circle cx="82" cy="58" r="4" fill="#e6eef8"/>';
    // coil (fins) tinted by valves
    s+='<rect x="124" y="32" width="26" height="52" fill="url(#eqFins)" stroke="#5d7aa3"/>';
    s+='<rect x="124" y="32" width="26" height="52" fill="#3d8fd6" opacity="'+(.15+cw*.6).toFixed(2)+'"/>';
    s+='<rect x="124" y="32" width="26" height="52" fill="#e2603a" opacity="'+(hw*.6).toFixed(2)+'"/>';
    // valves under the coil
    s+='<text x="126" y="100" font-size="8.5" fill="#8fc0ee">CHW '+(x.chw_vlv==null?'--':Math.round(x.chw_vlv)+'%')+'</text><text x="126" y="20" font-size="8.5" fill="#f2a58e">HW '+(x.hw_vlv==null?'--':Math.round(x.hw_vlv)+'%')+'</text>';
    // supply grille + airflow
    s+='<rect x="222" y="30" width="30" height="56" rx="3" fill="#13294b" stroke="#5d7aa3"/>';
    for(let i=0;i<3;i++) s+='<path class="ah-flow'+(on?' on':'')+'" style="stroke:'+(x.sat!=null&&x.sat>80?'#ffb39a':'#bfe0ff')+'" d="M156 '+(46+i*12)+' L250 '+(46+i*12)+'"/>';
    s+='<text x="237" y="22" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">'+(x.sat==null?'--':plF(x.sat,0)+'°')+'</text>';
    s+='<text x="237" y="100" text-anchor="middle" font-size="8.5" fill="#a9bdd6">SUPPLY</text>';
  }else if(e.kind==='ef'){
    const on=x.status===1, alarm=x.cmd===1&&x.status===0;
    s+='<rect x="0" y="92" width="260" height="18" fill="#2a3e5c"/><line x1="0" y1="92" x2="260" y2="92" stroke="#5d7aa3"/>';
    s+='<path d="M86 92 L94 70 L166 70 L174 92 Z" fill="url(#eqMetal2)" stroke="#7f9cc4"/>';
    s+='<path d="M80 70 Q130 22 180 70 Z" fill="url(#eqMetal)" stroke="#8DB8E0" stroke-width="1.5"/>';
    s+='<ellipse cx="130" cy="70" rx="44" ry="7" fill="#0b1a33" stroke="#8DB8E0"/>';
    const cid='efc'+id;
    s+='<clipPath id="'+cid+'"><ellipse cx="130" cy="70" rx="42" ry="6"/></clipPath>';
    s+='<g clip-path="url(#'+cid+')"><g class="eq-slide'+(on?'':' stop')+'">'+Array.from({length:14},(_,i)=>'<line x1="'+(78+i*8)+'" y1="62" x2="'+(82+i*8)+'" y2="78" stroke="#8DB8E0" stroke-width="2.4"/>').join('')+'</g></g>';
    s+='<circle cx="130" cy="70" r="3" fill="#e6eef8"/>';
    for(let i=0;i<4;i++) s+='<path class="eq-up'+(on?' on':'')+'" style="animation-delay:'+(i*.32)+'s" d="M'+(100+i*20)+' 40 l0 -14 m-5 5 l5 -5 l5 5" stroke="#cfe0f5" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    if(alarm) s+='<g><circle cx="214" cy="40" r="16" fill="#b3362d"/><text x="214" y="46" text-anchor="middle" font-size="18" font-weight="900" fill="#fff">!</text></g>';
    if(x.temp!=null) s+='<text x="20" y="40" font-size="11" fill="#a9bdd6">ROOM</text><text x="20" y="58" font-size="17" font-weight="800" fill="#fff">'+plF(x.temp,0)+'°</text>';
  }else if(e.kind==='ref'){
    const t=x.temp, lim=e.hi||41, col=eqTempCol(t,lim-15,lim+8), frz=lim<=10;
    s+='<rect x="18" y="14" width="150" height="86" rx="5" fill="url(#eqBox)" stroke="#e9f0f8"/>';
    for(let i=1;i<4;i++) s+='<line x1="'+(18+i*37.5)+'" y1="14" x2="'+(18+i*37.5)+'" y2="100" stroke="#93a6bd"/>';
    s+='<rect x="62" y="28" width="44" height="72" rx="3" fill="#c7d4e2" stroke="#7d91aa"/><rect x="98" y="58" width="4" height="14" rx="2" fill="#5d6f86"/>';
    s+='<rect x="70" y="36" width="28" height="16" rx="2" fill="#0b1a33"/><text x="84" y="48" text-anchor="middle" font-size="10" font-weight="800" fill="'+col+'">'+(t==null?'--':plF(t,0))+'</text>';
    if(frz) for(let i=0;i<5;i++) s+='<text class="eq-frost" style="animation-delay:'+(i*.45)+'s" x="'+(28+i*28)+'" y="'+(24+(i%2)*62)+'" font-size="10" fill="#e9f6ff">✱</text>';
    // thermometer
    const k=t==null?0:plClamp((t-(lim-25))/40,0,1);
    s+='<rect x="196" y="12" width="16" height="78" rx="8" fill="#0b1a33" stroke="#8DB8E0"/><circle cx="204" cy="94" r="12" fill="'+col+'" stroke="#8DB8E0"/>';
    s+='<rect x="200" y="'+(86-70*k).toFixed(1)+'" width="8" height="'+(70*k+4).toFixed(1)+'" rx="4" fill="'+col+'" style="transition:all .8s"/>';
    const ly=(86-70*plClamp((lim-(lim-25))/40,0,1)).toFixed(1); s+='<line x1="190" y1="'+ly+'" x2="218" y2="'+ly+'" stroke="#ffc53d" stroke-dasharray="3 2"/><text x="222" y="'+(+ly+4)+'" font-size="9" fill="#ffd77a">'+lim+'°</text>';
  }else{
    const dmp=x.damper==null?null:x.damper/100;
    s+='<rect x="10" y="20" width="150" height="80" rx="6" fill="#13294b" stroke="#5d7aa3"/>';
    s+='<rect x="18" y="28" width="60" height="18" rx="3" fill="#e2603a" opacity=".55"/><text x="48" y="41" text-anchor="middle" font-size="9" fill="#fff">HOT DECK</text>';
    s+='<rect x="18" y="74" width="60" height="18" rx="3" fill="#3d8fd6" opacity=".55"/><text x="48" y="87" text-anchor="middle" font-size="9" fill="#fff">COLD DECK</text>';
    if(dmp!=null){ const ang=-60+120*(1-dmp); s+='<g transform="rotate('+ang.toFixed(0)+' 96 60)" style="transition:transform .8s"><rect x="94" y="40" width="4" height="40" rx="2" fill="#cfe0f5"/></g><circle cx="96" cy="60" r="4" fill="#fff"/>'; }
    s+='<path class="ah-flow on" style="stroke:'+(x.sat!=null&&x.sat>80?'#ffb39a':'#bfe0ff')+'" d="M100 60 L156 60"/>';
    s+='<rect x="172" y="20" width="78" height="80" rx="6" fill="#18325a" stroke="#5d7aa3"/><text x="211" y="40" text-anchor="middle" font-size="9" fill="#a9bdd6">ROOM</text>';
    s+='<text x="211" y="64" text-anchor="middle" font-size="20" font-weight="800" fill="#fff">'+(x.space==null?'--':plF(x.space,0)+'°')+'</text>';
    s+='<text x="211" y="82" text-anchor="middle" font-size="9" fill="#a9bdd6">'+(x.space_sp==null?'':'set '+plF(x.space_sp,0)+'°')+'</text>';
    if(e.discovered&&x.space==null) s+='<circle class="eq-led" cx="150" cy="28" r="4" fill="#5ee6a0"/>';
  }
  return s+'</svg>';
}
function eqReadout(e){
  const x=e.v||{}, T=v=>v==null?'--':plF(v,0)+'°', P=v=>v==null?'--':Math.round(v)+'%';
  if(e.kind==='fcu') return [['Space',x.space!=null&&(x.space<10||x.space>120)?'BAD':T(x.space)],['Setpoint',T(x.space_sp)],['Fan',x.fan_status==null?'--':x.fan_status?'ON':x.fan_cmd?'FAIL':'OFF']];
  if(e.kind==='ef') return [['Command',x.cmd==null?'--':x.cmd?'ON':'OFF'],['Status',x.status==null?'--':x.status?'RUNNING':'OFF'],x.temp!=null?['Room',T(x.temp)]:['BAS device',e.dev==null?'by name':String(e.dev)]];
  if(e.kind==='ref') return [['Box',T(x.temp)],['Limit',e.hi?e.hi+'°':'--'],['Setpoint',T(x.sp)]];
  return [['Space',T(x.space)],['Supply',T(x.sat)],['Damper',P(x.damper)]];
}
const EQ_ST={bad:'ALARM',warn:'CHECK',run:'RUNNING',off:'OFF',none:'NO DATA'};
function eqCard(e,i){
  return '<div class="eqc" id="eq-'+e.id.replace(/[^\w]/g,'_')+'" style="animation-delay:'+(i*40)+'ms" onclick="eqOpen(\''+e.id+'\')"></div>';
}
function eqCardInner(e,st){
  return '<div class="hd"><span class="tg">'+esc(e.tag)+'</span><span class="chip">'+(e.kind==='ref'&&st==='run'?'OK':EQ_ST[st])+'</span></div><div class="nm">'+esc(e.name)+'</div>'+eqSvg(e,false)+
    '<div class="rd">'+eqReadout(e).map(([l,v])=>'<div>'+l+'<b>'+v+'</b></div>').join('')+'</div>'+(e.verify?'<span class="vf">dev # to verify</span>':'');
}

/* ---------- views ---------- */
function eqViewHtml(view){
  if(view==='bas') return '<div id="eqBas"><div class="dim">Loading BAS devices…</div></div>';
  const kind=EQ_VIEWS[view], list=eqList().filter(e=>e.kind===kind);
  return '<div class="ahsum" id="eqSum"></div><div class="ahgrid" id="eqGrid">'+list.map(eqCard).join('')+'</div>'+
    '<div class="dim" style="font-size:12.5px;margin-top:10px">'+(PLMODE==='demo'?'Demo values start from the Compass findings in October and November.':'Values come from the BAS scanner on the plant gateway.')+
    (list.some(e=>e.verify)?' "Dev # to verify" means the BAS device number came from the numbering pattern and should be checked on its Compass page.':'')+'</div>';
}
function eqRefresh(view,A){
  if(view==='bas') return;
  const kind=EQ_VIEWS[view]; const list=eqVals().filter(e=>e.kind===kind); let c={run:0,alarm:0,off:0,none:0};
  list.forEach(e=>{ const st=eqState(e,A), el=$('eq-'+e.id.replace(/[^\w]/g,'_')); if(!el) return;
    if(st==='bad'||st==='warn')c.alarm++; else c[st]=(c[st]||0)+1;
    el.className='eqc st-'+st; el.innerHTML=eqCardInner(e,st); });
  const sm=$('eqSum'); if(sm) sm.innerHTML='<div><b>'+list.length+'</b><span>'+esc(EQ_TITLE[kind])+'</span></div><div><b>'+c.run+'</b><span>'+(kind==='ref'?'In range':'Running')+'</span></div><div><b style="color:'+(c.alarm?'var(--rose)':'var(--mint)')+'">'+c.alarm+'</b><span>Need a look</span></div><div><b>'+(c.off+c.none)+'</b><span>Off'+(c.none?' / no data':'')+'</span></div>';
  if(EQSEL&&$('eqDet')) eqDetRefresh(A);
}
async function eqBasLoad(){
  const el=$('eqBas'); if(!el) return;
  let d=null; try{ d=await api('/plant/bas'); }catch(e){}
  const devs=d&&d.devices||[];
  const known={}; (d&&d.known||eqList()).forEach(k=>{ if(k.dev!=null) known[k.dev]=known[k.dev]?known[k.dev]+', '+k.tag:k.tag; });
  const ahu=typeof ahuMeta==='function'?ahuMeta():[]; ahu.forEach(a=>known[a.dev]=a.tag);
  known[120]='Plant controller (VLX)'; known[5001]='York chiller'; known[505002]='Tower VFD';
  let h='<div class="panel"><div class="eyebrow">Every BAS device</div>';
  if(!devs.length){
    h+='<p style="font-size:14px;margin-top:0">No scan has come in yet. Once the BAS scanner runs on the plant PC, every controller it finds is listed here with all of its points and live values. These are the devices Clubhouse IQ already expects:</p>'+
      '<table class="eqpts"><tbody>'+Object.entries(known).sort((a,b)=>a[0]-b[0]).map(([dv,t])=>'<tr><td class="ob">'+dv+'</td><td>'+esc(t)+'</td></tr>').join('')+'</tbody></table>';
  }else{
    h+='<p class="dim" style="font-size:13px;margin-top:0">'+devs.length+' devices, '+devs.reduce((s,x)=>s+x.points,0).toLocaleString()+' points. Tap a device for every point and its live value.</p>'+
      '<table class="eqpts"><tbody>'+devs.map(x=>'<tr onclick="eqDevSheet('+x.dev+')" style="cursor:pointer"><td class="ob">'+x.dev+'</td><td><b>'+esc(x.name||'Device '+x.dev)+'</b><div class="dim" style="font-size:11.5px">'+esc([known[x.dev],x.model].filter(Boolean).join(' · '))+'</div></td><td class="n">'+x.points+' pts<div class="dim" style="font-size:11px">'+(x.last_seen?plAgo(x.last_seen):'')+'</div></td></tr>').join('')+'</tbody></table>';
  }
  el.innerHTML=h+'</div>';
}
async function eqDevSheet(dev){
  let d; try{ d=await api('/plant/bas/'+dev); }catch(e){ toast(e.message); return; }
  const pts=d.points||[];
  sheet((d.device&&d.device.name)||('Device '+dev),'BAS device '+dev+(d.device&&d.device.address?' · '+d.device.address:''),
    '<div class="panel"><input id="eqPtQ" placeholder="Filter points" oninput="eqPtFilter()" style="width:100%;margin-bottom:8px"><table class="eqpts" id="eqPtT"><tbody>'+
    pts.map(p=>'<tr data-q="'+esc((p.obj+' '+p.name).toLowerCase())+'"><td class="ob">'+esc(p.obj)+'</td><td>'+esc(p.name)+'</td><td class="n">'+eqFmtPt(p)+'</td></tr>').join('')+'</tbody></table></div>');
}
function eqPtFilter(){ const q=($('eqPtQ').value||'').toLowerCase(); document.querySelectorAll('#eqPtT tr').forEach(r=>r.style.display=r.dataset.q.includes(q)?'':'none'); }
function eqFmtPt(p){ if(p.value==null) return '<span class="dim">'+esc(p.text||'--')+'</span>'; const b=/^(BI|BO|BV)/.test(p.obj); return b?(p.value?'ON':'OFF'):(Math.round(p.value*10)/10)+' '+esc(p.units||''); }

/* ---------- detail ---------- */
async function eqOpen(id){
  EQSEL=id; const e=eqVals().find(x=>x.id===id); if(!e) return;
  const wr=!(ME&&(ME.role==='viewer'||ME.role==='staff'));
  sheet(e.tag+' · '+e.name,[e.building,e.dev!=null?'BAS '+e.dev:'found by name on the BAS',e.verify?'device number to verify':''].filter(Boolean).join(' · '),
    '<div class="eqbig">'+eqSvg(e,true).replace('<svg ','<svg id="eqBigSvg" ')+'</div>'+
    '<div class="panel"><div class="eyebrow">Alarms</div><div id="eqDetAlm"></div></div>'+
    '<div class="panel"><div class="eyebrow">Readings</div><div class="pltiles" id="eqDetTiles"></div></div>'+
    '<div class="panel"><div class="eyebrow">Last 4 hours</div><div class="pllegend" id="eqLeg"></div><div class="plchart" style="height:200px"><svg id="eqChart"></svg></div></div>'+
    '<div class="panel"><div class="eyebrow">BAS points'+(typeof isMgr==='function'&&isMgr()?' and mapping':'')+'</div><div id="eqDetPts" class="dim" style="font-size:13px">'+(PLMODE==='demo'?'Shows every point on this device once the BAS scanner sends data.':'Loading…')+'</div></div>'+
    '<div class="acts" style="margin-bottom:12px">'+(wr?'<button class="btn" onclick="eqWo(\''+id+'\')">Make work order</button>':'')+'</div><div id="eqDet"></div>');
  eqDetRefresh(plAlarms()); eqChart(); if(PLMODE!=='demo') eqPts(id);
}
function eqDetRefresh(A){
  const e=eqVals().find(x=>x.id===EQSEL); if(!e||!$('eqDetTiles')) return;
  const big=$('eqBigSvg'); if(big){ big.outerHTML=eqSvg(e,true).replace('<svg ','<svg id="eqBigSvg" '); }
  const mine=A.filter(a=>String(a.rule||'').startsWith(e.id+'.'));
  $('eqDetAlm').innerHTML=mine.length?mine.map(r=>'<div class="plalm '+(r.level==='critical'?'':'pl-warn')+'"><h4>'+esc(r.title)+'</h4><p>'+esc(r.detail)+'</p><ul>'+(plEqChecks(r.rule)||[]).map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>').join(''):'<div class="dim" style="font-size:14px">No alarms.</div>';
  const roles=eqRoles(e.kind), x=e.v;
  $('eqDetTiles').innerHTML=roles.map(([k,l,u])=>{ const v=x[k]; let t=v==null?'?':(/^(occ|fan_cmd|fan_status|cmd|status)$/.test(k)?(v?'ON':'OFF'):plF(v,u==='%'?0:1)); return plTile(l,t,u&&v!=null&&!/^(occ|fan_cmd|fan_status|cmd|status)$/.test(k)?u:''); }).join('');
  if(PLMODE==='demo') eqChart();
}
async function eqPts(id){
  const el=$('eqDetPts'); if(!el) return;
  let d; try{ d=await api('/plant/equip/'+encodeURIComponent(id)); }catch(e){ el.textContent=e.message; return; }
  const pts=d.points||[], map=d.map||{}, roles=d.roles||(id.startsWith('ahu.')?((PL&&PL.ahu_points)||[]).map(p=>[p.key,p.label,p.units]):eqRoles((eqList().find(x=>x.id===id)||{}).kind||'zone'));
  if(!pts.length){ el.textContent='No points from this device yet. It shows up after the BAS scanner reaches it.'; return; }
  const roleOf={}; Object.entries(map).forEach(([r,ref])=>{ if(ref) roleOf[ref.dev+':'+ref.obj]=r; });
  const mgr=typeof isMgr==='function'&&isMgr();
  el.className=''; el.innerHTML='<table class="eqpts"><tbody>'+pts.map(p=>{ const r=roleOf[p.dev+':'+p.obj]||'';
    return '<tr><td class="ob">'+esc(p.obj)+'</td><td>'+esc(p.name)+'</td><td class="n">'+eqFmtPt(p)+'</td>'+(mgr?'<td><select onchange="eqMap(\''+id+'\','+p.dev+',\''+p.obj+'\',this.value,\''+r+'\')"><option value="">—</option>'+roles.map(([k,l])=>'<option value="'+k+'"'+(k===r?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></td>':(r?'<td class="dim">'+esc((roles.find(z=>z[0]===r)||[,r])[1])+'</td>':'<td></td>'))+'</tr>'; }).join('')+'</tbody></table>'+
    (mgr?'<p class="dim" style="font-size:12px">Clubhouse IQ picks the points by name. If one is wrong, choose the right role next to the right point.</p>':'');
}
async function eqMap(id,dev,obj,role,prev){
  try{
    if(prev&&prev!==role) await api('/plant/bas/map',{method:'POST',body:{eid:id,role:prev,dev:null,obj:null}});
    if(role) await api('/plant/bas/map',{method:'POST',body:{eid:id,role,dev,obj}});
    toast('Mapping saved'); await plRefreshData(); eqPts(id);
  }catch(e){ toast(e.message); }
}
async function eqChart(){
  const svg=$('eqChart'); if(!svg) return;
  const e=eqList().find(x=>x.id===EQSEL); if(!e) return;
  const S=({fcu:[['space','Space','#17325C'],['sat','Supply','#3d8fd6'],['space_sp','Setpoint','#9aa3ad']],ef:[['status','Status (on=1)','#1F7A56'],['temp','Room','#e2603a']],
    ref:[['temp','Box','#3d8fd6']],zone:[['space','Space','#17325C'],['sat','Supply','#e2603a'],['space_sp','Setpoint','#9aa3ad']]})[e.kind]||[['space','Space','#17325C']];
  $('eqLeg').innerHTML=S.map(([,n,c])=>'<span><i style="background:'+c+'"></i>'+n+'</span>').join('');
  let series={}, lab;
  if(PLMODE==='demo'){ const d=(EQHIST[e.id]||[]).slice(-240); S.forEach(([k])=>series[k]=d.map((r,i)=>[i,r[k]]).filter(p=>p[1]!=null&&p[1]>-100)); lab=i=>d[i]?plClock(d[i].t):''; }
  else{ try{ const r=await api('/plant/trend?hours=4&keys='+S.map(([k])=>e.id+'.'+k).join(',')); S.forEach(([k])=>series[k]=(r.series[e.id+'.'+k]||[]).filter(p=>p[1]>-100)); }catch(_){} lab=ts=>plTime(ts); }
  const W=svg.clientWidth||600,H=svg.clientHeight||200,all=S.flatMap(([k])=>series[k]||[]);
  if(all.length<2){ svg.innerHTML='<text x="20" y="40" fill="var(--dim)" font-size="14">No readings in this window yet.</text>'; return; }
  const xs=all.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs);
  let lo=Math.min(...all.map(p=>p[1])),hi=Math.max(...all.map(p=>p[1])); if(e.hi){hi=Math.max(hi,e.hi+2)} const pad=(hi-lo)*.1||2; lo-=pad; hi+=pad;
  const L=34,R=8,T=8,B=24,X=v=>L+(W-L-R)*(v-x0)/((x1-x0)||1),Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  let o=''; for(let i=0;i<=4;i++){ const v=lo+(hi-lo)*i/4; o+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="var(--edge)"/><text x="'+(L-5)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="var(--dim)">'+v.toFixed(0)+'</text>'; }
  if(e.hi) o+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(e.hi)+'" y2="'+Y(e.hi)+'" stroke="#e0a23a" stroke-dasharray="5 4"/>';
  for(let i=0;i<=3;i++){ const v=x0+(x1-x0)*i/3; o+='<text x="'+X(v)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':i===3?'end':'middle')+'" font-size="11" fill="var(--dim)">'+esc(lab(PLMODE==='demo'?Math.round(v):v))+'</text>'; }
  S.forEach(([k,,c])=>{ const s=series[k]||[]; if(s.length>1) o+='<polyline fill="none" stroke="'+c+'" stroke-width="2.2" points="'+s.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ')+'"/>'; });
  svg.innerHTML=o;
}
async function eqWo(id){
  const e=eqVals().find(x=>x.id===id); if(!e) return;
  if(PLMODE==='demo'){ toast('Demo data. No work order made.'); return; }
  const mine=plAlarms().filter(a=>String(a.rule||'').startsWith(id+'.'));
  const desc=(mine.length?mine.map(r=>r.title+': '+r.detail+'\nChecks:\n'+(plEqChecks(r.rule)||[]).map(c=>'- '+c).join('\n')).join('\n\n')+'\n\n':'')+
    'BAS readings: '+eqRoles(e.kind).map(([k,l,u])=>e.v[k]==null?'':l+' '+plF(e.v[k],u==='%'?0:1)+(u||'')).filter(Boolean).join(', ')+'.';
  try{
    const r=await api('/workorders',{method:'POST',body:{title:(mine[0]?mine[0].title:e.tag+' '+e.name+' check').slice(0,160),building:e.building||'',location:e.tag+' · '+e.name,
      category:e.kind==='ref'?'Kitchen':'HVAC',priority:mine.some(m=>m.level==='critical')?'high':'normal',description:desc}});
    const wo=r.workorder&&r.workorder.id;
    for(const m of mine) if(!m.wo_id) try{ await api('/plant/alarms/'+m.id+'/wo',{method:'POST',body:{wo_id:wo}}); }catch(_){}
    toast('Work order #'+wo+' opened');
  }catch(err){ toast(err.message); }
}

async function plRefreshData(){ try{ PL=await api('/plant'); }catch(e){} plRefresh(); }
