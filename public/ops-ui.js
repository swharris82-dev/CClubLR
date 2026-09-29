/* Clubhouse IQ: roles, alerts, parts, vendors, team, monthly report.
   Loaded after the main script in index.html and shares its globals
   ($, api, esc, ME, META, showTab, toast, closeSheet, fmtDate, ago...). */

/* ================= ROLES ================= */
const ROLE_TABS={
  admin:['work','diagnose','record','history','parts','vendors','dash','reports','team'],
  manager:['work','diagnose','record','history','parts','vendors','dash','reports','team'],
  tech:['work','diagnose','record','history','parts','vendors','dash','reports'],
  viewer:['dash','work','vendors','reports'],
  staff:['work']
};
const ROLE_NAME={admin:'Admin',manager:'Manager',tech:'Tech',staff:'Staff',viewer:'View only'};
const canWork=()=>ME&&['admin','manager','tech'].includes(ME.role);
const isMgr=()=>ME&&['admin','manager'].includes(ME.role);
const isStaff=()=>ME&&ME.role==='staff';
const money=n=>'$'+Math.round(+n||0).toLocaleString();
const money2=n=>'$'+(+n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const qn=n=>{ n=+n||0; return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,''); };

function applyRole(){
  const role=(ME&&ME.role)||'tech';
  document.body.className=document.body.className.replace(/\brole-\w+/g,'').trim()+' role-'+role;
  const allowed=ROLE_TABS[role]||ROLE_TABS.tech;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('hide',!allowed.includes(t.dataset.tab)));
  if(!allowed.includes(TAB)) TAB=allowed[0];
  const wt=document.querySelector('.tab[data-tab="work"]');
  if(wt) wt.firstChild.textContent=isStaff()?'My requests':'Work';
  $('who').textContent=ME.name+' · '+(ROLE_NAME[role]||role);
  $('workNav').classList.toggle('hide',isStaff());
  const nb=document.querySelector('#woPane > button.btn');
  if(nb){ nb.textContent=isStaff()?'+ Submit a request':'+ New work order'; nb.classList.toggle('hide',ME.role==='viewer'); }
  if(ME.must_change) setTimeout(()=>accountSheet(true),400);
}

/* ================= ALERTS ================= */
let ALERTS=[];
async function refreshAlerts(){
  if(!TOKEN) return;
  try{
    const d=await api('/alerts'); ALERTS=d.alerts;
    const n=d.count, b=$('bellN');
    b.textContent=n>9?'9+':n; b.classList.toggle('hide',!n);
    $('bellBtn').classList.toggle('hot',ALERTS.some(a=>a.level==='critical'));
  }catch(e){}
}
const LV_COLOR={critical:'var(--rose)',warn:'var(--sulfur)',info:'var(--ice-dim)'};
function alertRows(list){
  if(!list.length) return '<div class="dim" style="padding:6px 0">Nothing needs attention right now.</div>';
  return list.map((a,i)=>'<div class="att" onclick="goAlert('+i+')"><span class="lv" style="background:'+LV_COLOR[a.level]+'"></span>'+
    '<div style="flex:1;min-width:0"><div class="t">'+esc(a.title)+'</div>'+(a.detail?'<div class="m">'+esc(a.detail)+'</div>':'')+'</div><span class="dim">›</span></div>').join('');
}
function alertsSheet(){
  sheet('Alerts',ALERTS.length+' item'+(ALERTS.length===1?'':'s'),
    '<div class="panel">'+alertRows(ALERTS)+'</div>'+
    (isStaff()?'':'<button class="btn-2 full" style="margin-bottom:14px" onclick="closeSheet();showTab(\'reports\');setTimeout(()=>{const e=$(\'notifyPanel\');if(e)e.scrollIntoView({behavior:\'smooth\'})},400)">Email and text alert settings</button>'));
}
function goAlert(i){
  const a=ALERTS[i]; if(!a||!a.go) return; const g=a.go;
  closeSheet();
  if(g.wo){ openWo(g.wo); return; }
  if(g.tab==='work'){ WORKVIEW=g.view||'wo'; if(g.filter) WOFILTER=g.filter; WOUNIT=''; }
  if(g.tab==='parts'){ PVIEW=g.view||'stock'; }
  if(g.tab==='vendors'){ VVIEW=g.view||'vendors'; if(g.vendor){ showTab('vendors'); vendorSheet(g.vendor); return; } }
  showTab(g.tab);
}
async function dashAlerts(){
  await refreshAlerts();
  const body=$('dashBody'); if(!body||!ALERTS.length) return;
  const old=$('dashAl'); if(old) old.remove();
  const p=document.createElement('div'); p.className='panel'; p.id='dashAl';
  p.innerHTML='<div class="eyebrow">Needs attention · '+ALERTS.length+'</div>'+alertRows(ALERTS.slice(0,6))+
    (ALERTS.length>6?'<button class="btn-2 full" style="margin-top:8px" onclick="alertsSheet()">See all '+ALERTS.length+'</button>':'');
  body.insertBefore(p,body.firstChild);
}

/* ================= SHEETS & FORM HELPERS ================= */
function sheet(title,sub,body){
  let bg=$('sheetBg');
  if(!bg){ bg=document.createElement('div'); bg.id='sheetBg'; bg.className='sheet-bg';
    bg.onclick=e=>{ if(e.target===bg) closeSheet(); }; document.body.appendChild(bg); document.body.style.overflow='hidden'; }
  bg.innerHTML='<div class="sheet"><div class="sheet-hd">'+(sub?'<div class="no">'+esc(sub)+'</div>':'')+'<div class="tt">'+esc(title)+'</div>'+
    '<button class="x" onclick="closeSheet()">✕</button></div><div class="sheet-bd">'+body+'<div style="height:24px"></div></div></div>';
  return bg;
}
const F=(label,input)=>'<label class="fl">'+esc(label)+'</label>'+input;
const inp=(id,val,ph,type,extra)=>'<input id="'+id+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" placeholder="'+esc(ph||'')+'"'+(extra||'')+'>';
const sel=(id,opts,cur)=>'<select id="'+id+'">'+opts.map(o=>{ const v=Array.isArray(o)?o[0]:o, l=Array.isArray(o)?o[1]:o;
  return '<option value="'+esc(v)+'"'+(String(v)===String(cur==null?'':cur)?' selected':'')+'>'+esc(l)+'</option>'; }).join('')+'</select>';
const row2=(a,b)=>'<div class="row"><div>'+a+'</div><div>'+b+'</div></div>';
const val=id=>{ const e=$(id); return e?(e.type==='checkbox'?e.checked:e.value.trim()):''; };
const errBox=id=>'<div class="dim" id="'+id+'" style="margin-top:8px"></div>';
const showErr=(id,e)=>{ const el=$(id); if(el) el.innerHTML='<span style="color:var(--rose)">'+esc(e.message||e)+'</span>'; else alert(e.message||e); };
function copyOut(text,msg){ navigator.clipboard.writeText(text).then(()=>toast(msg||'Copied'),()=>prompt('Copy:',text)); }

/* ================= ACCOUNT ================= */
async function accountSheet(forcePw){
  let me=ME, st={};
  try{ me=(await api('/me')).user; ME=Object.assign(ME,me); }catch(e){}
  try{ if(!isStaff()) st=await api('/notify/status'); }catch(e){}
  const n=me.notify||{};
  const ck=(k,ch,label)=>'<label class="ck-row"><input type="checkbox" data-k="'+k+'" data-ch="'+ch+'"'+((n[k]||{})[ch]?' checked':'')+'><span>'+label+'</span></label>';
  let h='';
  if(forcePw) h+='<div class="note n-warr" style="margin-bottom:12px"><b>Set your own password</b>You signed in with a temporary one.</div>';
  h+='<div class="panel"><div class="eyebrow">Change password</div>'+
     F('Current password',inp('pwC','','','password'))+F('New password (8+ characters)',inp('pwN','','','password'))+
     '<button class="btn full" style="margin-top:12px" onclick="savePw()">Update password</button>'+errBox('pwMsg')+'</div>';
  if(!me.demo){
    h+='<div class="panel"><div class="eyebrow">Profile</div>'+F('Name',inp('meN',me.name))+F('Cell number for text alerts',inp('meP',me.phone,'501-555-0123','tel'))+
       '<div class="dim" style="margin-top:6px">'+esc(me.email)+' · '+esc(me.role_label||me.role)+'</div>';
    if(!isStaff()){
      h+='<div class="eyebrow" style="margin-top:16px">Send me</div>'+
        ck('emergency','sms','Text me emergencies')+ck('emergency','email','Email me emergencies')+
        ck('request','email','Email me new staff requests')+ck('assigned','sms','Text me when work is assigned to me')+ck('assigned','email','Email me when work is assigned to me')+
        ck('digest','email','Morning brief email (open work, PM due, alerts)')+ck('monthly','email','Monthly facilities report email')+
        '<div class="dim" style="margin-top:6px">'+(st.email?'Email is on.':'Email is not set up on the server yet.')+' '+(st.sms?'Texts are on.':'Texts are not set up on the server yet.')+'</div>';
    }
    h+='<button class="btn full" style="margin-top:12px" onclick="saveMe()">Save</button>'+errBox('meMsg')+'</div>';
  }
  sheet(me.name,'My account',h);
}
async function savePw(){
  try{ await api('/me/password',{method:'POST',body:{current:$('pwC').value,next:$('pwN').value}}); ME.must_change=false; toast('Password updated'); closeSheet(); }
  catch(e){ showErr('pwMsg',e); }
}
async function saveMe(){
  const notify={};
  document.querySelectorAll('#sheetBg input[data-k]').forEach(el=>{ (notify[el.dataset.k]=notify[el.dataset.k]||{})[el.dataset.ch]=el.checked; });
  try{ const d=await api('/me',{method:'PUT',body:{name:val('meN'),phone:val('meP'),notify}}); ME=Object.assign(ME,d.user); applyRole(); toast('Saved'); closeSheet(); }
  catch(e){ showErr('meMsg',e); }
}

/* ================= PARTS ================= */
let PARTS=[], PSTATS={}, PCATS=[], PVIEW='stock', PCAT='', PQ='';
async function loadParts(){
  const b=$('partsBody');
  if(!PARTS.length) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading parts</span></div>';
  try{ const d=await api('/parts'); PARTS=d.parts; PSTATS=d.stats; PCATS=d.categories; drawParts(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function drawParts(){
  const s=PSTATS;
  let h='<div class="kpis" style="margin-bottom:12px">'+
    kpi(s.count,'Parts tracked','',"")+kpi(money(s.value),'On the shelf','Stock value at last cost','')+
    kpi(s.low,'At or below min',s.out+' out of stock',s.low?'bad':'good',"PVIEW='reorder';drawParts()")+
    kpi(PARTS.filter(p=>p.used_90>0).length,'Used in 90 days','','')+'</div>';
  h+='<div class="subnav" id="pNav"><div data-v="stock" class="'+(PVIEW==='stock'?'on':'')+'">Stock</div><div data-v="reorder" class="'+(PVIEW==='reorder'?'on':'')+'">Reorder'+(s.low?' ('+s.low+')':'')+'</div></div>';
  h+='<div id="pPane"></div>';
  $('partsBody').innerHTML=h;
  $('pNav').querySelectorAll('div').forEach(d=>d.onclick=()=>{ PVIEW=d.dataset.v; drawParts(); });
  PVIEW==='reorder'?drawReorder():drawStock();
}
function stockCls(p){ return p.min_qty>0&&p.on_hand<=0?'out':(p.min_qty>0&&p.on_hand<=p.min_qty?'low':'ok'); }
function drawStock(){
  let h='<div class="row" style="margin-bottom:10px"><input id="pQ" placeholder="Search parts, bins, what it fits" value="'+esc(PQ)+'">'+
    (canWork()?'<button class="btn" style="flex:0 0 auto" onclick="partForm()">+ Part</button>':'')+'</div>';
  const cats=[...new Set(PARTS.map(p=>p.category))];
  h+='<div class="filters" id="pCats"><div data-c="" class="'+(!PCAT?'on':'')+'">All</div>'+cats.map(c=>'<div data-c="'+esc(c)+'" class="'+(PCAT===c?'on':'')+'">'+esc(c)+'</div>').join('')+'</div>';
  h+='<div id="pList"></div>';
  if(!PARTS.length){
    h='<div class="panel"><div class="eyebrow">Parts and inventory</div><div class="mid">Track what is on the shelf, pull parts onto work orders, and get a reorder list when stock runs low.</div>'+
      (canWork()?'<button class="btn full" style="margin-top:12px" onclick="starterParts()">Load a starter list for the club</button><button class="btn-2 full" style="margin-top:8px" onclick="partForm()">Add a part by hand</button>':'')+
      '<div class="dim" style="margin-top:8px">The starter list has filters, belts, capacitors, contactors, boiler and tower parts, water treatment, kitchen, plumbing, pool, and lighting. Counts start at zero.</div></div>';
  }
  $('pPane').innerHTML=h;
  if(!PARTS.length) return;
  $('pQ').oninput=e=>{ PQ=e.target.value; drawPartList(); };
  $('pCats').querySelectorAll('div').forEach(d=>d.onclick=()=>{ PCAT=d.dataset.c; drawStock(); });
  drawPartList();
}
function drawPartList(){
  const q=PQ.toLowerCase();
  const list=PARTS.filter(p=>(!PCAT||p.category===PCAT)&&(!q||[p.name,p.part_no,p.location,p.fits,p.manufacturer].join(' ').toLowerCase().includes(q)));
  $('pList').innerHTML=list.length?list.map(p=>{
    const c=stockCls(p), pct=p.min_qty>0?Math.min(100,Math.round(100*p.on_hand/(p.min_qty*2))):100;
    return '<div class="prow" onclick="partSheet('+p.id+')"><div style="flex:1;min-width:0"><div class="t">'+esc(p.name)+'</div>'+
      '<div class="m">'+esc([p.location,p.fits].filter(Boolean).join(' · '))+'</div>'+
      '<div class="sbar"><i class="'+c+'" style="width:'+Math.max(3,pct)+'%"></i></div></div>'+
      '<div class="qty '+c+'"><b>'+qn(p.on_hand)+'</b><span>'+esc(p.uom)+(p.min_qty?' · min '+qn(p.min_qty):'')+'</span></div></div>';
  }).join(''):'<div class="empty"><div class="big">No match</div>Try a different search.</div>';
}
async function starterParts(){
  try{ const d=await api('/parts/starter',{method:'POST'}); toast(d.created+' parts added'); PARTS=[]; loadParts(); }catch(e){ alert(e.message); }
}
async function drawReorder(){
  $('pPane').innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Building the order</span></div>';
  try{
    const d=await api('/parts/reorder');
    if(!d.groups.length){ $('pPane').innerHTML='<div class="empty"><div class="big">Nothing to order</div>Every part with a minimum set is above it.</div>'; return; }
    window._RO=d.groups;
    $('pPane').innerHTML=d.groups.map((g,gi)=>'<div class="panel"><div class="eyebrow">'+esc(g.vendor)+' · '+money2(g.total)+'</div>'+
      '<table><tr><th>Part</th><th style="text-align:right">Have</th><th style="text-align:right">Order</th></tr>'+
      g.items.map(p=>'<tr onclick="partSheet('+p.id+')" style="cursor:pointer"><td><span style="color:var(--text);font-weight:600">'+esc(p.name)+'</span>'+(p.part_no?'<br><span class="dim" style="font-size:11px">'+esc(p.part_no)+'</span>':'')+'</td>'+
        '<td style="text-align:right;color:'+(p.on_hand<=0?'var(--rose)':'var(--sulfur)')+'">'+qn(p.on_hand)+'</td><td style="text-align:right"><b>'+qn(p.order_qty)+'</b> '+esc(p.uom)+'</td></tr>').join('')+'</table>'+
      '<div class="acts" style="margin-top:10px"><button class="btn-2" onclick="copyOrder('+gi+')">Copy order</button>'+
      (g.email?'<button class="btn-2" onclick="mailOrder('+gi+')">Email order</button>':'')+
      (g.phone?'<button class="btn-2" onclick="location.href=\'tel:'+esc(g.phone.replace(/[^0-9+]/g,''))+'\'">Call</button>':'')+'</div></div>').join('')+
      '<div class="dim" style="text-align:center;margin-bottom:12px">Order quantity brings each part back to twice its minimum, or the reorder amount you set.</div>';
  }catch(e){ $('pPane').innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function orderText(g){
  return 'Parts order for '+(META.club||'Country Club of Little Rock')+'\n\n'+g.items.map(p=>'- '+qn(p.order_qty)+' '+p.uom+'  '+p.name+(p.part_no?' ('+p.part_no+')':'')).join('\n')+
    '\n\nPlease confirm price and delivery. Thank you,\n'+ME.name;
}
function copyOrder(i){ copyOut(orderText(window._RO[i]),'Order copied'); }
function mailOrder(i){ const g=window._RO[i]; location.href='mailto:'+encodeURIComponent(g.email)+'?subject='+encodeURIComponent('Parts order')+'&body='+encodeURIComponent(orderText(g)); }

async function partSheet(id){
  let p; try{ p=(await api('/parts/'+id)).part; }catch(e){ return alert(e.message); }
  window._P=p;
  const c=stockCls(p);
  let h='<div class="panel"><div style="display:flex;align-items:baseline;gap:10px"><div class="hero-n" style="color:'+(c==='ok'?'var(--mint)':c==='low'?'var(--sulfur)':'var(--rose)')+'">'+qn(p.on_hand)+'</div><div class="mid">'+esc(p.uom)+' on hand'+(p.min_qty?' · min '+qn(p.min_qty):'')+'</div></div>'+
    '<div class="kv" style="margin-top:10px">'+
    (p.location?'<div class="k">Bin</div><div>'+esc(p.location)+'</div>':'')+
    (p.fits?'<div class="k">Fits</div><div>'+esc(p.fits)+'</div>':'')+
    (p.part_no?'<div class="k">Part no.</div><div>'+esc(p.part_no)+'</div>':'')+
    '<div class="k">Last cost</div><div>'+money2(p.unit_cost)+' / '+esc(p.uom)+'</div>'+
    (p.vendor_name?'<div class="k">Buy from</div><div>'+esc(p.vendor_name)+'</div>':'')+
    (p.notes?'<div class="k">Notes</div><div>'+esc(p.notes)+'</div>':'')+'</div></div>';
  if(canWork()){
    h+='<div class="panel"><div class="eyebrow">Stock movement</div><div class="seg3" id="txK">'+
      [['use','Use'],['receive','Receive'],['count','Count']].map(([k,l],i)=>'<div data-k="'+k+'" class="'+(i===0?'on':'')+'">'+l+'</div>').join('')+'</div>'+
      '<div id="txF"></div><button class="btn full" style="margin-top:12px" onclick="saveTxn()">Save</button>'+errBox('txMsg')+'</div>';
  }
  h+='<div class="panel"><div class="eyebrow">History</div>'+(p.txns.length?'<table>'+p.txns.map(t=>'<tr><td style="white-space:nowrap">'+esc(fmtDate(t.at))+'</td><td>'+
      esc({use:'Used',receive:'Received',count:'Count',adjust:'Adjust'}[t.kind]||t.kind)+(t.apt?' · '+esc(t.apt):'')+(t.wo_id?' · WO #'+t.wo_id:'')+(t.note&&!t.wo_id?'<br><span class="dim" style="font-size:11px">'+esc(t.note)+'</span>':'')+
      '<br><span class="dim" style="font-size:11px">'+esc(t.by||'')+'</span></td><td style="text-align:right;font-family:var(--mono);color:'+(t.qty<0?'var(--rose)':'var(--mint)')+'">'+(t.qty>0?'+':'')+qn(t.qty)+'</td></tr>').join('')+'</table>'
      :'<div class="dim">No movement yet.</div>')+'</div>';
  if(canWork()) h+='<div class="acts" style="margin-bottom:12px"><button class="btn-2" onclick="partForm(window._P)">Edit part</button><button class="btn-2" style="color:var(--rose)" onclick="delPart('+p.id+')">Remove</button></div>';
  sheet(p.name,p.category,h);
  if(canWork()){ $('txK').querySelectorAll('div').forEach(d=>d.onclick=()=>{ $('txK').querySelectorAll('div').forEach(x=>x.classList.toggle('on',x===d)); txForm(d.dataset.k); }); txForm('use'); }
}
let TXK='use';
function txForm(k){
  TXK=k; const p=window._P;
  $('txF').innerHTML=k==='use'?row2(F('Quantity',inp('txQ','1','','number',' step="any" min="0"')),F('Equipment tag',inp('txA','','Optional','text',' list="tagList" style="text-transform:uppercase;font-family:var(--mono)"')))+F('Note',inp('txN','','What it was for'))+tagList()
   :k==='receive'?row2(F('Quantity received',inp('txQ','','','number',' step="any" min="0"')),F('Cost each',inp('txC',p.unit_cost||'','$','number',' step="any"')))+F('Note',inp('txN','','PO or invoice number'))
   :F('Actual count on the shelf',inp('txQ',qn(p.on_hand),'','number',' step="any" min="0"'))+'<div class="dim" style="margin-top:6px">Sets the on-hand number to what you counted.</div>';
}
async function saveTxn(){
  const p=window._P;
  try{
    await api('/parts/'+p.id+'/txn',{method:'POST',body:{kind:TXK,qty:val('txQ'),unit_cost:val('txC'),note:val('txN'),apt:val('txA')}});
    toast('Stock updated'); await loadParts(); partSheet(p.id);
  }catch(e){ showErr('txMsg',e); }
}
async function delPart(id){ if(!confirm('Remove this part from the list?')) return; await api('/parts/'+id,{method:'DELETE'}); closeSheet(); loadParts(); }
function partForm(p){
  p=p||{uom:'ea',category:'General'};
  const vend=[['','None']].concat((META.vendors||[]).map(v=>[v.id,v.name]));
  let h='<div class="panel">'+F('Name',inp('pfN',p.name,'Run capacitor 45/5 MFD 440V'))+
    row2(F('Category',sel('pfC',PCATS.length?PCATS:['General'],p.category)),F('Unit',inp('pfU',p.uom,'ea, box, gal')))+
    row2(F('Part number',inp('pfPN',p.part_no)),F('Manufacturer',inp('pfM',p.manufacturer)))+
    F('Bin or shelf',inp('pfL',p.location,'Shop, electrical bin'))+
    F('Fits',inp('pfF',p.fits,'Equipment types or tags'))+
    row2(F('Minimum on hand',inp('pfMin',p.min_qty||'','0','number',' step="any"')),F('Reorder amount',inp('pfRe',p.reorder_qty||'','0','number',' step="any"')))+
    row2(F('Cost each',inp('pfCost',p.unit_cost||'','$','number',' step="any"')),p.id?'':F('On hand now',inp('pfOH','','0','number',' step="any"')))+
    F('Buy from',sel('pfV',vend,p.vendor_id||''))+F('Notes',inp('pfNo',p.notes))+
    '<button class="btn full" style="margin-top:14px" onclick="savePart('+(p.id||0)+')">'+(p.id?'Save':'Add part')+'</button>'+errBox('pfMsg')+'</div>';
  sheet(p.id?'Edit part':'New part','Parts',h);
}
async function savePart(id){
  const body={name:val('pfN'),category:val('pfC'),uom:val('pfU'),part_no:val('pfPN'),manufacturer:val('pfM'),location:val('pfL'),fits:val('pfF'),
    min_qty:val('pfMin'),reorder_qty:val('pfRe'),unit_cost:val('pfCost'),vendor_id:val('pfV'),notes:val('pfNo'),on_hand:val('pfOH')};
  try{ const d=await api(id?'/parts/'+id:'/parts',{method:id?'PUT':'POST',body}); toast('Saved'); await loadParts(); partSheet(d.part.id); }
  catch(e){ showErr('pfMsg',e); }
}

/* ----- parts on work order close ----- */
let PICKED=[];
async function partsPicker(){
  PICKED=[];
  const box=$('cmParts'); if(!box) return;
  if(!PARTS.length){ try{ const d=await api('/parts'); PARTS=d.parts; PSTATS=d.stats; PCATS=d.categories; }catch(e){} }
  if(!PARTS.length){ box.innerHTML=''; return; }
  box.innerHTML='<label class="fl">Parts from stock</label><div id="pkList"></div>'+
    '<input id="pkQ" placeholder="Search stock to add a part" autocomplete="off"><div id="pkRes"></div>';
  $('pkQ').oninput=e=>{
    const q=e.target.value.toLowerCase().trim();
    const res=q?PARTS.filter(p=>[p.name,p.part_no,p.fits].join(' ').toLowerCase().includes(q)).slice(0,6):[];
    $('pkRes').innerHTML=res.map(p=>'<div class="pkr" onclick="pickPart('+p.id+')"><span>'+esc(p.name)+'</span><span class="dim">'+qn(p.on_hand)+' '+esc(p.uom)+'</span></div>').join('');
  };
  drawPicked();
}
function pickPart(id){
  const p=PARTS.find(x=>x.id===id); if(!p) return;
  const have=PICKED.find(x=>x.part_id===id); if(have) have.qty++; else PICKED.push({part_id:id,qty:1,name:p.name,uom:p.uom,cost:p.unit_cost});
  $('pkQ').value=''; $('pkRes').innerHTML=''; drawPicked();
}
function drawPicked(){
  const el=$('pkList'); if(!el) return;
  el.innerHTML=PICKED.map((x,i)=>'<div class="pkr on"><span style="flex:1">'+esc(x.name)+'</span>'+
    '<input type="number" step="any" min="0" value="'+x.qty+'" style="width:70px;padding:6px" onchange="PICKED['+i+'].qty=+this.value">'+
    '<span class="dim" style="width:34px">'+esc(x.uom)+'</span><span class="rm" onclick="PICKED.splice('+i+',1);drawPicked()">✕</span></div>').join('')+
    (PICKED.length?'<div class="dim" style="margin:4px 0 8px">Pulled from stock when you mark it complete. About '+money2(PICKED.reduce((s,x)=>s+x.qty*x.cost,0))+'.</div>':'');
}

/* ================= VENDORS ================= */
let VEND={vendors:[],contracts:[],stats:{},trades:[]}, VVIEW='vendors';
const CSTATE={expired:['Expired','var(--rose)'],notice:['Decide now','var(--rose)'],renewing:['Auto-renews soon','var(--sulfur)'],soon:['Ending soon','var(--sulfur)'],active:['Active','var(--mint)'],open:['No end date','var(--dim)']};
async function loadVendors(){
  const b=$('vendorsBody');
  if(!VEND.vendors.length) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading vendors</span></div>';
  try{ VEND=await api('/vendors'); META.vendors=VEND.vendors.map(v=>({id:v.id,name:v.name,trade:v.trade,phone:v.phone})); drawVendors(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function drawVendors(){
  const s=VEND.stats;
  let h='<div class="kpis" style="margin-bottom:12px">'+kpi(money(s.ytd),'Vendor spend YTD','','')+kpi(money(s.annual),'Contracts per year',VEND.contracts.length+' active','')+
    kpi(s.pending,'Invoices to approve',s.pending?money(s.pending_amt):'',s.pending?'bad':'good',"VVIEW='invoices';drawVendors()")+
    kpi(VEND.contracts.filter(c=>['expired','notice','renewing'].includes(c.state)).length,'Contracts needing a decision','','',"VVIEW='contracts';drawVendors()")+'</div>';
  h+='<div class="subnav" id="vNav">'+[['vendors','Vendors'],['contracts','Contracts'],['invoices','Invoices']].map(([k,l])=>'<div data-v="'+k+'" class="'+(VVIEW===k?'on':'')+'">'+l+'</div>').join('')+'</div><div id="vPane"></div>';
  $('vendorsBody').innerHTML=h;
  $('vNav').querySelectorAll('div').forEach(d=>d.onclick=()=>{ VVIEW=d.dataset.v; drawVendors(); });
  if(VVIEW==='contracts') drawContracts(); else if(VVIEW==='invoices') drawInvoices(); else drawVendorList();
}
function drawVendorList(){
  let h=canWork()?'<button class="btn full" style="margin-bottom:12px" onclick="vendorForm()">+ Add vendor</button>':'';
  if(!VEND.vendors.length) h+='<div class="empty"><div class="big">No vendors yet</div>Add the contractors and supply houses the club uses: boiler service, water treatment, controls, kitchen equipment, hood cleaning, elevator, fire.</div>';
  h+=VEND.vendors.map(v=>{
    const ins=v.insurance_days==null?'':(v.insurance_days<0?'<span class="tag late">insurance expired</span>':v.insurance_days<=30?'<span class="tag" style="color:var(--sulfur)">insurance '+v.insurance_days+'d</span>':'');
    return '<div class="woc" onclick="vendorSheet('+v.id+')"><div class="t">'+esc(v.name)+'</div><div class="m">'+esc([v.trade,v.contact].filter(Boolean).join(' · '))+'</div>'+
      '<div class="r">'+(v.contracts?'<span class="tag">'+v.contracts+' contract'+(v.contracts>1?'s':'')+'</span>':'')+(v.ytd?'<span class="tag">'+money(v.ytd)+' YTD</span>':'')+
      (v.pending?'<span class="tag s-new">'+v.pending+' to approve</span>':'')+(v.open_wo?'<span class="tag s-open">'+v.open_wo+' open WO</span>':'')+ins+
      (v.rating?'<span class="tag" style="color:var(--sulfur)">'+'★'.repeat(v.rating)+'</span>':'')+'</div></div>';
  }).join('');
  $('vPane').innerHTML=h;
}
function contractRow(c,showVendor){
  const st=CSTATE[c.state]||CSTATE.open;
  return '<div class="woc" onclick="contractForm('+c.id+')" style="border-left-color:'+st[1]+'"><div class="t">'+esc(c.title)+'</div>'+
    '<div class="m">'+(showVendor?esc(c.vendor)+' · ':'')+(c.end_date?'ends '+esc(c.end_date):'no end date')+(c.annual_cost?' · '+money(c.annual_cost)+'/yr':'')+'</div>'+
    '<div class="r"><span class="tag" style="color:'+st[1]+'">'+st[0]+(c.days!=null&&c.days>=0&&c.state!=='active'?' · '+c.days+'d':'')+'</span>'+
    (c.auto_renew?'<span class="tag">auto-renew</span>':'')+(c.next_visit?'<span class="tag'+(c.next_visit<today()?' late':'')+'">next visit '+esc(fmtDate(c.next_visit))+'</span>':'')+'</div></div>';
}
function drawContracts(){
  let h=canWork()&&VEND.vendors.length?'<button class="btn full" style="margin-bottom:12px" onclick="contractForm()">+ Add contract</button>':'';
  h+=VEND.contracts.length?VEND.contracts.map(c=>contractRow(c,true)).join(''):'<div class="empty"><div class="big">No contracts</div>Track service agreements, their end dates, cancellation notice windows, and scheduled visits.</div>';
  $('vPane').innerHTML=h;
}
let INVF='pending';
async function drawInvoices(){
  $('vPane').innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading invoices</span></div>';
  try{
    const d=await api('/invoices'+(INVF==='all'?'':'?status='+INVF));
    let h=(canWork()&&VEND.vendors.length?'<button class="btn full" style="margin-bottom:12px" onclick="invoiceForm()">+ Enter an invoice</button>':'')+
      '<div class="filters" id="invF">'+[['pending','Waiting approval'],['approved','Approved'],['paid','Paid'],['all','All']].map(([k,l])=>'<div data-f="'+k+'" class="'+(INVF===k?'on':'')+'">'+l+'</div>').join('')+'</div>';
    h+=d.invoices.length?d.invoices.map(invRow).join(''):'<div class="empty"><div class="big">None</div>Nothing in this list.</div>';
    $('vPane').innerHTML=h;
    $('invF').querySelectorAll('div').forEach(x=>x.onclick=()=>{ INVF=x.dataset.f; drawInvoices(); });
  }catch(e){ $('vPane').innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function invRow(i){
  const col={pending:'s-new',approved:'s-open',paid:'s-done',void:'s-cancelled'}[i.status];
  return '<div class="woc"><div style="display:flex;justify-content:space-between;gap:10px"><div class="t">'+esc([i.vendor,i.invoice_no].filter(Boolean).join(' · ')||'Invoice')+'</div><div class="t" style="font-family:var(--mono)">'+money2(i.amount)+'</div></div>'+
    '<div class="m">'+esc(fmtDate(i.inv_date))+(i.building?' · '+esc(i.building):'')+(i.contract?' · '+esc(i.contract):'')+(i.wo_id?' · WO #'+i.wo_id:'')+'</div>'+
    (i.description?'<div style="font-size:13px;margin-top:4px">'+esc(i.description)+'</div>':'')+
    '<div class="r"><span class="tag '+col+'">'+esc(i.status)+'</span>'+(i.approved_by?'<span class="tag">by '+esc(i.approved_by)+'</span>':'')+
    (isMgr()&&i.status==='pending'?'<button class="btn btn-good" style="padding:6px 12px;font-size:12px" onclick="event.stopPropagation();invAct('+i.id+',\'approve\')">Approve</button>':'')+
    (isMgr()&&i.status==='approved'?'<button class="btn" style="padding:6px 12px;font-size:12px" onclick="event.stopPropagation();invAct('+i.id+',\'paid\')">Mark paid</button>':'')+
    ((isMgr()||(canWork()&&i.status==='pending'))&&i.status!=='void'&&i.status!=='paid'?'<span class="rm" onclick="event.stopPropagation();invAct('+i.id+',\'void\')">void</span>':'')+'</div></div>';
}
async function invAct(id,act){
  if(act==='void'&&!confirm('Void this invoice?')) return;
  try{ await api('/invoices/'+id+(act==='void'?'':'/'+act),{method:act==='void'?'DELETE':'POST'}); toast(act==='approve'?'Approved':act==='paid'?'Marked paid':'Voided');
    if($('sheetBg')&&window._V) vendorSheet(window._V.id); loadVendors(); refreshAlerts(); }
  catch(e){ alert(e.message); }
}
async function vendorSheet(id){
  let v; try{ v=(await api('/vendors/'+id)).vendor; }catch(e){ return alert(e.message); }
  window._V=v;
  const tel=p=>p?'<a href="tel:'+esc(p.replace(/[^0-9+]/g,''))+'" style="color:var(--ice)">'+esc(p)+'</a>':'';
  let h='<div class="panel"><div class="kv">'+
    (v.contact?'<div class="k">Contact</div><div>'+esc(v.contact)+'</div>':'')+
    (v.phone?'<div class="k">Phone</div><div>'+tel(v.phone)+'</div>':'')+
    (v.emergency_phone?'<div class="k">After hours</div><div>'+tel(v.emergency_phone)+'</div>':'')+
    (v.email?'<div class="k">Email</div><div><a href="mailto:'+esc(v.email)+'" style="color:var(--ice)">'+esc(v.email)+'</a></div>':'')+
    (v.account_no?'<div class="k">Account #</div><div>'+esc(v.account_no)+'</div>':'')+
    '<div class="k">Insurance</div><div style="color:'+(v.insurance_days==null?'var(--dim)':v.insurance_days<0?'var(--rose)':v.insurance_days<=30?'var(--sulfur)':'var(--mint)')+'">'+
      (v.insurance_exp?(v.insurance_days<0?'Expired ':'Good through ')+esc(v.insurance_exp):'No certificate on file')+'</div>'+
    '<div class="k">W-9</div><div>'+(v.w9_on_file?'On file':'<span style="color:var(--sulfur)">Missing</span>')+'</div>'+
    (v.notes?'<div class="k">Notes</div><div style="white-space:pre-wrap">'+esc(v.notes)+'</div>':'')+'</div>'+
    (canWork()?'<div class="acts" style="margin-top:12px"><button class="btn-2" onclick="vendorForm(window._V)">Edit</button><button class="btn-2" onclick="contractForm(null,'+v.id+')">+ Contract</button><button class="btn-2" onclick="invoiceForm('+v.id+')">+ Invoice</button></div>':'')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Contracts</div>'+(v.contracts.length?v.contracts.map(c=>contractRow(c,false)).join(''):'<div class="dim">None on file.</div>')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Invoices</div>'+(v.invoices.length?v.invoices.map(i=>invRow(Object.assign({vendor:''},i))).join(''):'<div class="dim">None entered.</div>')+'</div>';
  if(v.workorders.length) h+='<div class="panel"><div class="eyebrow">Work orders sent to them</div>'+v.workorders.map(w=>'<div class="att" onclick="closeSheet();openWo('+w.id+')"><div style="flex:1"><div class="t">#'+w.id+' '+esc(w.title)+'</div><div class="m">'+esc(STAFF_LABEL[w.status]||w.status)+' · '+esc(ago(w.created_at))+'</div></div></div>').join('')+'</div>';
  if(v.parts.length) h+='<div class="panel"><div class="eyebrow">Parts bought here</div>'+v.parts.map(p=>'<div class="att" onclick="partSheet('+p.id+')"><div style="flex:1"><div class="t">'+esc(p.name)+'</div></div><span class="dim">'+qn(p.on_hand)+' '+esc(p.uom)+'</span></div>').join('')+'</div>';
  if(canWork()) h+='<button class="btn-2 full" style="color:var(--rose);margin-bottom:12px" onclick="delVendor('+v.id+')">Remove vendor</button>';
  sheet(v.name,v.trade||'Vendor',h);
}
async function delVendor(id){ if(!confirm('Remove this vendor? History stays.')) return; await api('/vendors/'+id,{method:'DELETE'}); closeSheet(); loadVendors(); }
function vendorForm(v){
  v=v||{};
  let h='<div class="panel">'+F('Company name',inp('vfN',v.name))+F('Trade',sel('vfT',[''].concat(VEND.trades||[]),v.trade))+
    row2(F('Contact person',inp('vfC',v.contact)),F('Account #',inp('vfA',v.account_no)))+
    row2(F('Phone',inp('vfP',v.phone,'','tel')),F('After-hours phone',inp('vfE',v.emergency_phone,'','tel')))+
    F('Email',inp('vfM',v.email,'','email'))+
    row2(F('Insurance good through',inp('vfI',v.insurance_exp,'','date')),F('Rating',sel('vfR',[[0,'Not rated'],[5,'★★★★★'],[4,'★★★★'],[3,'★★★'],[2,'★★'],[1,'★']],v.rating||0)))+
    '<label class="ck-row" style="margin-top:10px"><input type="checkbox" id="vfW"'+(v.w9_on_file?' checked':'')+'><span>W-9 on file</span></label>'+
    F('Notes',F('','')+'<textarea id="vfNo" placeholder="Response time, who to ask for, pricing notes">'+esc(v.notes||'')+'</textarea>')+
    '<button class="btn full" style="margin-top:14px" onclick="saveVendor('+(v.id||0)+')">'+(v.id?'Save':'Add vendor')+'</button>'+errBox('vfMsg')+'</div>';
  sheet(v.id?'Edit vendor':'New vendor','Vendors',h);
}
async function saveVendor(id){
  const body={name:val('vfN'),trade:val('vfT'),contact:val('vfC'),account_no:val('vfA'),phone:val('vfP'),emergency_phone:val('vfE'),email:val('vfM'),
    insurance_exp:val('vfI'),rating:val('vfR'),w9_on_file:$('vfW').checked,notes:$('vfNo').value};
  try{ const d=await api(id?'/vendors/'+id:'/vendors',{method:id?'PUT':'POST',body}); toast('Saved'); await loadVendors(); vendorSheet(d.id); }
  catch(e){ showErr('vfMsg',e); }
}
function contractForm(id,vendorId){
  const c=id?VEND.contracts.find(x=>x.id===id):{vendor_id:vendorId,notice_days:30,billing:'annual'};
  if(!c) return;
  const ro=!canWork();
  let h='<div class="panel">'+(id?'':F('Vendor',sel('cfV',VEND.vendors.map(v=>[v.id,v.name]),c.vendor_id)))+
    F('Contract',inp('cfT',c.title,'Annual boiler inspection and tune-up'))+F('What it covers',inp('cfCo',c.covers,'Central Plant boilers'))+
    F('Scope',('<textarea id="cfS" placeholder="What they do on each visit">'+esc(c.scope||'')+'</textarea>'))+
    row2(F('Starts',inp('cfSt',c.start_date,'','date')),F('Ends',inp('cfEn',c.end_date,'','date')))+
    row2(F('Cancel notice (days)',inp('cfNd',c.notice_days,'30','number')),F('Cost per year',inp('cfAc',c.annual_cost||'','$','number',' step="any"')))+
    row2(F('Billed',sel('cfB',['monthly','quarterly','annual','per visit'],c.billing)),F('Visit every (days)',inp('cfVf',c.visit_freq_days||'','0','number')))+
    F('Next visit',inp('cfNv',c.next_visit,'','date'))+
    '<label class="ck-row" style="margin-top:10px"><input type="checkbox" id="cfAr"'+(c.auto_renew?' checked':'')+'><span>Renews automatically unless cancelled</span></label>'+
    F('Notes',inp('cfNo',c.notes))+
    (ro?'':'<button class="btn full" style="margin-top:14px" onclick="saveContract('+(id||0)+')">'+(id?'Save':'Add contract')+'</button>')+
    (id&&!ro&&c.visit_freq_days?'<button class="btn-2 full" style="margin-top:8px" onclick="logVisit('+id+')">Vendor visit done, schedule next</button>':'')+
    (id&&!ro?'<button class="btn-2 full" style="margin-top:8px;color:var(--rose)" onclick="delContract('+id+')">End and remove contract</button>':'')+errBox('cfMsg')+'</div>';
  sheet(id?c.title:'New contract',id?c.vendor:'Contracts',h);
}
async function saveContract(id){
  const body={vendor_id:id?undefined:val('cfV'),title:val('cfT'),covers:val('cfCo'),scope:$('cfS').value,start_date:val('cfSt'),end_date:val('cfEn'),
    notice_days:val('cfNd'),annual_cost:val('cfAc'),billing:val('cfB'),visit_freq_days:val('cfVf'),next_visit:val('cfNv'),auto_renew:$('cfAr').checked,notes:val('cfNo')};
  try{ await api(id?'/contracts/'+id:'/contracts',{method:id?'PUT':'POST',body}); toast('Saved'); closeSheet(); loadVendors(); refreshAlerts(); }
  catch(e){ showErr('cfMsg',e); }
}
async function logVisit(id){ try{ const d=await api('/contracts/'+id+'/visit',{method:'POST'}); toast('Next visit '+(d.next_visit||'cleared')); closeSheet(); loadVendors(); refreshAlerts(); }catch(e){ alert(e.message); } }
async function delContract(id){ if(!confirm('Remove this contract?')) return; await api('/contracts/'+id,{method:'DELETE'}); closeSheet(); loadVendors(); }
function invoiceForm(vendorId,woId){
  const vs=VEND.vendors.length?VEND.vendors:(META.vendors||[]);
  let h='<div class="panel">'+F('Vendor',sel('ifV',vs.map(v=>[v.id,v.name]),vendorId||''))+
    row2(F('Invoice #',inp('ifN')),F('Date',inp('ifD',today(),'','date')))+
    row2(F('Amount',inp('ifA','','$','number',' step="any"')),F('Building',inp('ifB','','','text',' list="woBldgList"')))+
    F('For',inp('ifDe','','Replaced flame safeguard on boiler 2'))+
    F('Work order # (optional)',inp('ifW',woId||'','','number'))+bldgList()+
    '<button class="btn full" style="margin-top:14px" onclick="saveInvoice()">Save invoice</button>'+
    '<div class="dim" style="margin-top:6px">It goes to a manager for approval.</div>'+errBox('ifMsg')+'</div>';
  sheet('Enter invoice','Vendors',h);
}
async function saveInvoice(){
  try{ await api('/invoices',{method:'POST',body:{vendor_id:val('ifV'),invoice_no:val('ifN'),inv_date:val('ifD'),amount:val('ifA'),building:val('ifB'),description:val('ifDe'),wo_id:val('ifW')}});
    toast('Invoice entered'); closeSheet(); if(TAB==='vendors'){ VVIEW='invoices'; INVF='pending'; loadVendors(); } else if(WO) openWo(WO.id); refreshAlerts(); }
  catch(e){ showErr('ifMsg',e); }
}

/* ================= TEAM ================= */
let TEAM={users:[],roles:[],departments:[]};
async function loadTeam(){
  const b=$('teamBody');
  if(!TEAM.users.length) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading</span></div>';
  try{ TEAM=await api('/users'); drawTeam(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function drawTeam(){
  const pend=TEAM.users.filter(u=>!u.active&&!u.last_login), act=TEAM.users.filter(u=>u.active), off=TEAM.users.filter(u=>!u.active&&u.last_login);
  const card=u=>'<div class="woc" onclick="userSheet('+u.id+')"><div style="display:flex;justify-content:space-between;gap:8px"><div class="t">'+esc(u.name)+'</div><span class="tag rl-'+esc(u.role)+'">'+esc(u.role_label)+'</span></div>'+
    '<div class="m">'+esc(u.email)+(u.dept?' · '+esc(u.dept):'')+'</div><div class="m">'+(u.last_login?'Last in '+esc(ago(u.last_login)):'Never signed in')+(u.phone?' · texts on':'')+(u.must_change?' · temp password':'')+'</div></div>';
  let h='<button class="btn full" style="margin-bottom:12px" onclick="userForm()">+ Add a person</button>';
  if(pend.length) h+='<div class="panel"><div class="eyebrow">Waiting for approval · '+pend.length+'</div>'+pend.map(u=>'<div class="att"><div style="flex:1"><div class="t">'+esc(u.name)+'</div><div class="m">'+esc(u.email)+' · signed up '+esc(ago(u.created_at))+'</div></div>'+
      '<button class="btn" style="padding:7px 12px;font-size:12px" onclick="userSheet('+u.id+')">Review</button></div>').join('')+'</div>';
  h+='<div class="eyebrow">Active · '+act.length+'</div>'+act.map(card).join('');
  if(off.length) h+='<div class="eyebrow" style="margin-top:14px">Turned off</div>'+off.map(card).join('');
  h+='<div class="panel" style="margin-top:14px"><div class="eyebrow">What each role can do</div>'+TEAM.roles.map(r=>'<div style="margin-bottom:8px"><span class="tag rl-'+r.key+'">'+esc(r.label)+'</span> <span class="mid" style="font-size:13px">'+esc(r.help)+'</span></div>').join('')+'</div>';
  $('teamBody').innerHTML=h;
}
function roleOpts(){ return TEAM.roles.filter(r=>ME.role==='admin'||r.key!=='admin').map(r=>[r.key,r.label]); }
function userForm(){
  let h='<div class="panel">'+F('Name',inp('ufN','','Bruce Trott'))+F('Email',inp('ufE','','name@cclr1902.org','email'))+
    row2(F('Role',sel('ufR',roleOpts(),'tech')),F('Department',sel('ufD',[''].concat(TEAM.departments),'Maintenance')))+
    F('Cell (for text alerts)',inp('ufP','','','tel'))+
    '<div class="dim" id="ufHelp" style="margin-top:8px"></div>'+
    '<button class="btn full" style="margin-top:14px" onclick="saveNewUser()">Create account</button>'+errBox('ufMsg')+'</div>';
  sheet('Add a person','Team',h);
  const help=()=>{ const r=TEAM.roles.find(x=>x.key===val('ufR')); $('ufHelp').textContent=r?r.help:''; };
  $('ufR').onchange=help; help();
}
async function saveNewUser(){
  try{
    const d=await api('/users',{method:'POST',body:{name:val('ufN'),email:val('ufE'),role:val('ufR'),dept:val('ufD'),phone:val('ufP')}});
    showTemp(d.user,d.temp_password,true); loadTeam();
  }catch(e){ showErr('ufMsg',e); }
}
function showTemp(u,pw,isNew){
  const url=location.origin;
  const msg='Hi '+u.name.split(' ')[0]+', '+(isNew?'your Clubhouse IQ account is set up':'your Clubhouse IQ password was reset')+'.\n\nSign in at '+url+'\nEmail: '+u.email+'\nTemporary password: '+pw+'\n\nIt will ask you to pick your own password.';
  window._INV=msg;
  sheet(u.name,isNew?'Account created':'Password reset','<div class="panel"><div class="eyebrow">Temporary password</div><div class="linkbox" style="font-size:18px;letter-spacing:1px;text-align:center">'+esc(pw)+'</div>'+
    '<div class="dim" style="margin-top:8px">Shown once. They will be asked to change it when they sign in.</div>'+
    '<div class="acts" style="margin-top:12px"><button class="btn" onclick="copyOut(window._INV,\'Invite copied\')">Copy invite</button>'+
    '<button class="btn-2" onclick="location.href=\'mailto:'+esc(u.email)+'?subject=Clubhouse%20IQ%20account&body=\'+encodeURIComponent(window._INV)">Email it</button>'+
    (u.phone?'<button class="btn-2" onclick="location.href=\'sms:'+esc(u.phone.replace(/[^0-9+]/g,''))+'?&body=\'+encodeURIComponent(window._INV)">Text it</button>':'')+'</div></div>');
}
function userSheet(id){
  const u=TEAM.users.find(x=>x.id===id); if(!u) return;
  const locked=ME.role!=='admin'&&u.role==='admin';
  const pending=!u.active&&!u.last_login;
  let h='<div class="panel">'+(pending?'<div class="note n-warr" style="margin-bottom:10px"><b>New signup</b>Pick a role and turn the account on.</div>':'')+
    F('Name',inp('usN',u.name))+'<div class="dim" style="margin-top:4px">'+esc(u.email)+'</div>'+
    row2(F('Role',locked?'<input disabled value="Admin">':sel('usR',roleOpts(),u.role)),F('Department',sel('usD',[''].concat(TEAM.departments),u.dept)))+
    F('Cell',inp('usP',u.phone,'','tel'))+
    '<label class="ck-row" style="margin-top:12px"><input type="checkbox" id="usA"'+(u.active||pending?' checked':'')+(locked?' disabled':'')+'><span>Account is on</span></label>'+
    '<div class="dim" id="usHelp" style="margin-top:6px"></div>'+
    (locked?'<div class="dim" style="margin-top:10px">Only an admin can change an admin account.</div>':
      '<button class="btn full" style="margin-top:14px" onclick="saveUser('+u.id+')">'+(pending?'Approve':'Save')+'</button>'+
      (u.id===ME.id?'':'<button class="btn-2 full" style="margin-top:8px" onclick="resetUser('+u.id+')">Reset password</button>'))+errBox('usMsg')+'</div>';
  sheet(u.name,u.role_label,h);
  const help=()=>{ const r=TEAM.roles.find(x=>x.key===(locked?'admin':val('usR'))); $('usHelp').textContent=r?r.help:''; };
  if($('usR')) $('usR').onchange=help; help();
}
async function saveUser(id){
  try{ await api('/users/'+id,{method:'PUT',body:{name:val('usN'),role:val('usR'),dept:val('usD'),phone:val('usP'),active:$('usA').checked}});
    toast('Saved'); closeSheet(); loadTeam(); refreshAlerts(); loadMeta(); }
  catch(e){ showErr('usMsg',e); }
}
async function resetUser(id){
  if(!confirm('Make a new temporary password? Their old one stops working.')) return;
  try{ const d=await api('/users/'+id+'/reset',{method:'POST'}); showTemp(TEAM.users.find(x=>x.id===id),d.temp_password,false); }
  catch(e){ showErr('usMsg',e); }
}

/* ================= REPORTS: monthly + alert settings ================= */
let RPT_MONTH=new Date().toISOString().slice(0,7);
async function reportsExtras(){
  const body=$('reportsBody'); if(!body) return;
  let st={}; try{ st=await api('/notify/status'); }catch(e){}
  const months=[]; { const d=new Date(); for(let i=0;i<12;i++){ const x=new Date(d.getFullYear(),d.getMonth()-i,1);
    months.push([x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0'),x.toLocaleString('en-US',{month:'long',year:'numeric'})]); } }
  const p=document.createElement('div'); p.className='panel'; p.id='rptPanel';
  p.innerHTML='<div class="eyebrow">Monthly facilities report</div>'+
    '<div class="mid" style="margin-bottom:10px">One page for Bruce and the GM: work done, PM on time, cost avoided, vendor spend, parts, repeat problems, and what needs a decision.</div>'+
    sel('rpM',months,RPT_MONTH)+
    '<div class="acts" style="margin-top:10px"><button class="btn" onclick="openMonthly()">Open report</button>'+
    '<button class="btn-2" onclick="aiMonthly()">Write summary</button>'+
    (isMgr()?'<button class="btn-2" onclick="emailMonthlyNow()"'+(st.email?'':' disabled title="Email is not set up"')+'>Email to managers</button>':'')+'</div>'+
    '<div class="dim" id="rpMsg" style="margin-top:8px">Open it on your phone and use Share, then Print, to save a PDF.</div>';
  const n=document.createElement('div'); n.className='panel'; n.id='notifyPanel';
  n.innerHTML='<div class="eyebrow">Alerts by email and text</div>'+
    '<div class="kv"><div class="k">Email</div><div style="color:'+(st.email?'var(--mint)':'var(--sulfur)')+'">'+(st.email?'On':'Not set up')+'</div>'+
    '<div class="k">Text</div><div style="color:'+(st.sms?'var(--mint)':'var(--sulfur)')+'">'+(st.sms?'On':'Not set up')+'</div>'+
    '<div class="k">Morning brief</div><div>'+(st.email?'Around '+((st.digest_hour%12)||12)+(st.digest_hour<12?' am':' pm')+' Central':'Needs email')+'</div></div>'+
    '<div class="mid" style="margin-top:10px;font-size:13px">Emergencies go out as soon as they are logged or come in from the staff request page. New staff requests, assignments, a morning brief, and the monthly report on the 1st. Everyone picks what they get under their name at the top.</div>'+
    '<div class="acts" style="margin-top:10px"><button class="btn-2" onclick="accountSheet()">My alert settings</button><button class="btn-2" onclick="testAlert()">Send me a test</button>'+
    (canWork()?'<button class="btn-2" onclick="previewDigest()">Preview morning brief</button>':'')+'</div>'+
    (!st.email||!st.sms?'<details style="margin-top:12px"><summary class="dim" style="cursor:pointer">How to turn these on</summary><div class="mid" style="font-size:13px;margin-top:8px;line-height:1.6">'+
      'In Render, open the Clubhouse IQ service, then Environment, and add:<br>'+
      (!st.email?'<b>Email:</b> SMTP_HOST = smtp.gmail.com, SMTP_PORT = 465, SMTP_USER = the Gmail address, SMTP_PASS = a Gmail app password (Google Account, Security, App passwords).<br>':'')+
      (!st.sms?'<b>Text:</b> TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM from a Twilio account.<br>':'')+
      (!st.public_url?'<b>Links:</b> PUBLIC_URL = the app address so alerts link back.<br>':'')+
      'Free Render instances sleep when idle, so scheduled emails can run late. The Starter plan keeps it awake.</div></details>':'')+
    (isMgr()?'<details style="margin-top:10px" ontoggle="if(this.open)loadAlertLog()"><summary class="dim" style="cursor:pointer">Recent alerts sent</summary><div id="alLog" style="margin-top:8px"></div></details>':'');
  body.insertBefore(n,body.firstChild);
  body.insertBefore(p,body.firstChild);
  $('rpM').onchange=e=>RPT_MONTH=e.target.value;
}
async function openMonthly(){
  const w=window.open('','_blank');
  if(w) w.document.write('<p style="font-family:sans-serif;padding:20px">Building report…</p>');
  try{
    const d=await api('/report/monthly?month='+RPT_MONTH);
    if(w){ w.document.open(); w.document.write(d.html); w.document.close(); }
    else sheet('Facilities report',d.data.label,'<iframe style="width:100%;height:75vh;border:1px solid var(--edge);background:#fff" srcdoc="'+esc(d.html)+'"></iframe>');
  }catch(e){ if(w) w.close(); showErr('rpMsg',e); }
}
async function aiMonthly(){
  $('rpMsg').innerHTML='<span class="spin"></span>Writing the summary';
  try{ await api('/report/monthly/summary',{method:'POST',body:{month:RPT_MONTH}}); $('rpMsg').textContent='Summary added to the top of the report.'; }
  catch(e){ showErr('rpMsg',e); }
}
async function emailMonthlyNow(){
  try{ const d=await api('/report/monthly/email',{method:'POST',body:{month:RPT_MONTH}}); $('rpMsg').textContent='Sent to '+d.sent+' '+(d.sent===1?'person':'people')+'.'; }
  catch(e){ showErr('rpMsg',e); }
}
async function testAlert(){
  try{ const d=await api('/alerts/test',{method:'POST'}); toast('Sent: '+Object.keys(d).filter(k=>d[k]).join(' and ')); }
  catch(e){ alert(e.message); }
}
async function previewDigest(){
  try{ const d=await api('/alerts/digest-preview',{method:'POST'});
    sheet('Morning brief','Preview','<iframe style="width:100%;height:70vh;border:1px solid var(--edge);background:#fff" srcdoc="'+esc(d.html)+'"></iframe>'); }
  catch(e){ alert(e.message); }
}
async function loadAlertLog(){
  try{ const d=await api('/alerts/log');
    $('alLog').innerHTML=d.log.length?'<table>'+d.log.map(l=>'<tr><td style="white-space:nowrap">'+esc(fmtWhen(l.at))+'</td><td>'+esc(l.channel)+' · '+esc(l.kind)+'<br><span class="dim" style="font-size:11px">'+esc(l.sent_to)+'</span></td><td style="color:'+(l.ok?'var(--mint)':'var(--rose)')+'">'+(l.ok?'sent':'failed')+'</td></tr>').join('')+'</table>':'<div class="dim">Nothing sent yet.</div>'; }
  catch(e){}
}

/* ================= WORK ORDER SHEET ADDITIONS ================= */
function woVendorBlock(w){
  if(!canWork()&&!w.vendor_name&&!(w.parts||[]).length) return '';
  let h='<div class="panel"><div class="eyebrow">Vendor and parts</div>';
  if(canWork()&&!['done','cancelled'].includes(w.status)){
    h+='<label class="fl" style="margin-top:0">Sent to vendor</label><select onchange="woSet({vendor_id:this.value})"><option value="">Handled in-house</option>'+
      (META.vendors||[]).map(v=>'<option value="'+v.id+'"'+(v.id===w.vendor_id?' selected':'')+'>'+esc(v.name)+(v.trade?' · '+esc(v.trade):'')+'</option>').join('')+'</select>';
  }else if(w.vendor_name) h+='<div>Sent to <b>'+esc(w.vendor_name)+'</b></div>';
  if(w.vendor_phone&&canWork()) h+='<div style="margin-top:6px"><a href="tel:'+esc(w.vendor_phone.replace(/[^0-9+]/g,''))+'" style="color:var(--ice)">Call '+esc(w.vendor_name)+' · '+esc(w.vendor_phone)+'</a></div>';
  if((w.invoices||[]).length) h+='<div style="margin-top:8px">'+w.invoices.map(i=>'<div class="m" style="font-family:var(--mono);font-size:11px">Invoice '+esc(i.invoice_no||'#'+i.id)+' · '+esc(i.vendor)+' · '+money2(i.amount)+' · '+esc(i.status)+'</div>').join('')+'</div>';
  if((w.parts||[]).length) h+='<div style="margin-top:8px">'+w.parts.map(p=>'<div class="m" style="font-family:var(--mono);font-size:11px">'+qn(-p.qty)+' '+esc(p.uom)+' '+esc(p.name)+' · '+money2(-p.qty*p.unit_cost)+'</div>').join('')+'</div>';
  if(canWork()&&w.vendor_id) h+='<button class="btn-2 full" style="margin-top:10px" onclick="invoiceForm('+w.vendor_id+','+w.id+')">Enter their invoice</button>';
  return h+'</div>';
}

/* ================= DEMO ROLE SWITCHER ================= */
async function demoAs(role){
  try{
    const d=await (await fetch('/api/demo-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json();
    TOKEN=d.token; store.set('ciq_token',TOKEN); ME=d.user; UNIT=null; WOS=[]; PARTS=[]; VEND={vendors:[],contracts:[],stats:{},trades:[]}; TEAM={users:[],roles:[],departments:[]};
    ['dashBody','partsBody','vendorsBody','teamBody'].forEach(i=>{ if($(i)) $(i).innerHTML=''; });
    WOFILTER='open'; TAB=(ROLE_TABS[role]||['work'])[0]; enterApp(); toast('Viewing as '+(ROLE_NAME[role]||role));
  }catch(e){ alert(e.message); }
}
