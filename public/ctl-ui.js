/* Plant > Controls: change BAS setpoints and override pumps, fans and valves.
   Live: requests go to the server, the HVAC PC writes them (gateway/ciq_bas_control.py).
   Demo: changes go straight into the plant simulation so you can see the effect. */
let CTL=null, CTL_T=null, CTL_DEMO_LOG=[], CTL_DEMO_ID=1;
(function(){
  const s=document.createElement('style');
  s.textContent=
  '.ctlhd{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}'+
  '.ctlsw{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:14px;padding:6px 12px;border-radius:99px}'+
  '.ctlsw.on{background:#E4F3EC;color:var(--mint)}.ctlsw.off{background:var(--raised);color:var(--mid)}.ctlsw i{width:9px;height:9px;border-radius:50%;background:currentColor}'+
  '.ctlsw.on i{animation:plblink 1.6s ease-in-out infinite}'+
  '.ctlpc{font-size:13px;color:var(--dim)}.ctlpc b{color:var(--text)}'+
  '.ctlg{margin-bottom:12px}.ctlg>.eyebrow{margin:4px 2px 8px}'+
  '.ctlrow{background:var(--panel);border:1px solid var(--edge);border-radius:var(--r);padding:12px 14px;margin-bottom:8px;box-shadow:var(--shadow);display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;animation:ahin .35s both}'+
  '.ctlrow.dis{opacity:.62}.ctlrow .nm{font-weight:700;font-size:15px}.ctlrow .hp{font-size:12.5px;color:var(--dim);margin-top:2px;max-width:520px}'+
  '.ctlrow .cur{text-align:right}.ctlrow .cur b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;display:block;line-height:1.1}.ctlrow .cur span{font-size:11.5px;color:var(--dim)}'+
  '.ctlrow .ed{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px}'+
  '.ctlstep{display:inline-flex;align-items:stretch;border:1.5px solid var(--edge-lit);border-radius:12px;overflow:hidden;background:var(--deep)}'+
  '.ctlstep button{border:0;background:transparent;font-size:22px;font-weight:700;width:44px;min-height:44px;color:var(--ice);cursor:pointer}.ctlstep button:active{background:var(--raised)}'+
  '.ctlstep input{width:86px;border:0;border-left:1px solid var(--edge);border-right:1px solid var(--edge);text-align:center;font-size:18px;font-weight:800;background:var(--panel);margin:0;min-height:44px;border-radius:0}'+
  '.ctlseg{display:inline-flex;border:1.5px solid var(--edge-lit);border-radius:12px;overflow:hidden}'+
  '.ctlseg button{border:0;background:var(--panel);min-height:44px;padding:0 16px;font-weight:800;font-size:14px;color:var(--mid);cursor:pointer;border-right:1px solid var(--edge)}.ctlseg button:last-child{border-right:0}'+
  '.ctlseg button.sel{background:var(--ice);color:#fff}.ctlseg button.sel.on{background:var(--mint)}.ctlseg button.sel.off{background:#5d6b7d}'+
  '.ctlst{grid-column:1/-1;font-size:12.5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.ctlst .chip{font-weight:800;font-size:11px;padding:2px 9px;border-radius:99px}'+
  '.ctlst .pending{background:#FBF1DC;color:#8A5A00}.ctlst .done{background:#E4F3EC;color:var(--mint)}.ctlst .failed,.ctlst .expired{background:#FBEBE9;color:var(--rose)}.ctlst .cancelled{background:var(--raised);color:var(--mid)}'+
  '.ctlst .held{background:#E7EEF8;color:var(--ice)}'+
  '.ctlst .spin{width:12px;height:12px;border-width:2px}'+
  '.ctllog div{padding:8px 0;border-top:1px solid var(--edge);font-size:13.5px}.ctllog div:first-child{border-top:0}.ctllog .w{color:var(--dim);font-size:12px}'+
  '.ctlchips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.ctlchips span{font-size:12.5px;padding:5px 10px;border-radius:99px;background:var(--raised);cursor:pointer}'+
  '.ctlbig{font-size:30px;font-weight:800;text-align:center;margin:8px 0 2px}.ctlbig small{font-size:15px;color:var(--dim);font-weight:600}'+
  '@media(max-width:560px){.ctlrow{grid-template-columns:1fr}.ctlrow .cur{text-align:left}}';
  document.head.appendChild(s);
})();

/* ---------- data ---------- */
const CTL_DEMO_DEF=[['chw_sp','sp'],['chiller_en','bin'],['chw_pump','bin'],['cw_pump','bin'],['tower_approach','sp'],['tower_min','sp'],['tower_fan_en','bin'],['tower_fan_sig','ao'],['tower_bypass','ao'],['phx_wb','sp'],['phx_cond_vlv','bin'],['phx_chw_vlv','bin'],['hw_sp','sp'],['hw_pump','bin'],['boiler_en','bin'],['mech_ef','bin']];
function ctlDemoCur(key){
  const s=PLSIM,O=s.ov||{},V=plView();
  const m={chw_sp:s.sp,tower_approach:s.appr==null?5:s.appr,tower_min:s.twMin==null?70:s.twMin,phx_wb:s.phxWb==null?52:s.phxWb,hw_sp:s.hwMax==null?160:s.hwMax,
    chiller_en:O.chiller_en===0?0:1,chw_pump:V.chwp?1:0,cw_pump:V.cwp?1:0,tower_fan_en:O.tower_fan_en===0?0:1,tower_fan_sig:V.sig,tower_bypass:O.tower_bypass==null?0:O.tower_bypass,
    phx_cond_vlv:O.phx_cond_vlv==null?(V.phx?1:0):O.phx_cond_vlv,phx_chw_vlv:O.phx_chw_vlv==null?(V.phx?1:0):O.phx_chw_vlv,hw_pump:V.hwp?1:0,boiler_en:O.boiler_en===0?0:1,mech_ef:O.mech_ef==null?1:O.mech_ef};
  return m[key];
}
async function ctlLoad(){
  try{CTL=await api('/plant/controls')}catch(e){CTL={error:e.message,controls:[],log:[]}}
  if(PLMODE==='demo'&&CTL.controls){ // demo: everything mapped, values from the simulation
    CTL.demo=true;CTL.enabled=true;CTL.gateway={online:true,writes_allowed:true};
    CTL.controls.forEach(c=>{c.mapped=true;c.object=c.object||'(demo)'});
    CTL.log=CTL_DEMO_LOG;
  }
  ctlDraw();ctlTimer();
}
function ctlTimer(){
  clearTimeout(CTL_T);
  if(TAB!=='plant'||PLVIEW!=='controls')return;
  const busy=CTL&&!CTL.demo&&CTL.controls&&CTL.controls.some(c=>c.last&&(c.last.status==='pending'||c.last.status==='sent'));
  CTL_T=setTimeout(async()=>{if(TAB!=='plant'||PLVIEW!=='controls')return;if(CTL&&CTL.demo){ctlRefreshVals();ctlTimer();return}await ctlLoad()},CTL&&CTL.demo?2000:busy?3000:20000);
}

/* ---------- view ---------- */
function ctlViewHtml(){setTimeout(ctlLoad,0);return '<div id="ctlBody"><div class="panel"><span class="spin"></span> <span class="dim">Loading controls</span></div></div>'}
function ctlFmt(c,v){if(v==null||isNaN(v))return'--';if(c.kind==='bin')return +v>=.5?'ON':'OFF';return(+v).toFixed(c.step<1?1:0)+(c.units?(c.units==='%'?'%':c.units):'')}
function ctlAgo(ts){return typeof plAgo==='function'?plAgo(ts):ts}
function ctlCur(c){
  if(CTL.demo)return ctlDemoCur(c.key);
  return c.current?c.current.value:null;
}
function ctlHeld(c){
  if(c.kind==='sp')return false;
  if(CTL.demo){const O=(PLSIM.ov||{});return O[c.key]!=null}
  const l=c.last;return !!(l&&l.status==='done'&&l.action==='write');
}
function ctlDraw(){
  const b=$('ctlBody');if(!b||!CTL)return;
  if(CTL.error){b.innerHTML='<div class="panel">'+esc(CTL.error)+'</div>';return}
  const g=CTL.gateway||{};
  let h='<div class="panel"><div class="ctlhd"><div><span class="ctlsw '+(CTL.enabled?'on':'off')+'"><i></i>Remote control '+(CTL.enabled?'ON':'OFF')+'</span></div>';
  if(!CTL.demo&&CTL.can_map)h+='<button class="'+(CTL.enabled?'btn-2':'btn')+'" onclick="ctlEnable('+(CTL.enabled?0:1)+')">'+(CTL.enabled?'Turn off':'Turn on')+'</button>';
  h+='</div>';
  if(CTL.demo)h+='<div class="note" style="background:#FBF1DC;color:#6B4A00;margin-top:10px"><b>Demo</b> Changes here go into the plant simulation only. Watch the drawing and the alarms react. Nothing is sent to the BAS.</div>';
  else h+='<div class="ctlpc" style="margin-top:8px">HVAC PC: <b>'+(g.online?'online':'offline')+'</b>'+(g.last_poll?' · last check '+esc(ctlAgo(g.last_poll)):' · never connected')+
    (g.last_poll?' · writes '+(g.writes_allowed?'<b>allowed</b>':'<b style="color:var(--rose)">blocked on the PC</b>'):'')+
    (CTL.enabled&&CTL.enabled_by?'<br>Turned on by '+esc(CTL.enabled_by)+' '+esc(ctlAgo(CTL.enabled_at)):'')+
    (!g.last_poll?'<br>Install the control program on the HVAC PC (gateway folder: install_bas_control.bat). Until then, requests expire after 10 minutes without being written.':'')+'</div>';
  if(!CTL.can_write&&!CTL.demo)h+='<div class="dim" style="font-size:13px;margin-top:6px">Your role can view these but not change them.</div>';
  h+='</div>';
  const groups=[...new Set(CTL.controls.map(c=>c.group))];
  groups.forEach(gn=>{
    h+='<div class="ctlg"><div class="eyebrow">'+esc(gn)+'</div>'+CTL.controls.filter(c=>c.group===gn).map(ctlRowHtml).join('')+'</div>';
  });
  h+='<div class="panel"><div class="eyebrow">Change log</div><div class="ctllog" id="ctlLog">'+ctlLogHtml()+'</div></div>';
  b.innerHTML=h;
}
function ctlRowHtml(c,i){
  const ok=CTL.demo||(CTL.enabled&&CTL.can_write&&c.mapped);
  const cur=ctlCur(c),k=c.key;
  let ed='';
  if(!c.mapped&&!CTL.demo){
    ed='<span class="dim" style="font-size:13px">Not tied to a BAS point yet.</span>'+(CTL.can_map?' <button class="btn-2" onclick="ctlMap(\''+k+'\')">Set BAS point</button>':'');
  }else if(c.kind==='bin'){
    const held=ctlHeld(c),hv=CTL.demo?(PLSIM.ov||{})[k]:(c.last&&c.last.value);
    const sel=v=>v==='auto'?!held:held&&+hv===v;
    ed='<div class="ctlseg" role="group" aria-label="'+esc(c.label)+'">'+
      '<button class="off'+(sel(0)?' sel':'')+'" '+(ok?'':'disabled')+' onclick="ctlAsk(\''+k+'\',0)">Off</button>'+
      '<button class="'+(sel('auto')?' sel':'')+'" '+(ok?'':'disabled')+' onclick="ctlAsk(\''+k+'\',\'auto\')">Auto</button>'+
      '<button class="on'+(sel(1)?' sel':'')+'" '+(ok?'':'disabled')+' onclick="ctlAsk(\''+k+'\',1)">On</button></div>';
  }else{
    const start=cur==null?(c.min+c.max)/2:cur;
    ed='<div class="ctlstep"><button '+(ok?'':'disabled')+' aria-label="Lower" onclick="ctlNudge(\''+k+'\',-1)">−</button>'+
      '<input id="ctlIn-'+k+'" type="number" inputmode="decimal" step="'+c.step+'" min="'+c.min+'" max="'+c.max+'" value="'+(+start).toFixed(c.step<1?1:0)+'" '+(ok?'':'disabled')+' aria-label="'+esc(c.label)+'">'+
      '<button '+(ok?'':'disabled')+' aria-label="Raise" onclick="ctlNudge(\''+k+'\',1)">+</button></div>'+
      '<button class="btn" '+(ok?'':'disabled')+' onclick="ctlAsk(\''+k+'\',+$(\'ctlIn-'+k+'\').value)">Set</button>'+
      (c.kind==='ao'?'<button class="btn-2" '+(ok?'':'disabled')+' onclick="ctlAsk(\''+k+'\',\'auto\')">Auto</button>':'')+
      '<span class="dim" style="font-size:12px">'+c.min+' to '+c.max+' '+esc(c.units||'')+'</span>';
    if(!CTL.demo&&CTL.can_map&&c.kind==='sp')ed+=' <button class="btn-2" style="padding:6px 10px;min-height:34px;font-size:12px" onclick="ctlMap(\''+k+'\')">'+esc(c.device+' '+c.object)+'</button>';
  }
  return '<div class="ctlrow'+(ok||(!c.mapped&&!CTL.demo)?'':' dis')+'" id="ctlR-'+k+'" style="animation-delay:'+((i||0)*30)+'ms"><div><div class="nm">'+esc(c.label)+'</div><div class="hp">'+esc(c.help)+'</div></div>'+
    '<div class="cur"><b id="ctlCur-'+k+'">'+ctlFmt(c,cur)+'</b><span id="ctlSrc-'+k+'">'+ctlSrc(c)+'</span></div>'+
    '<div class="ed">'+ed+'</div><div class="ctlst" id="ctlSt-'+k+'">'+ctlStatus(c)+'</div></div>';
}
function ctlSrc(c){
  if(CTL.demo)return ctlHeld(c)?'held by you (demo)':c.kind==='sp'?'setpoint':'BAS in control';
  if(!c.current)return c.mapped?'waiting for a reading':'';
  return (c.current.src==='bas'?'read from BAS ':'plant reading ')+ctlAgo(c.current.ts);
}
function ctlStatus(c){
  const l=CTL.demo?CTL_DEMO_LOG.find(x=>x.key===c.key):c.last;if(!l)return ctlHeld(c)?'<span class="chip held">HELD BY APP</span>':'';
  const what=l.action==='release'?'Auto':ctlFmt(c,l.value);
  const lab={pending:'WAITING FOR HVAC PC',sent:'WRITING',done:'DONE',failed:'FAILED',expired:'EXPIRED',cancelled:'CANCELLED'}[l.status]||l.status;
  let h='<span class="chip '+l.status+'">'+((l.status==='pending'||l.status==='sent')?'<span class="spin"></span> ':'')+lab+'</span>'+
    '<span>'+esc(what)+' by '+esc(l.requested_by||'')+' '+esc(ctlAgo(l.created_at))+'</span>';
  if(l.result&&(l.status==='failed'||l.status==='expired'||l.status==='done'))h+='<span class="dim">· '+esc(l.result)+'</span>';
  if(l.status==='pending'&&!CTL.demo)h+='<button class="btn-2" style="padding:4px 10px;min-height:30px;font-size:12px" onclick="ctlCancel('+l.id+')">Cancel</button>';
  if(l.status==='done'&&l.prev!=null&&c.kind!=='bin'&&Math.abs(l.prev-(l.value==null?l.prev:l.value))>1e-6)h+='<button class="btn-2" style="padding:4px 10px;min-height:30px;font-size:12px" onclick="ctlAsk(\''+c.key+'\','+l.prev+',\'Put back to the earlier value\')">Put back to '+esc(ctlFmt(c,l.prev))+'</button>';
  if(ctlHeld(c)&&l.status!=='pending')h+='<span class="chip held">HELD BY APP</span>';
  return h;
}
function ctlLogHtml(){
  const L=CTL.log||[];if(!L.length)return '<div class="dim">No changes yet.</div>';
  return L.slice(0,25).map(l=>{const c=CTL.controls.find(x=>x.key===l.key)||{label:l.key,kind:'sp'};
    return '<div><b>'+esc(c.label)+'</b>: '+(l.action==='release'?'set to Auto':(l.prev!=null&&c.kind!=='bin'?esc(ctlFmt(c,l.prev))+' → ':'')+esc(ctlFmt(c,l.value)))+
      ' <span class="chip" style="font-size:11px;font-weight:800">'+esc(l.status)+'</span><div class="w">'+esc(l.requested_by||'')+' · '+esc(new Date(l.created_at).toLocaleString())+' · '+esc(l.reason||'')+(l.result?' · '+esc(l.result):'')+(l.object?' · '+esc(l.device+' '+l.object):'')+'</div></div>'}).join('');
}
function ctlRefreshVals(){
  if(!CTL||!$('ctlBody'))return;
  CTL.controls.forEach(c=>{const e=$('ctlCur-'+c.key);if(e)plTween(e,ctlFmt(c,ctlCur(c)));const s=$('ctlSrc-'+c.key);if(s)s.textContent=ctlSrc(c)});
}

/* ---------- actions ---------- */
function ctlNudge(k,d){const c=CTL.controls.find(x=>x.key===k),e=$('ctlIn-'+k);let v=(+e.value||0)+d*c.step;v=plClamp(Math.round(v/c.step)*c.step,c.min,c.max);e.value=v.toFixed(c.step<1?1:0)}
function ctlAsk(k,v,why){
  const c=CTL.controls.find(x=>x.key===k);if(!c)return;
  const rel=v==='auto';
  if(!rel&&c.kind!=='bin'&&(isNaN(v)||v<c.min||v>c.max)){toast('Allowed range is '+c.min+' to '+c.max+' '+(c.units||''));return}
  const cur=ctlCur(c);
  const big=rel?'Auto <small>(BAS program in control)</small>':(c.kind!=='bin'&&cur!=null?'<small>'+esc(ctlFmt(c,cur))+' →</small> ':'')+esc(ctlFmt(c,v));
  const warn={chw_pump:v===0?'The chiller trips on its flow switch if this pump stops while it runs.':'',cw_pump:v===0?'The water-cooled walk-in loses condenser water and trips on head pressure.':'',
    chiller_en:v===0?'The chiller stops and the building loses chilled water.':'',hw_pump:v===0?'The boilers lock out on no flow.':'',boiler_en:v===0?'No heat to the hot decks and fan coils.':'',
    tower_fan_sig:!rel?'The fan stays at this speed until you set it back to Auto.':'',tower_min:!rel&&v<60?'Under about 55°F to the chiller, the York trips on low evaporator pressure.':'',
    chw_sp:!rel&&v<42?'Low setpoints at light load drive low-temperature short cycling.':''}[k]||'';
  sheet('Change '+c.label,CTL.demo?'Demo · simulation only':'Writes to BAS '+c.device+' '+c.object+(c.priority?' at priority '+c.priority:''),
    '<div class="ctlbig">'+big+'</div>'+(warn?'<div class="note" style="background:#FBEBE9;color:var(--rose);margin:10px 0"><b>Heads up</b> '+esc(warn)+'</div>':'')+
    '<label class="fl">Why</label><textarea id="ctlWhy" rows="2" placeholder="Mild weather, troubleshooting, comfort call...">'+esc(why||'')+'</textarea>'+
    '<div class="ctlchips">'+['Mild weather','Energy savings','Troubleshooting','Comfort complaint','Testing','Back to normal'].map(t=>'<span onclick="$(\'ctlWhy\').value=\''+t+'\'">'+t+'</span>').join('')+'</div>'+
    '<button class="btn full" id="ctlGo" onclick="ctlSend(\''+k+'\','+(rel?'\'auto\'':v)+')">'+(CTL.demo?'Apply to demo':'Send to the BAS')+'</button>'+
    '<div class="dim" id="ctlErr" style="margin-top:8px;font-size:13px">'+(CTL.demo?'':'The HVAC PC picks this up within about 10 seconds, writes it, and reads it back.')+'</div>');
}
async function ctlSend(k,v){
  const why=($('ctlWhy').value||'').trim();
  if(why.length<3){$('ctlErr').innerHTML='<span style="color:var(--rose)">Say why, so the log makes sense later.</span>';return}
  const c=CTL.controls.find(x=>x.key===k),rel=v==='auto';
  if(CTL.demo){ctlDemoApply(c,v,why);closeSheet();return}
  $('ctlGo').disabled=true;
  try{CTL=await api('/plant/controls/'+k,{method:'POST',body:rel?{action:'release',reason:why}:{value:v,reason:why}});closeSheet();toast('Sent. Waiting for the HVAC PC.');ctlDraw();ctlTimer()}
  catch(e){$('ctlGo').disabled=false;$('ctlErr').innerHTML='<span style="color:var(--rose)">'+esc(e.message)+'</span>'}
}
function ctlDemoApply(c,v,why){
  const s=PLSIM;s.ov=s.ov||{};const rel=v==='auto',prev=ctlDemoCur(c.key);
  const entry={id:CTL_DEMO_ID++,key:c.key,action:rel?'release':'write',value:rel?null:v,prev,status:'pending',requested_by:(ME&&ME.name)||'You',reason:why,created_at:new Date().toISOString()};
  CTL_DEMO_LOG.unshift(entry);CTL.log=CTL_DEMO_LOG;ctlDraw();
  setTimeout(()=>{
    if(c.kind==='sp'){({chw_sp:()=>s.sp=v,tower_approach:()=>s.appr=v,tower_min:()=>s.twMin=v,phx_wb:()=>s.phxWb=v,hw_sp:()=>s.hwMax=v})[c.key]()}
    else if(rel)delete s.ov[c.key];else s.ov[c.key]=v;
    entry.status='done';entry.result=rel?'Released. The simulated BAS is back in control.':'Applied to the simulation.';
    plDemoLog('Controls: '+c.label+' '+(rel?'set to Auto':'set to '+ctlFmt(c,v))+' ('+why+')');
    ctlDraw();
  },1200);
}
async function ctlEnable(on){
  if(!confirm(on?'Turn on remote control? Admins, managers and techs will be able to change BAS setpoints and overrides from the app.':'Turn off remote control? Anything waiting to be sent is cancelled.'))return;
  try{CTL=await api('/plant/controls/enable',{method:'POST',body:{enabled:!!on}});ctlDraw()}catch(e){toast(e.message)}
}
async function ctlCancel(id){try{CTL=await api('/plant/commands/'+id+'/cancel',{method:'POST'});ctlDraw()}catch(e){toast(e.message)}}
function ctlMap(k){
  const c=CTL.controls.find(x=>x.key===k);
  sheet('BAS point for '+c.label,'Find it in Compass: open the point and note its object type and number',
    '<label class="fl">Device</label><input id="ctlDev" type="number" value="'+esc(c.device||120)+'">'+
    '<label class="fl">Object</label><input id="ctlObj" placeholder="'+(c.kind==='bin'?'BO 3':'AV 23')+'" value="'+esc(c.object||'')+'">'+
    '<div class="dim" style="font-size:13px;margin-top:6px">'+(c.kind==='bin'?'On/off controls use a BO or BV.':'Setpoints are usually an AV. Overrides use an AO.')+' Leave it blank to unlink.</div>'+
    '<button class="btn full" style="margin-top:12px" onclick="ctlMapSave(\''+k+'\')">Save</button><div class="dim" id="ctlErr" style="margin-top:8px"></div>');
}
async function ctlMapSave(k){
  try{CTL=await api('/plant/controls/'+k+'/map',{method:'POST',body:{device:$('ctlDev').value,object:$('ctlObj').value}});closeSheet();ctlDraw();toast('Saved')}
  catch(e){$('ctlErr').innerHTML='<span style="color:var(--rose)">'+esc(e.message)+'</span>'}
}
