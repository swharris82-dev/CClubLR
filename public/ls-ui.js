/* Life safety program screens: overview, devices, contractor inspections,
   and the report builder. Server side lives in lifesafety.js. */
let LS=null, LSVIEW='overview', LSKIND='', LSQ='', LSCHK=null;
try { QUEUEABLE.push(/^\/ls\/devices\/\d+\/check$/, /^\/ls\/items\/\d+\/done$/); } catch (e) {}

(function lsStyle(){
  const s=document.createElement('style');
  s.textContent='.lsck{border-top:1px solid var(--edge);padding:10px 0}.lsck:first-child{border-top:0}.lsck .lb{font-size:14px;margin-bottom:6px}'+
    '.lsck .seg div{padding:9px 4px;font-weight:600;cursor:pointer}.lsck input{font-family:var(--mono);font-size:18px;font-weight:600}'+
    '.lsdev{display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--edge);cursor:pointer}.lsdev:first-child{border-top:0}'+
    '.lsdev .tg{font-family:var(--mono);font-weight:700;font-size:15px}.lsdev .m{font-size:12px;color:var(--dim)}'+
    '.lsst{font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap}.lsst.ok{background:#E4F3EC;color:var(--mint)}'+
    '.lsst.soon{background:#FBF1DC;color:#A36A00}.lsst.late,.lsst.never,.lsst.failed{background:#FBEBE9;color:var(--rose)}'+
    '.lskinds{display:grid;grid-template-columns:1fr 1fr;gap:8px}.lskinds>div{border:1.5px solid var(--edge);border-radius:var(--r-s);padding:10px;cursor:pointer}'+
    '.lskinds b{font-size:22px;display:block;font-family:var(--serif,Georgia,serif)}.lskinds .m{font-size:12px;color:var(--dim)}'+
    '.lsopt{display:flex;flex-wrap:wrap;gap:6px}.lsopt label{display:flex;gap:6px;align-items:center;border:1.5px solid var(--edge);border-radius:20px;padding:6px 10px;font-size:13px}'+
    '.lsopt input{width:auto;margin:0}';
  document.head.appendChild(s);
})();

const LS_STATE={ok:'Current',soon:'Due soon',late:'Overdue',never:'Never checked',failed:'Out of service'};
const lsTag=s=>'<span class="lsst '+s+'">'+LS_STATE[s]+'</span>';

async function loadLs(){
  const b=$('lsBody');
  if(!LS) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading life safety</span></div>';
  try{ LS=await api('/ls'); drawLs(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function drawLs(){
  const nav=[['overview','Overview'],['devices','Devices'],['inspections','Inspections'],['reports','Reports']];
  let h='<div class="filters" id="lsNav">'+nav.map(([k,l])=>'<div class="'+(LSVIEW===k?'on':'')+'" onclick="LSVIEW=\''+k+'\';drawLs();window.scrollTo(0,0)">'+l+'</div>').join('')+'</div>';
  if(LSVIEW==='devices') h+=lsDevicesHtml();
  else if(LSVIEW==='inspections') h+=lsItemsHtml();
  else if(LSVIEW==='reports') h+=lsReportHtml();
  else h+=lsOverviewHtml();
  $('lsBody').innerHTML=h;
  if(LSVIEW==='reports') lsPreset(true);
}

/* ---------------- overview ---------------- */
function lsOverviewHtml(){
  const s=LS, wr=canWork();
  const lateItems=s.items.filter(i=>i.state==='late'||i.state==='never');
  let h='<div class="panel" style="display:flex;gap:14px;align-items:center">'+ring(s.score)+'<div style="flex:1"><div class="eyebrow" style="margin-bottom:4px">Fire marshal ready</div>'+
    '<div class="mid" style="font-size:13px">Device checks current: <b>'+s.device_pct+'%</b><br>Contractor inspections current: <b>'+s.item_pct+'%</b>'+
    (s.failed?'<br><span style="color:var(--rose)"><b>'+s.failed+'</b> device'+(s.failed>1?'s':'')+' out of service</span>':'')+'</div></div></div>';
  h+='<div class="panel"><div class="stats">'+
    kpi(s.due_now,'Checks due now',s.devices.length+' devices',s.due_now?'bad':'good',"LSVIEW='devices';LSKIND='';LSQ='due';drawLs()")+
    kpi(s.failed,'Out of service','failed a check',s.failed?'bad':'good',"LSVIEW='devices';LSKIND='';LSQ='failed';drawLs()")+
    kpi(lateItems.length,'Inspections past due',s.items.length+' tracked',lateItems.length?'bad':'good',"LSVIEW='inspections';drawLs()")+'</div>'+
    (wr?'<div class="acts" style="margin-top:10px"><button class="btn" onclick="scanTag()">Scan a tag</button><button class="btn-2" onclick="lsPrintTags()">Print QR tags</button></div>':'')+'</div>';
  if(s.expiring.length) h+='<div class="panel"><div class="eyebrow">Expiring soon</div>'+s.expiring.sort((a,b)=>a.days-b.days).map(e=>
    '<div class="att" onclick="lsDevice('+e.device_id+')"><span class="lv" style="background:'+(e.days<=14?'var(--rose)':'var(--sulfur)')+'"></span><div style="flex:1;min-width:0"><div class="t"><span class="mono">'+esc(e.tag)+'</span> '+esc(e.label)+'</div>'+
    '<div class="m">'+esc(fmtDate(e.date))+' · '+(e.days<0?(-e.days)+' days ago':'in '+e.days+' days')+' · '+esc(e.kind_label)+'</div></div></div>').join('')+'</div>';
  const due=s.devices.filter(d=>d.due_now||d.failed);
  const byB={}; due.forEach(d=>{ (byB[d.building||'No building']=byB[d.building||'No building']||[]).push(d); });
  h+='<div class="panel"><div class="eyebrow">Walk: due now'+(due.length?' · '+due.length:'')+'</div>'+
    (due.length?Object.keys(byB).sort().map(b=>'<div class="gh" style="font-weight:700;margin:10px 0 2px">'+esc(b)+' <span class="dim">('+byB[b].length+')</span></div>'+byB[b].map(lsRow).join('')).join(''):
      '<div class="dim">Every device check is current.</div>')+'</div>';
  h+='<div class="panel"><div class="eyebrow">By type</div><div class="lskinds">'+s.by_kind.map(k=>
    '<div onclick="LSVIEW=\'devices\';LSKIND=\''+k.kind+'\';LSQ=\'\';drawLs()"><b>'+k.count+'</b>'+esc(k.label)+'<div class="m">'+
    (k.failed?'<span style="color:var(--rose)">'+k.failed+' out of service</span> · ':'')+(k.due?k.due+' due':k.count?'all current':'none added')+'</div></div>').join('')+'</div>'+
    (wr?'<button class="btn-2 full" style="margin-top:10px" onclick="lsDeviceForm()">+ Add devices</button>':'')+'</div>';
  return h;
}
function lsRow(d){
  const nx=d.checks.filter(c=>c.state!=='ok').map(c=>c.label).join(', ');
  return '<div class="lsdev" onclick="lsDevice('+d.id+')"><div style="flex:1;min-width:0"><div><span class="tg">'+esc(d.tag)+'</span> <span class="dim" style="font-size:12px">'+esc(d.kind_label)+'</span></div>'+
    '<div class="m">'+esc([d.building,d.location].filter(Boolean).join(' · '))+(nx&&d.state!=='failed'?' · '+esc(nx):'')+'</div></div>'+lsTag(d.state)+'</div>';
}

/* ---------------- devices ---------------- */
function lsDevicesHtml(){
  const s=LS;
  let list=s.devices.filter(d=>!LSKIND||d.kind===LSKIND);
  if(LSQ==='due') list=list.filter(d=>d.due_now||d.failed);
  else if(LSQ==='failed') list=list.filter(d=>d.failed);
  else if(LSQ) { const q=LSQ.toLowerCase(); list=list.filter(d=>(d.tag+' '+d.building+' '+d.location+' '+d.kind_label).toLowerCase().includes(q)); }
  let h='<div class="panel"><div class="chips"><span class="chip'+(LSKIND?'':' on')+'" onclick="LSKIND=\'\';drawLs()">All '+s.devices.length+'</span>'+
    s.by_kind.filter(k=>k.count).map(k=>'<span class="chip'+(LSKIND===k.kind?' on':'')+'" onclick="LSKIND=\''+k.kind+'\';drawLs()">'+esc(k.label)+' '+k.count+'</span>').join('')+'</div>'+
    '<div class="row" style="margin-top:10px"><input id="lsSearch" placeholder="Search tag, building, location" value="'+esc(LSQ==='due'||LSQ==='failed'?'':LSQ)+'" oninput="LSQ=this.value;lsRedrawList()">'+
    (canWork()?'<button class="btn" style="flex:0 0 auto" onclick="lsDeviceForm()">+ Add</button>':'')+'</div>'+
    (LSQ==='due'||LSQ==='failed'?'<div class="dim" style="margin-top:8px">Showing '+(LSQ==='due'?'devices with a check due':'devices out of service')+' · <a onclick="LSQ=\'\';drawLs()" style="color:var(--ice);cursor:pointer">show all</a></div>':'')+'</div>';
  h+='<div class="panel" id="lsList">'+lsListHtml(list)+'</div>';
  return h;
}
function lsListHtml(list){
  if(!list.length) return '<div class="empty"><div class="big">No devices here yet</div>Add extinguishers, exit signs, AEDs, fire doors, risers, the panel, the generator, and elevators. Use “How many” to add a whole floor at once.</div>';
  return list.map(lsRow).join('');
}
function lsRedrawList(){
  const q=LSQ.toLowerCase();
  const list=LS.devices.filter(d=>(!LSKIND||d.kind===LSKIND)&&(d.tag+' '+d.building+' '+d.location+' '+d.kind_label).toLowerCase().includes(q));
  $('lsList').innerHTML=lsListHtml(list);
}

async function lsDevice(id){
  try{
    const r=await api('/ls/devices/'+id), d=r.device, K=LS?LS.kinds[d.kind]:null;
    let h='<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="mid">'+esc([d.building,d.location].filter(Boolean).join(' · '))+'</div>'+lsTag(d.state)+'</div>';
    const det=(K?K.details:[]).filter(([k])=>d.details[k]);
    if(det.length) h+='<div class="kv" style="margin-top:10px">'+det.map(([k,l,t])=>'<div class="k">'+esc(l)+'</div><div>'+esc(t==='date'?fmtDate(d.details[k]):d.details[k])+'</div>').join('')+'</div>';
    if(d.expiring.length) h+='<div class="note n-warn" style="margin-top:10px">'+d.expiring.map(e=>esc(e.label)+' '+esc(fmtDate(e.date))).join('<br>')+'</div>';
    if(d.notes) h+='<div class="dim" style="margin-top:8px">'+esc(d.notes)+'</div>';
    h+='</div><div class="panel"><div class="eyebrow">Checks</div>'+d.checks.map(c=>
      '<div class="att"><span class="lv" style="background:'+(c.last_result==='fail'?'var(--rose)':({ok:'var(--mint)',soon:'var(--sulfur)'}[c.state]||'var(--rose)'))+'"></span><div style="flex:1;min-width:0"><div class="t">'+esc(c.label)+'</div>'+
      '<div class="m">Every '+esc(freqLabel(c.every))+' · '+(c.last_on?'last '+esc(fmtDate(c.last_on))+' by '+esc(c.last_by)+(c.last_result==='fail'?' <b style="color:var(--rose)">FAILED</b>':''):'never done')+
      (c.next_due?' · '+(c.days<0?'<span style="color:var(--rose)">'+(-c.days)+' days overdue</span>':'due '+esc(fmtDate(c.next_due))):'')+(c.wo_id&&c.last_result==='fail'?' · <a style="color:var(--ice)" onclick="closeSheet();openWo('+c.wo_id+')">WO #'+c.wo_id+'</a>':'')+'</div></div>'+
      (canWork()?'<button class="btn'+(c.state==='ok'?'-2':'')+'" style="padding:6px 12px;font-size:13px" onclick="lsCheckForm('+d.id+',\''+c.key+'\')">Check</button>':'')+'</div>').join('')+'</div>';
    h+='<div class="panel"><div class="eyebrow">History</div>'+(r.log.length?'<table>'+r.log.map(l=>{
      const C=K?K.checks.find(x=>x.key===l.check_key):null, bad=l.items.filter(x=>!x.ok), rd=l.items.filter(x=>x.value!=null);
      return '<tr><td style="white-space:nowrap;vertical-align:top"><b>'+esc(fmtDate(l.done_on))+'</b></td><td>'+esc(C?C.label:l.check_key)+' · <b style="color:'+(l.result==='pass'?'var(--mint)':'var(--rose)')+'">'+(l.result==='pass'?'Pass':'Fail')+'</b>'+
        (bad.length?'<br><span style="color:var(--rose);font-size:12px">'+bad.map(x=>esc(x.label)).join('; ')+'</span>':'')+
        (rd.length?'<br><span class="dim" style="font-size:12px">'+rd.map(x=>esc(x.label)+' '+x.value+(x.unit?' '+esc(x.unit):'')).join(' · ')+'</span>':'')+
        (l.note?'<br><span style="font-size:12px">'+esc(l.note)+'</span>':'')+'<br><span class="dim" style="font-size:11px">'+esc(l.by)+(l.wo_id?' · WO #'+l.wo_id:'')+'</span></td></tr>';
    }).join('')+'</table>':'<div class="dim">No checks logged yet.</div>')+'</div>';
    if(canWork()) h+='<div class="acts"><button class="btn-2" onclick="lsDeviceForm('+d.id+')">Edit</button><button class="btn-2" onclick="lsPrintTags(\''+esc(d.tag)+'\')">Print its QR tag</button></div>';
    sheet(d.tag,d.kind_label,h);
  }catch(e){ alert(e.message); }
}

/* ---------------- the check ---------------- */
async function lsCheckForm(id,key){
  try{
    if(!LS) LS=await api('/ls');
    const r=await api('/ls/devices/'+id), d=r.device, K=LS.kinds[d.kind], C=K.checks.find(c=>c.key===key);
    LSCHK={id,key,items:C.items.map(()=>({ok:true}))};
    const dateFields=(K.details||[]).filter(x=>x[2]==='date');
    let h='<div class="panel"><div class="mid" style="font-size:13px;margin-bottom:6px">'+esc([d.building,d.location].filter(Boolean).join(' · '))+' · '+esc(K.code)+'</div>'+
      C.items.map((it,i)=>'<div class="lsck"><div class="lb">'+esc(it.label)+(it.reading&&(it.lo!=null||it.hi!=null)?' <span class="dim" style="font-size:12px">('+(it.lo!=null&&it.hi!=null?it.lo+'–'+it.hi:it.lo!=null?'min '+it.lo:'max '+it.hi)+(it.unit?' '+esc(it.unit):'')+')</span>':'')+'</div>'+
        (it.reading?'<div class="row"><input type="number" inputmode="decimal" step="any" id="lsv'+i+'" placeholder="'+esc(it.unit||'value')+'" oninput="lsReadCheck('+i+')"><div id="lsr'+i+'" style="flex:0 0 auto;align-self:center;font-weight:700"></div></div>':
          '<div class="seg" id="lss'+i+'"><div class="y" onclick="lsSet('+i+',true)">Pass</div><div onclick="lsSet('+i+',false)">Fail</div></div>')+'</div>').join('')+'</div>';
    h+='<div class="panel">'+F('Date',inp('lsD',today(),'','date'))+
      (dateFields.length?'<div class="dim" style="font-size:12px;margin:10px 0 2px">Update if you replaced something</div>'+dateFields.map(([k,l])=>F(l,inp('lsdf_'+k,d.details[k]||'','','date'))).join(''):'')+
      F('Note',inp('lsN','','Anything found or fixed on the spot'))+
      '<button class="btn btn-good full" style="margin-top:12px" onclick="lsSaveCheck()">Save check</button>'+errBox('lsMsg')+
      '<div class="dim" style="font-size:12px;margin-top:8px">A fail opens a work order and marks the device out of service until it passes a check.</div></div>';
    sheet(d.tag,C.label,h);
    LSCHK.dates=dateFields.map(x=>x[0]); LSCHK.def=C.items;
  }catch(e){ alert(e.message); }
}
function lsSet(i,ok){
  LSCHK.items[i].ok=ok;
  const el=$('lss'+i); if(!el) return;
  el.children[0].className=ok?'y':''; el.children[1].className=ok?'':'n';
}
function lsReadCheck(i){
  const it=LSCHK.def[i], v=parseFloat($('lsv'+i).value), out=$('lsr'+i);
  if(!isFinite(v)){ out.textContent=''; return; }
  const bad=(it.lo!=null&&v<it.lo)||(it.hi!=null&&v>it.hi);
  out.textContent=bad?'Out of range':'OK'; out.style.color=bad?'var(--rose)':'var(--mint)';
}
async function lsSaveCheck(){
  const c=LSCHK; if(!c) return;
  const items=c.def.map((it,i)=>it.reading?{value:$('lsv'+i).value===''?null:parseFloat($('lsv'+i).value)}:{ok:c.items[i].ok});
  const missing=c.def.filter((it,i)=>it.reading&&items[i].value==null&&(it.lo!=null||it.hi!=null));
  if(missing.length&&!confirm('No reading for: '+missing.map(x=>x.label).join(', ')+'. Save anyway?')) return;
  const details={}; (c.dates||[]).forEach(k=>{ details[k]=val('lsdf_'+k); });
  try{
    const r=await api('/ls/devices/'+c.id+'/check',{method:'POST',body:{check:c.key,done_on:val('lsD'),items,note:val('lsN'),details}});
    LS=r.state; closeSheet(); if($('lsBody')&&TAB==='lifesafety') drawLs();
    toast(r.result==='pass'?'Passed and logged':'Failed. Work order #'+r.wo_id+' opened'); refreshAlerts();
  }catch(e){ if(/offline|signal/i.test(e.message||'')){ closeSheet(); toast('Saved on the phone. It uploads when you have signal.'); } else showErr('lsMsg',e); }
}

/* ---------------- add / edit devices ---------------- */
function lsDeviceForm(id){
  const d=id?LS.devices.find(x=>x.id===id):{kind:LSKIND||'extinguisher',details:{}};
  const kinds=Object.values(LS.kinds).map(k=>[k.key,k.label]);
  let h='<div class="panel">'+F('Type',sel('lsK',kinds,d.kind).replace('<select','<select onchange="lsKindFields()"'+(id?' disabled':'')))+
    row2(F('Tag',inp('lsT',d.tag||'',(LS.kinds[d.kind]||{}).prefix+'-CH-01','text',' style="font-family:var(--mono);text-transform:uppercase"')),
      id?'':F('How many',inp('lsCnt','1','1','number',' min="1" max="60"')))+
    F('Building',inp('lsB',d.building||'','Clubhouse','text',' list="lsBl"'))+'<datalist id="lsBl">'+LS.buildings.map(b=>'<option value="'+esc(b)+'">').join('')+'</datalist>'+
    F('Location',inp('lsL',d.location||'','Ballroom east exit'))+'<div id="lsKF"></div>'+F('Notes',inp('lsNo',d.notes||'',''))+
    (!id?'<div class="dim" style="font-size:12px;margin-top:6px">With more than one, tags number themselves from the tag you type (FE-CH becomes FE-CH-01, FE-CH-02…) and the location gets a number.</div>':'')+
    '<button class="btn full" style="margin-top:12px" onclick="lsSaveDevice('+(id||0)+')">Save</button>'+
    (id&&ME.role!=='tech'?'<button class="btn-2 full" style="margin-top:8px;color:var(--rose)" onclick="lsDelDevice('+id+')">Remove device</button>':'')+errBox('lsdMsg')+'</div>';
  sheet(id?'Edit '+d.tag:'Add devices','Life safety',h);
  window._lsDet=d.details||{}; lsKindFields();
}
function lsKindFields(){
  const K=LS.kinds[val('lsK')]; if(!K) return;
  if(!val('lsT')||/^[A-Z]+-CH-01$/.test($('lsT').placeholder)) $('lsT').placeholder=K.prefix+'-CH-01';
  $('lsKF').innerHTML=K.details.map(([k,l,t,ph])=>F(l,inp('lsx_'+k,window._lsDet[k]||'',ph||'',t==='date'?'date':'text'))).join('');
}
async function lsSaveDevice(id){
  const K=LS.kinds[val('lsK')], details={};
  K.details.forEach(([k])=>{ details[k]=val('lsx_'+k); });
  const body={kind:val('lsK'),tag:val('lsT'),building:val('lsB'),location:val('lsL'),notes:val('lsNo'),details,count:id?1:val('lsCnt')};
  try{
    const r=await api('/ls/devices'+(id?'/'+id:''),{method:id?'PUT':'POST',body});
    LS=r; closeSheet(); drawLs(); toast(r.added?('Added '+(r.added.length>3?r.added.length+' devices':r.added.join(', '))):'Saved');
  }catch(e){ showErr('lsdMsg',e); }
}
async function lsDelDevice(id){ if(!confirm('Remove this device? Its history stays in the reports.')) return; try{ LS=await api('/ls/devices/'+id,{method:'DELETE'}); closeSheet(); drawLs(); }catch(e){ alert(e.message); } }

/* ---------------- contractor inspections ---------------- */
function lsItemsHtml(){
  const wr=canWork();
  return '<div class="panel"><div class="eyebrow">Contractor inspections and certificates</div>'+LS.items.map(i=>{
    const col={late:'var(--rose)',never:'var(--rose)',soon:'var(--sulfur)',ok:'var(--mint)'}[i.state];
    return '<div class="att" onclick="lsItemSheet('+i.id+')"><span class="lv" style="background:'+col+'"></span><div style="flex:1;min-width:0"><div class="t">'+esc(i.title)+'</div>'+
      '<div class="m">'+(i.last_done?'Last '+esc(fmtDate(i.last_done))+' · ':'No record · ')+(i.days==null?'':i.days<0?'<span style="color:var(--rose)">'+(-i.days)+' days overdue</span>':'due in '+i.days+' days')+' · every '+esc(freqLabel(i.freq_days))+(i.vendor_name?' · '+esc(i.vendor_name):'')+'</div></div>'+
      (wr?'<button class="btn-2" style="padding:6px 10px;font-size:12px" onclick="event.stopPropagation();lsDoneForm('+i.id+')">Done</button>':'')+'</div>';
  }).join('')+(wr?'<button class="btn-2 full" style="margin-top:10px" onclick="lsItemForm()">+ Add an inspection</button>':'')+
  '<div class="dim" style="font-size:12px;margin-top:8px">Record the date the contractor finished and the report or certificate number. The next due date sets itself.</div></div>';
}
async function lsItemSheet(id){
  const i=LS.items.find(x=>x.id===id); if(!i) return;
  let log=[]; try{ log=(await api('/ls/items/'+id+'/log')).log; }catch(e){}
  let h='<div class="panel">'+(i.why?'<div class="mid" style="font-size:13px;margin-bottom:10px">'+esc(i.why)+'</div>':'')+'<div class="kv"><div class="k">Every</div><div>'+esc(freqLabel(i.freq_days))+'</div>'+
    '<div class="k">Last done</div><div>'+esc(i.last_done?fmtDate(i.last_done):'No record')+'</div><div class="k">Next due</div><div style="color:'+(i.days!=null&&i.days<0?'var(--rose)':'inherit')+'">'+esc(i.next_due?fmtDate(i.next_due):'')+'</div>'+
    (i.vendor_name?'<div class="k">Vendor</div><div>'+esc(i.vendor_name)+(i.vendor_phone?' · <a href="tel:'+esc(i.vendor_phone.replace(/[^0-9+]/g,''))+'" style="color:var(--ice)">'+esc(i.vendor_phone)+'</a>':'')+'</div>':'')+'</div>'+
    (canWork()?'<div class="acts" style="margin-top:12px"><button class="btn btn-good" onclick="lsDoneForm('+id+')">Mark done</button><button class="btn-2" onclick="lsItemForm('+id+')">Edit</button></div>':'')+'</div>';
  h+='<div class="panel"><div class="eyebrow">History</div>'+(log.length?'<table>'+log.map(l=>'<tr><td style="white-space:nowrap"><b>'+esc(fmtDate(l.done_on))+'</b></td><td>'+esc([l.vendor,l.note].filter(Boolean).join(' · ')||'Done')+'<br><span class="dim" style="font-size:11px">'+esc(l.by)+'</span></td></tr>').join('')+'</table>':'<div class="dim">No record yet.</div>')+'</div>';
  sheet(i.title,'Life safety inspection',h);
}
function lsDoneForm(id){
  const i=LS.items.find(x=>x.id===id);
  sheet(i.title,'Mark done','<div class="panel">'+row2(F('Date done',inp('lfD',today(),'','date')),F('Done by',inp('lfV',i.vendor_name||'','Contractor name')))+
    F('Report or certificate',inp('lfN','','Report #, deficiencies found, tag color'))+'<button class="btn btn-good full" style="margin-top:12px" onclick="lsSaveDone('+id+')">Save</button>'+errBox('lfMsg')+'</div>');
}
async function lsSaveDone(id){ try{ LS=await api('/ls/items/'+id+'/done',{method:'POST',body:{done_on:val('lfD'),vendor:val('lfV'),note:val('lfN')}}); toast('Recorded'); closeSheet(); drawLs(); refreshAlerts(); }catch(e){ showErr('lfMsg',e); } }
function lsItemForm(id){
  const i=id?LS.items.find(x=>x.id===id):{freq_days:365,ls_kind:''};
  sheet(id?'Edit inspection':'New inspection','Life safety','<div class="panel">'+F('Inspection',inp('liT',i.title,'Kitchen hood suppression semiannual'))+
    row2(F('Every (days)',inp('liF',i.freq_days,'365','number')),F('Vendor',sel('liV',[['','None set']].concat((META.vendors||[]).map(v=>[v.id,v.name])),i.vendor_id||'')))+
    F('Covers',sel('liK',[['','General']].concat(Object.values(LS.kinds).map(k=>[k.key,k.plural])),i.ls_kind||''))+
    F('Why it matters',inp('liW',i.why,'What the fire marshal asks for'))+
    '<button class="btn full" style="margin-top:12px" onclick="lsSaveItem('+(id||0)+')">Save</button>'+(id?'<button class="btn-2 full" style="margin-top:8px;color:var(--rose)" onclick="lsDelItem('+id+')">Remove</button>':'')+errBox('liMsg')+'</div>');
}
async function lsSaveItem(id){ try{ LS=await api('/ls/items',{method:'POST',body:{id:id||undefined,title:val('liT'),freq_days:val('liF'),vendor_id:val('liV'),ls_kind:val('liK'),why:val('liW')}}); closeSheet(); drawLs(); }catch(e){ showErr('liMsg',e); } }
async function lsDelItem(id){ if(!confirm('Remove this inspection?')) return; LS=await api('/ls/items/'+id,{method:'DELETE'}); closeSheet(); drawLs(); }

/* ---------------- report builder ---------------- */
const LS_PRESETS={
  binder:['Fire Marshal Binder','Everything the fire marshal asks for, ready for a 3-ring binder: crest cover page with contents, contractor reports, every device, deficiencies and fixes, expiring items, history, and a sign-off page. Each section starts a new page.',365,['cover','summary','contractor','inventory','deficiencies','expiring','history','signature'],[]],
  summary:['Program Summary','One page for Bruce or the GM: readiness, contractor status, open problems, and what is coming due.',30,['summary','contractor','deficiencies','expiring','upcoming'],[]],
  deficiencies:['Deficiencies and Corrective Actions','Every failed check in the period, the work order it opened, and whether it has passed since.',90,['deficiencies','signature'],[]],
  due:['Inspections Due (work list)','A printable walk list of every check and contractor inspection coming due, with a box to tick.',0,['upcoming'],[]],
  inventory:['Device Inventory','Every device with its tag, location, details, last check, and status.',0,['inventory'],[]],
  logsheet:['Paper Log Sheets','Printable monthly sign-off sheets for the clipboard or binder: one page per building and device type, a box for each month. Checks already logged in the app print in the boxes.',0,['logsheet'],[]],
  history:['Inspection History','Every check logged in the period with readings and who did it.',90,['history','signature'],[]],
  aed:['AED Readiness','AEDs only: pads and battery dates, monthly checks, and any failures.',90,['summary','inventory','expiring','history','deficiencies'],['aed']],
  elevator:['Elevator Compliance','Elevators only: state certificate, contractor visits, monthly owner checks.',365,['summary','contractor','inventory','history','deficiencies'],['elevator']]
};
const LS_SECTIONS=[['cover','Cover page with crest and contents'],['logsheet','Paper log sheets (month boxes)'],['summary','Summary and scorecard'],['contractor','Contractor inspections'],['inventory','Device inventory'],['deficiencies','Deficiencies and fixes'],
  ['expiring','Expiring parts and certificates'],['history','Inspection history'],['upcoming','Coming due (work list)'],['signature','Sign-off lines']];
function lsReportHtml(){
  const kinds=Object.values(LS.kinds);
  return '<div class="panel"><div class="eyebrow">Report builder</div>'+
    F('Report',sel('lrType',Object.keys(LS_PRESETS).map(k=>[k,LS_PRESETS[k][0]]),'binder').replace('<select','<select onchange="lsPreset()"'))+
    '<div class="dim" id="lrWhy" style="font-size:12px;margin-top:6px"></div>'+
    F('Title on the report',inp('lrTitle','',''))+
    row2(F('From',inp('lrFrom','','','date')),F('To',inp('lrTo',today(),'','date')))+
    '<div class="acts" style="margin-top:6px">'+[[30,'30 days'],[90,'90 days'],[365,'12 months'],['ytd','This year']].map(([d,l])=>'<button class="btn-2" style="padding:5px 10px;font-size:12px" onclick="lsRange(\''+d+'\')">'+l+'</button>').join('')+'</div>'+
    '<label class="fl">Device types <span class="dim">(none checked = all)</span></label><div class="lsopt" id="lrKinds">'+kinds.map(k=>'<label><input type="checkbox" value="'+k.key+'">'+esc(k.plural)+'</label>').join('')+'</div>'+
    '<label class="fl">Buildings <span class="dim">(none checked = all)</span></label><div class="lsopt" id="lrBld">'+LS.buildings.map(b=>'<label><input type="checkbox" value="'+esc(b)+'">'+esc(b)+'</label>').join('')+'</div>'+
    '<label class="fl">Sections</label><div class="lsopt" id="lrSec">'+LS_SECTIONS.map(([k,l])=>'<label><input type="checkbox" value="'+k+'">'+esc(l)+'</label>').join('')+'</div>'+
    row2(F('Group devices by',sel('lrGroup',[['building','Building'],['kind','Device type']],'building')),F('Coming due window (days)',inp('lrAhead','60','60','number')))+
    row2(F('Log sheet year',inp('lrYear',today().slice(0,4),'','number')),F('Log sheet boxes',sel('lrPre',[['1','Fill in checks already logged'],['0','Leave blank for paper']],'1')))+
    '<label class="fl" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="lrBrk" style="width:auto;margin:0"> Start each section on a new page (for binders)</label>'+
    F('Prepared by',inp('lrBy',ME?ME.name:'',''))+
    F('Notes printed on the report',inp('lrNotes','','Anything the reader should know'))+
    '<button class="btn full" style="margin-top:14px" onclick="lsRunReport()">Build report</button>'+
    '<div class="dim" style="font-size:12px;margin-top:8px">The report opens in a new page. Print it or save it as a PDF from there.</div></div>'+
    '<div class="panel"><div class="eyebrow">One tap</div><div class="acts">'+
    '<button class="btn-2" onclick="lsQuick(\'binder\')">Fire marshal binder</button><button class="btn-2" onclick="lsQuick(\'due\')">This month\'s walk list</button>'+
    '<button class="btn-2" onclick="lsQuick(\'deficiencies\')">Open deficiencies</button><button class="btn-2" onclick="lsQuick(\'logsheet\')">Paper log sheets</button><button class="btn-2" onclick="lsQuick(\'summary\')">Summary for Bruce</button></div></div>';
}
function lsPreset(first){
  const k=val('lrType')||'binder', P=LS_PRESETS[k];
  $('lrWhy').textContent=P[1];
  $('lrTitle').value=P[0]==='Program Summary'?'Life Safety Program Summary':P[0];
  const to=val('lrTo')||today();
  $('lrFrom').value=P[2]?addDaysC(to,-P[2]):addDaysC(to,-30);
  document.querySelectorAll('#lrSec input').forEach(x=>{ x.checked=P[3].includes(x.value); });
  document.querySelectorAll('#lrKinds input').forEach(x=>{ x.checked=P[4].includes(x.value); });
  $('lrBrk').checked=k==='binder'||k==='logsheet';
}
function addDaysC(d,n){ const x=new Date(d+'T12:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
function lsRange(d){ const to=today(); $('lrTo').value=to; $('lrFrom').value=d==='ytd'?to.slice(0,4)+'-01-01':addDaysC(to,-parseInt(d,10)); }
function lsChecked(id){ return [...document.querySelectorAll('#'+id+' input:checked')].map(x=>x.value); }
function lsRunReport(){
  const q=new URLSearchParams({type:val('lrType'),title:val('lrTitle'),from:val('lrFrom'),to:val('lrTo'),kinds:lsChecked('lrKinds').join(','),
    buildings:lsChecked('lrBld').join(','),sections:lsChecked('lrSec').join(','),group:val('lrGroup'),ahead:val('lrAhead'),breaks:$('lrBrk').checked?'1':'0',year:val('lrYear'),prefill:val('lrPre'),prepared_by:val('lrBy'),notes:val('lrNotes')});
  if(!lsChecked('lrSec').length) return toast('Pick at least one section');
  openHtml('/ls/report?'+q.toString());
}
function lsQuick(k){ openHtml('/ls/report?type='+k+(k==='due'?'&ahead=31':'')); }

/* ---------------- QR tags ---------------- */
async function lsPrintTags(tag){
  const w=window.open('','_blank');
  if(w) w.document.write('<p style="font-family:sans-serif;padding:20px">Building tags…</p>');
  try{
    let tags=(await api('/ls/tags'+(LSKIND&&!tag?'?kinds='+LSKIND:''))).tags;
    if(tag) tags=tags.filter(t=>t.apt===tag);
    const o=location.origin;
    const card=t=>'<div class="c"><img src="'+o+'/api/public/tag-qr.svg?t='+encodeURIComponent(t.apt)+'" alt=""><div class="b"><div class="tg">'+esc(t.apt)+'</div><div class="ty">'+esc(t.type)+'</div>'+
      '<div class="lo">'+esc([t.building,t.location].filter(Boolean).join(' · '))+'</div><div class="hint">Scan in Clubhouse IQ to log the monthly check</div></div></div>';
    const html='<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Life safety QR tags</title><style>'+
      'body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;background:#F3EFE5}.pg{max-width:820px;margin:0 auto;background:#fff;padding:18px}'+
      'h1{font-family:Georgia,serif;color:#1F3A63;font-size:20px;margin:0 0 4px}.sub{color:#7C8494;font-size:12px;margin-bottom:14px}'+
      '.g{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.c{display:flex;gap:8px;border:2px solid #B3362D;border-radius:6px;padding:8px;break-inside:avoid}'+
      '.c img{width:72px;height:72px;flex:0 0 72px}.b{min-width:0}.tg{font-family:Menlo,Consolas,monospace;font-size:16px;font-weight:bold;color:#1F3A63}'+
      '.ty{font-size:10px;color:#B3362D;text-transform:uppercase;letter-spacing:1px}.lo{font-size:10px;color:#4A5466;margin-top:2px}.hint{font-size:8px;color:#7C8494;margin-top:4px}'+
      '.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px;margin:0 4px}'+
      '@media(max-width:560px){.g{grid-template-columns:1fr}}@media print{.bar{display:none}body{background:#fff}.pg{padding:0}}</style></head><body>'+
      '<div class="bar"><button onclick="window.print()">Print or save PDF</button><button onclick="window.close()">Close</button></div>'+
      '<div class="pg"><h1>Life safety QR tags</h1><div class="sub">'+tags.length+' tags. Stick one beside each extinguisher cabinet, exit sign, AED, door, riser, panel, generator, and elevator machine room.</div>'+
      '<div class="g">'+tags.map(card).join('')+'</div></div></body></html>';
    if(w){ w.document.open(); w.document.write(html); w.document.close(); }
    else sheet('QR tags','Life safety','<iframe style="width:100%;height:75vh;border:1px solid var(--edge);background:#fff" srcdoc="'+esc(html)+'"></iframe>');
  }catch(e){ if(w) w.close(); alert(e.message); }
}

/* A scanned tag that belongs to a life safety device opens its check. */
(function hookScan(){
  const orig=window.scanOpen;
  if(typeof orig!=='function') return;
  window.scanOpen=async function(tag){
    const t=String(tag||'').trim().toUpperCase(); if(!t) return;
    try{
      const r=await api('/ls/tag/'+encodeURIComponent(t));
      if(!LS) LS=await api('/ls');
      const d=LS.devices.find(x=>x.id===r.id);
      const due=d&&d.checks.find(c=>c.state!=='ok'&&c.state!=='soon');
      if(due) return lsCheckForm(r.id,due.key);
      return lsDevice(r.id);
    }catch(e){ return orig(tag); }
  };
})();
