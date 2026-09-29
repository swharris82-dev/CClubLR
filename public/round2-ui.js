/* Clubhouse IQ round 2: property map, capital plan, events, photos and
   sign-off, kitchen health logs, offline mode. Loaded before the main script;
   everything here runs from functions called after the main script loads. */

Object.assign(ROLE_TABS,{
  admin:['work','diagnose','record','history','map','kitchen','parts','vendors','capital','dash','reports','team'],
  manager:['work','diagnose','record','history','map','kitchen','parts','vendors','capital','dash','reports','team'],
  tech:['work','diagnose','record','history','map','kitchen','parts','vendors','capital','dash','reports'],
  viewer:['dash','map','work','kitchen','capital','vendors','reports'],
  staff:['work','kitchen']
});

/* ================= PROPERTY MAP ================= */
let MAP=null, MAPEDIT=false, MAPDRAG=null;
const ST_FILL={critical:['#FBE3E0','#B3362D'],warn:['#F6EBCB','#9A7B32'],busy:['#E3ECF6','#4F6F99'],ok:['#E2F1EA','#2E7D5B']};
async function loadMap(){
  const b=$('mapBody');
  if(!MAP) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading the grounds</span></div>';
  try{ MAP=await api('/map'); drawMap(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function mapSvg(){
  const L=MAP.layout, W=MAP.canvas.w, H=MAP.canvas.h;
  let s='<svg id="mapSvg" viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block;touch-action:'+(MAPEDIT?'none':'pan-y')+'" role="img" aria-label="Map of club buildings">'+
    '<defs><pattern id="mow" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="40" height="40" fill="#DDE9D2"/><rect width="20" height="40" fill="#D5E4C8"/></pattern></defs>'+
    '<rect width="'+W+'" height="'+H+'" fill="#E8EFDF"/>'+
    '<path d="M0 60 C 200 20, 420 140, 620 60 S 950 30, 1000 90 L1000 0 L0 0Z" fill="url(#mow)" opacity=".9"/>'+
    '<path d="M-20 1060 C 150 1000, 300 1120, 480 1070 S 820 980, 1020 1060 L1020 1320 L-20 1320Z" fill="url(#mow)" opacity=".9"/>'+
    '<ellipse cx="880" cy="1180" rx="95" ry="55" fill="#BFD7EA" stroke="#A3C2DB" stroke-width="3"/>'+
    '<circle cx="200" cy="1180" r="10" fill="#fff" stroke="#9FB38C" stroke-width="3"/><line x1="200" y1="1180" x2="200" y2="1130" stroke="#6B5320" stroke-width="3"/><path d="M200 1130 l24 8 -24 8z" fill="#B3362D"/>'+
    '<path d="M500 1300 L500 720 M500 720 L880 720 M500 430 L500 250 L900 250" stroke="#D9D2C0" stroke-width="26" fill="none" stroke-linecap="round"/>'+
    '<rect x="60" y="300" width="300" height="200" rx="10" fill="#E4E0D6" stroke="#D2CCBD"/>'+
    Array.from({length:6},(_,i)=>'<line x1="'+(90+i*48)+'" y1="310" x2="'+(90+i*48)+'" y2="370" stroke="#fff" stroke-width="3"/><line x1="'+(90+i*48)+'" y1="430" x2="'+(90+i*48)+'" y2="490" stroke="#fff" stroke-width="3"/>').join('')+
    '<text x="210" y="408" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="20" fill="#9A9383" letter-spacing="3">PARKING</text>'+
    '<text x="500" y="1290" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="18" fill="#9A9383" letter-spacing="3">COUNTRY CLUB BLVD</text>'+
    '<text x="170" y="1235" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="17" fill="#7E956B" letter-spacing="3">GOLF COURSE</text>';
  MAP.buildings.forEach(b=>{
    const r=L[b.name]; if(!r) return;
    const c=ST_FILL[b.status]||ST_FILL.ok;
    const words=b.name.split(' '), lines=[]; let cur='';
    words.forEach(w=>{ if((cur+' '+w).trim().length>(r.w/16)&&cur){ lines.push(cur); cur=w; } else cur=(cur+' '+w).trim(); }); if(cur) lines.push(cur);
    const fs=Math.max(20,Math.min(30,r.w/9));
    const ty=r.y+r.h/2-(lines.length-1)*fs*0.6+fs*0.35;
    s+='<g class="bld" data-b="'+esc(b.name)+'" style="cursor:'+(MAPEDIT?'move':'pointer')+'">'+
      '<rect x="'+r.x+'" y="'+r.y+'" width="'+r.w+'" height="'+r.h+'" rx="8" fill="'+c[0]+'" stroke="'+c[1]+'" stroke-width="'+(b.status==='critical'?5:3)+'"'+(MAPEDIT?' stroke-dasharray="10 6"':'')+'/>'+
      '<rect x="'+(r.x+6)+'" y="'+(r.y+6)+'" width="'+(r.w-12)+'" height="8" rx="3" fill="'+c[1]+'" opacity=".25"/>'+
      lines.map((l,i)=>'<text x="'+(r.x+r.w/2)+'" y="'+(ty+i*fs*1.15)+'" text-anchor="middle" font-family="Libre Caslon Text,Georgia,serif" font-weight="700" font-size="'+fs+'" fill="#1A2436" pointer-events="none">'+esc(l)+'</text>').join('')+
      (b.equipment?'<text x="'+(r.x+12)+'" y="'+(r.y+r.h-12)+'" font-family="IBM Plex Mono,monospace" font-size="17" fill="#4A5466" pointer-events="none">'+b.equipment+' eq</text>':'');
    if(b.open) s+='<circle cx="'+(r.x+r.w-4)+'" cy="'+(r.y+4)+'" r="24" fill="'+c[1]+'" stroke="#fff" stroke-width="4"/><text x="'+(r.x+r.w-4)+'" y="'+(r.y+12)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-weight="700" font-size="22" fill="#fff" pointer-events="none">'+b.open+'</text>';
    if(b.events&&b.events.length) s+='<g pointer-events="none"><rect x="'+(r.x+r.w-72)+'" y="'+(r.y+r.h-34)+'" width="62" height="24" rx="4" fill="#1F3A63"/><text x="'+(r.x+r.w-41)+'" y="'+(r.y+r.h-16)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="14" fill="#D8BE7C">EVENT</text></g>';
    if(MAPEDIT) s+='<rect class="rsz" data-b="'+esc(b.name)+'" x="'+(r.x+r.w-26)+'" y="'+(r.y+r.h-26)+'" width="26" height="26" fill="#1F3A63" style="cursor:nwse-resize"/>';
    s+='</g>';
  });
  return s+'</svg>';
}
function drawMap(){
  const n=MAP.buildings, em=n.filter(b=>b.status==='critical').length, wa=n.filter(b=>b.status==='warn').length;
  let h='<div class="panel" style="padding:10px"><div class="eyebrow" style="margin-bottom:6px">The grounds'+(MAPEDIT?' · arranging':'')+'</div>'+
    '<div class="legend" style="margin-bottom:8px;flex-wrap:wrap;display:flex;gap:12px;font-size:11px;font-family:var(--mono)">'+
    [['critical','Emergency'],['warn','Needs attention'],['busy','Open work'],['ok','All clear']].map(([k,l])=>'<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+ST_FILL[k][0]+';border:2px solid '+ST_FILL[k][1]+';margin-right:4px;vertical-align:-1px"></i>'+l+'</span>').join('')+'</div>'+
    '<div id="mapWrap" style="border-radius:4px;overflow:hidden;border:1px solid var(--edge)">'+mapSvg()+'</div>'+
    '<div class="dim" style="margin-top:6px;font-size:11px">'+(MAPEDIT?'Drag buildings into place. Drag the dark corner to resize.':'Tap a building to see its equipment and open work. Schematic, not to scale.')+'</div>';
  if(isMgr()) h+='<div class="acts" style="margin-top:10px">'+(MAPEDIT?'<button class="btn" onclick="saveMapLayout()">Save layout</button><button class="btn-2" onclick="MAPEDIT=false;loadMap()">Cancel</button><button class="btn-2" onclick="resetMapLayout()">Reset</button>':'<button class="btn-2" onclick="MAPEDIT=true;drawMap()">Arrange buildings</button>')+'</div>';
  h+='</div>';
  h+='<div class="panel"><div class="eyebrow">Buildings</div>'+n.slice().sort((a,b)=>({critical:0,warn:1,busy:2,ok:3}[a.status]-{critical:0,warn:1,busy:2,ok:3}[b.status])).map(b=>
    '<div class="att" onclick="buildingSheet(\''+esc(b.name).replace(/'/g,"\\'")+'\')"><span class="lv" style="background:'+ST_FILL[b.status][1]+'"></span><div style="flex:1;min-width:0"><div class="t">'+esc(b.name)+'</div>'+
    '<div class="m">'+[b.equipment+' equipment',b.open?b.open+' open':'',b.emergency?b.emergency+' emergency':'',b.pm_late?b.pm_late+' PM late':'',b.safety?b.safety+' safety':'',(b.events||[]).length?'event '+fmtDate(b.events[0].start_date):''].filter(Boolean).join(' · ')+'</div></div><span class="dim">›</span></div>').join('')+'</div>';
  $('mapBody').innerHTML=h;
  wireMap();
}
function svgPt(svg,e){ const p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function wireMap(){
  const svg=$('mapSvg'); if(!svg) return;
  svg.querySelectorAll('.bld').forEach(g=>{
    g.addEventListener('click',()=>{ if(!MAPEDIT&&!MAPDRAG) buildingSheet(g.dataset.b); });
  });
  if(!MAPEDIT) return;
  svg.addEventListener('pointerdown',e=>{
    const rs=e.target.closest('.rsz'), g=e.target.closest('.bld'); if(!g&&!rs) return;
    const name=(rs||g).dataset.b, r=MAP.layout[name], p=svgPt(svg,e);
    MAPDRAG={name,mode:rs?'size':'move',sx:p.x,sy:p.y,r0:Object.assign({},r)};
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove',e=>{
    if(!MAPDRAG) return; const p=svgPt(svg,e), d=MAPDRAG, r=MAP.layout[d.name];
    const dx=p.x-d.sx, dy=p.y-d.sy, snap=v=>Math.round(v/10)*10;
    if(d.mode==='move'){ r.x=snap(Math.max(0,Math.min(MAP.canvas.w-r.w,d.r0.x+dx))); r.y=snap(Math.max(0,Math.min(MAP.canvas.h-r.h,d.r0.y+dy))); }
    else { r.w=snap(Math.max(90,d.r0.w+dx)); r.h=snap(Math.max(70,d.r0.h+dy)); }
    $('mapWrap').innerHTML=mapSvg(); wireMap();
    const s2=$('mapSvg'); s2.setPointerCapture&&s2.setPointerCapture(e.pointerId);
  });
  const end=()=>{ setTimeout(()=>{ MAPDRAG=null; },50); };
  svg.addEventListener('pointerup',end); svg.addEventListener('pointercancel',end);
}
async function saveMapLayout(){ try{ const d=await api('/map/layout',{method:'PUT',body:{layout:MAP.layout}}); MAP.layout=d.layout; MAPEDIT=false; drawMap(); toast('Map saved'); }catch(e){ alert(e.message); } }
async function resetMapLayout(){ if(!confirm('Put every building back in its default spot?')) return; try{ await api('/map/layout',{method:'DELETE'}); MAPEDIT=false; loadMap(); }catch(e){ alert(e.message); } }
async function buildingSheet(name){
  let d; try{ d=await api('/map/building?name='+encodeURIComponent(name)); }catch(e){ return alert(e.message); }
  const st=MAP?MAP.buildings.find(b=>b.name===name):null;
  let h='';
  if(d.events.length) h+='<div class="panel"><div class="eyebrow">Coming up here</div>'+d.events.map(e=>'<div class="att" onclick="closeSheet();WORKVIEW=\'events\';showTab(\'work\')"><span class="lv" style="background:var(--ice)"></span><div style="flex:1"><div class="t">'+esc(e.title)+'</div><div class="m">'+esc(evWhen(e))+(e.no_work?' · no work':'')+'</div></div></div>').join('')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Open work · '+d.workorders.length+'</div>'+(d.workorders.length?d.workorders.map(w=>'<div class="att" onclick="closeSheet();openWo('+w.id+')"><span class="lv" style="background:'+(w.priority==='emergency'?'var(--rose)':w.priority==='high'?'var(--sulfur)':'var(--ice-dim)')+'"></span><div style="flex:1;min-width:0"><div class="t">#'+w.id+' '+esc(w.title)+'</div><div class="m">'+esc([w.apt,STAFF_LABEL[w.status]||w.status,w.due_date?'due '+fmtDate(w.due_date):''].filter(Boolean).join(' · '))+'</div></div></div>').join(''):'<div class="dim">Nothing open.</div>')+
    (canWork()?'<button class="btn-2 full" style="margin-top:10px" onclick="closeSheet();newWoForm();setTimeout(()=>{ if($(\'nwB\')) $(\'nwB\').value='+JSON.stringify(name).replace(/"/g,'&quot;')+'; },60)">+ Work order here</button>':'')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Equipment · '+d.units.length+'</div>'+(d.units.length?d.units.map(u=>{
      const bad=u.em||u.switch_present==='no'||u.switch_functioning==='no';
      return '<div class="att" onclick="'+(canWork()?'closeSheet();$(\'aptIn\').value=\''+esc(u.apt)+'\';showTab(\'record\');openUnit()':'')+'"><span class="lv" style="background:'+(bad?'var(--rose)':u.open_wo?'var(--sulfur)':'var(--mint)')+'"></span><div style="flex:1;min-width:0"><div class="t" style="font-family:var(--mono)">'+esc(u.apt)+'</div>'+
        '<div class="m">'+esc([u.system_type,u.manufacturer&&u.manufacturer!=='Other / Unknown'?u.manufacturer:'',u.open_wo?u.open_wo+' open':'',u.next_pm?'PM '+fmtDate(u.next_pm):''].filter(Boolean).join(' · '))+'</div></div></div>'; }).join(''):'<div class="dim">No equipment logged here yet.</div>')+'</div>';
  if(d.pms.length) h+='<div class="panel"><div class="eyebrow">PM in the next 30 days</div>'+d.pms.map(p=>'<div class="att"><div style="flex:1"><div class="t">'+esc(p.title)+'</div><div class="m">'+esc([p.apt,fmtDate(p.next_due)].filter(Boolean).join(' · '))+'</div></div></div>').join('')+'</div>';
  sheet(name,st?({critical:'Emergency open',warn:'Needs attention',busy:'Open work',ok:'All clear'})[st.status]:'Building',h);
}

/* ================= CAPITAL PLAN ================= */
let CAP=null, CAPF='all';
async function loadCapital(){
  const b=$('capitalBody');
  if(!CAP) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Running the numbers</span></div>';
  try{ CAP=await api('/capital'); drawCapital(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function capChart(){
  const ys=CAP.years, max=Math.max(1,...ys.map(y=>y.total)), W=360, H=170, bw=W/ys.length;
  let s='<svg viewBox="0 0 '+W+' '+(H+34)+'" width="100%" role="img" aria-label="Replacement budget by year">';
  [0.5,1].forEach(f=>{ const y=H-f*(H-16); s+='<line x1="0" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="var(--edge)" stroke-dasharray="3 4"/><text x="2" y="'+(y-3)+'" font-size="9" font-family="IBM Plex Mono,monospace" fill="var(--dim)">'+money(max*f/1000).replace('$','$')+'k</text>'; });
  ys.forEach((y,i)=>{
    const h=Math.round((H-16)*y.total/max), x=i*bw+bw*0.18, w=bw*0.64;
    s+='<g class="cb" data-i="'+i+'"><rect x="'+(i*bw)+'" y="0" width="'+bw+'" height="'+(H+30)+'" fill="transparent"/>'+
      (y.total?'<rect x="'+x+'" y="'+(H-h)+'" width="'+w+'" height="'+h+'" rx="2" fill="'+(i===0&&CAP.totals.overdue?'var(--rose)':'var(--ice)')+'" opacity="'+(i<5?1:.55)+'"/>':'')+
      '<text x="'+(i*bw+bw/2)+'" y="'+(H+14)+'" text-anchor="middle" font-size="9.5" font-family="IBM Plex Mono,monospace" fill="var(--mid)">\''+String(y.year).slice(2)+'</text>'+
      (y.count?'<text x="'+(i*bw+bw/2)+'" y="'+(H+27)+'" text-anchor="middle" font-size="8.5" font-family="IBM Plex Mono,monospace" fill="var(--dim)">'+y.count+'</text>':'')+'</g>';
  });
  return s+'</svg>';
}
function drawCapital(){
  const c=CAP, t=c.totals;
  let h='<div class="kpis" style="margin-bottom:12px">'+kpi(money(t.five),'Next 5 years','Replacement budget','')+kpi(money(t.ten),'Next 10 years','',"")+
    kpi(t.overdue,'Past expected life',t.overdue?money(t.overdue_cost)+' to replace':'',t.overdue?'bad':'good',"CAPF='due';drawCapital()")+
    kpi(money(t.replacement_value),'Replacement value','All equipment on file','')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Budget by year · '+c.inflation+'% inflation</div>'+capChart()+
    '<div class="dim" id="capTip" style="min-height:18px;font-size:12px;margin-top:4px">Tap a year to see what is in it. First year includes anything already past its life.</div>'+
    '<div class="acts" style="margin-top:10px"><button class="btn" onclick="capReport()">Budget report for Bruce</button>'+(isMgr()?'<button class="btn-2" onclick="capInflation()">Inflation '+c.inflation+'%</button>':'')+'</div></div>';
  const f={all:c.items,due:c.items.filter(i=>i.overdue||(i.remaining!=null&&i.remaining<=3)),flag:c.items.filter(i=>i.flags.some(x=>/Repairs|service calls/.test(x))),unknown:c.items.filter(i=>!i.install_year)};
  h+='<div class="filters" id="capF">'+[['all','All',f.all.length],['due','Due within 3 yrs',f.due.length],['flag','Repair or replace',f.flag.length],['unknown','Missing install year',f.unknown.length]]
    .map(([k,l,n])=>'<div data-f="'+k+'" class="'+(CAPF===k?'on':'')+'">'+l+(n?'<b>'+n+'</b>':'')+'</div>').join('')+'</div>';
  h+=(f[CAPF]||[]).map(i=>{
    const pct=i.pct_life==null?0:Math.min(100,i.pct_life), col=i.overdue?'var(--rose)':pct>=80?'var(--sulfur)':'var(--mint)';
    return '<div class="prow" onclick="capSheet('+i.id+')"><div style="flex:1;min-width:0"><div class="t"><span style="font-family:var(--mono)">'+esc(i.apt)+'</span> <span class="mid" style="font-weight:400;font-size:13px">'+esc(i.system_type)+'</span></div>'+
      '<div class="m">'+esc([i.building,i.install_year?'installed '+i.install_year:'install year unknown',i.age!=null?i.age+' of '+i.life+' yrs':''].filter(Boolean).join(' · '))+'</div>'+
      '<div class="sbar"><i style="width:'+Math.max(3,pct)+'%;background:'+col+'"></i></div>'+
      (i.flags.filter(x=>!/estimate|unknown/.test(x)).length?'<div class="m" style="color:var(--sulfur);margin-top:4px">'+esc(i.flags.filter(x=>!/estimate|unknown/.test(x)).join(' · '))+'</div>':'')+'</div>'+
      '<div class="qty" style="min-width:74px"><b style="font-size:18px;color:'+col+'">'+(i.plan_year||'?')+'</b><span>'+money(i.future_cost)+(i.cost_set?'':' est')+'</span></div></div>';
  }).join('');
  $('capitalBody').innerHTML=h;
  $('capF').querySelectorAll('div').forEach(d=>d.onclick=()=>{ CAPF=d.dataset.f; drawCapital(); });
  document.querySelectorAll('#capitalBody .cb').forEach(g=>g.addEventListener('click',()=>{
    const y=CAP.years[+g.dataset.i]; $('capTip').innerHTML='<b>'+y.year+'</b> · '+money(y.total)+(y.items.length?' · '+esc(y.items.join(', ')):' · nothing scheduled');
  }));
}
function capSheet(id){
  const i=CAP.items.find(x=>x.id===id); if(!i) return;
  const ro=!canWork();
  let h='<div class="panel"><div class="kv">'+
    '<div class="k">Building</div><div>'+esc(i.building||'')+'</div>'+
    '<div class="k">Age</div><div>'+(i.age!=null?i.age+' years ('+i.pct_life+'% of life)':'Unknown')+'</div>'+
    '<div class="k">Replace</div><div><b>'+(i.plan_year||'Not scheduled')+'</b>'+(i.overdue?' <span style="color:var(--rose)">(was due '+i.due_year+')</span>':'')+'</div>'+
    '<div class="k">Budget</div><div>'+money(i.future_cost)+(i.cost_set?'':' (typical cost, no quote yet)')+'</div>'+
    '<div class="k">Repairs, 3 yrs</div><div>'+money(i.repair_3y)+' vendor + parts · '+i.jobs_12+' service calls in 12 months</div></div>'+
    (i.flags.length?'<div class="note n-warr" style="margin-top:10px"><b>Notes</b>'+esc(i.flags.join('. '))+'.</div>':'')+'</div>';
  h+='<div class="panel"><div class="eyebrow">Planning numbers</div>'+
    row2(F('Year installed',inp('cpI',i.install_known?i.install_year:(i.install_year||''),'From data plate','number')),F('Expected life (yrs)',inp('cpL',i.life,String(i.life_default),'number')))+
    row2(F('Replacement cost today',inp('cpC',i.cost_set?i.cost:'','$'+i.cost_default,'number')),F('Condition',sel('cpK',[[5,'5 · Excellent'],[4,'4 · Good'],[3,'3 · Fair'],[2,'2 · Poor'],[1,'1 · Failing']],i.condition)))+
    F('Plan to replace in (optional override)',inp('cpY',i.override_year||'','Leave blank to calculate','number'))+
    '<div class="dim" style="margin-top:6px">Condition moves the date: poor pulls it 2 years earlier, failing 4; good adds a year, excellent 3.</div>'+
    (ro?'':'<button class="btn full" style="margin-top:12px" onclick="saveCap('+i.id+')">Save</button>')+errBox('cpMsg')+
    (canWork()?'<button class="btn-2 full" style="margin-top:8px" onclick="closeSheet();$(\'aptIn\').value=\''+esc(i.apt)+'\';showTab(\'record\');openUnit()">Open equipment record</button>':'')+'</div>';
  sheet(i.apt,i.system_type,h);
}
async function saveCap(id){
  try{ CAP=await api('/capital/'+id,{method:'PUT',body:{install_year:val('cpI'),expected_life:val('cpL'),replace_cost:val('cpC')===''?null:val('cpC'),condition:val('cpK'),replace_year:val('cpY')}});
    toast('Saved'); closeSheet(); drawCapital(); }
  catch(e){ showErr('cpMsg',e); }
}
async function capInflation(){
  const v=prompt('Yearly cost increase to plan for (percent):',CAP.inflation); if(v===null) return;
  try{ CAP=await api('/capital-settings',{method:'PUT',body:{inflation:v}}); drawCapital(); }catch(e){ alert(e.message); }
}
async function capReport(){ openHtml('/capital/report'); }
async function openHtml(path){
  const w=window.open('','_blank');
  if(w) w.document.write('<p style="font-family:sans-serif;padding:20px">Building report…</p>');
  try{ const d=await api(path); if(w){ w.document.open(); w.document.write(d.html); w.document.close(); }
    else sheet('Report','','<iframe style="width:100%;height:75vh;border:1px solid var(--edge);background:#fff" srcdoc="'+esc(d.html)+'"></iframe>'); }
  catch(e){ if(w) w.close(); alert(e.message); }
}

/* ================= EVENTS ================= */
let EVENTS=null, BLACKOUTS=[];
function evWhen(e){ return fmtDate(e.start_date)+(e.end_date&&e.end_date!==e.start_date?' to '+fmtDate(e.end_date):'')+(e.start_time?' · '+e.start_time+(e.end_time?'–'+e.end_time:''):''); }
async function loadBlackouts(){ try{ BLACKOUTS=(await api('/events/blackouts')).events; }catch(e){ BLACKOUTS=[]; } }
function eventOn(date,building){
  if(!date) return null;
  return BLACKOUTS.find(e=>date>=e.start_date&&date<=e.end_date&&(!e.buildings||!building||e.buildings.toLowerCase().split(',').map(s=>s.trim()).includes(String(building).toLowerCase())))||null;
}
function evTag(date,building){ const e=eventOn(date,building); return e?'<span class="tag evt" title="'+esc(e.title)+'">during '+esc(e.title.length>22?e.title.slice(0,21)+'…':e.title)+'</span>':''; }
async function loadEvents(){
  syncWorkNav();
  const pane=$('evPane');
  if(!EVENTS) pane.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading events</span></div>';
  try{ EVENTS=await api('/events?days=120'); drawEvents(); loadBlackouts(); }
  catch(e){ pane.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function drawEvents(){
  const ev=EVENTS.events, conf=ev.filter(e=>e.conflicts.length);
  let h='<div class="panel"><div class="stats"><div class="stat"><div class="n">'+ev.length+'</div><div class="l">events, 120 days</div></div>'+
    '<div class="stat"><div class="n" style="color:'+(conf.length?'var(--rose)':'var(--text)')+'">'+conf.length+'</div><div class="l">with conflicts</div></div>'+
    '<div class="stat"><div class="n">'+ev.filter(e=>e.days_out<=14).length+'</div><div class="l">next 2 weeks</div></div></div>'+
    '<div class="mid" style="margin-top:10px;font-size:13px">PM, repairs, vendor visits, and kitchen service that land on an event day in the same building get flagged here and on the work order.</div>'+
    (canWork()?'<button class="btn full" style="margin-top:10px" onclick="eventForm()">+ Add event</button>':'')+
    (isMgr()?'<button class="btn-2 full" style="margin-top:8px" onclick="icsForm()">'+(EVENTS.ics?'Club calendar linked · change':'Link the club events calendar')+'</button>':'')+'</div>';
  if(!ev.length) h+='<div class="empty"><div class="big">No events on file</div>Add tournaments, weddings, and member events, or link the club calendar.</div>';
  let lastMonth='';
  ev.forEach(e=>{
    const m=e.start_date.slice(0,7);
    if(m!==lastMonth){ lastMonth=m; h+='<div class="bldg" style="margin:14px 0 8px">'+MON[+m.slice(5)-1]+' '+m.slice(0,4)+'</div>'; }
    h+='<div class="woc" style="border-left-color:'+(e.conflicts.length?'var(--rose)':e.no_work?'var(--ice)':'var(--edge-lit)')+'" onclick="eventSheet('+e.id+')">'+
      '<div class="t">'+esc(e.title)+'</div><div class="m">'+esc(evWhen(e))+(e.guests?' · '+e.guests+' guests':'')+'</div>'+
      '<div class="r"><span class="tag">'+esc(e.kind)+'</span><span class="tag">'+esc(e.buildings||'Whole club')+'</span>'+(e.no_work?'':'<span class="tag">work OK</span>')+
      (e.conflicts.length?'<span class="tag late">'+e.conflicts.length+' conflict'+(e.conflicts.length>1?'s':'')+'</span>':'')+(e.source==='calendar'?'<span class="tag">from calendar</span>':'')+'</div></div>';
  });
  $('evPane').innerHTML=h;
}
function eventSheet(id){
  const e=EVENTS.events.find(x=>x.id===id); if(!e) return;
  const icon={pm:'PM',wo:'WO',vendor:'Vendor',kitchen:'Kitchen'};
  let h='<div class="panel"><div class="kv"><div class="k">When</div><div>'+esc(evWhen(e))+'</div><div class="k">Where</div><div>'+esc(e.buildings||'Whole club')+'</div>'+
    (e.guests?'<div class="k">Guests</div><div>'+e.guests+'</div>':'')+'<div class="k">Work</div><div>'+(e.no_work?'Keep maintenance out of these areas':'Maintenance OK')+'</div>'+
    (e.notes?'<div class="k">Notes</div><div style="white-space:pre-wrap">'+esc(e.notes)+'</div>':'')+'</div></div>';
  h+='<div class="panel"><div class="eyebrow">Scheduled during this event · '+e.conflicts.length+'</div>'+(e.conflicts.length?e.conflicts.map(c=>
    '<div class="att" onclick="'+(c.type==='wo'?'closeSheet();openWo('+c.id+')':c.type==='pm'?'closeSheet();WORKVIEW=\'pm\';showTab(\'work\')':c.type==='kitchen'?'closeSheet();showTab(\'kitchen\')':'closeSheet();showTab(\'vendors\')')+'">'+
    '<span class="tag" style="flex-shrink:0">'+icon[c.type]+'</span><div style="flex:1;min-width:0"><div class="t">'+esc(c.title)+'</div><div class="m">'+esc([fmtDate(c.date),c.apt,c.building].filter(Boolean).join(' · '))+'</div></div></div>').join('')+
    '<div class="dim" style="margin-top:8px">Do these before '+esc(fmtDate(e.start_date))+' or push them past '+esc(fmtDate(e.end_date))+'.</div>'
    :'<div class="dim">Nothing scheduled in these areas. Clear.</div>')+'</div>';
  if(canWork()) h+='<div class="acts" style="margin-bottom:12px"><button class="btn-2" onclick="eventForm('+id+')">Edit</button><button class="btn-2" style="color:var(--rose)" onclick="delEvent('+id+')">Delete</button></div>';
  sheet(e.title,e.kind,h);
}
function eventForm(id){
  const e=id?EVENTS.events.find(x=>x.id===id):{kind:'Member event',no_work:1,start_date:today()};
  const sel0=(e.buildings||'').split(',').map(s=>s.trim()).filter(Boolean);
  let h='<div class="panel">'+F('Event',inp('efT',e.title,'Member-Guest Invitational'))+F('Type',sel('efK',EVENTS.kinds,e.kind))+
    row2(F('Starts',inp('efS',e.start_date,'','date')),F('Ends',inp('efE',e.end_date||e.start_date,'','date')))+
    row2(F('From',inp('efST',e.start_time,'','time')),F('To',inp('efET',e.end_time,'','time')))+
    F('Where (none checked = whole club)','<div class="bchk">'+EVENTS.buildings.map(b=>'<label class="ck-row"><input type="checkbox" data-b="'+esc(b)+'"'+(sel0.includes(b)?' checked':'')+'><span>'+esc(b)+'</span></label>').join('')+'</div>')+
    F('Expected guests',inp('efG',e.guests||'','','number'))+
    '<label class="ck-row" style="margin-top:10px"><input type="checkbox" id="efN"'+(e.no_work?' checked':'')+'><span>Keep maintenance work out of these areas</span></label>'+
    F('Notes',inp('efNo',e.notes,'Tent on the lawn Friday, extra ice needed'))+
    '<button class="btn full" style="margin-top:14px" onclick="saveEvent('+(id||0)+')">'+(id?'Save':'Add event')+'</button>'+errBox('efMsg')+'</div>';
  sheet(id?'Edit event':'New event','Events',h);
}
async function saveEvent(id){
  const bl=[...document.querySelectorAll('.bchk input:checked')].map(x=>x.dataset.b);
  const body={title:val('efT'),kind:val('efK'),start_date:val('efS'),end_date:val('efE'),start_time:val('efST'),end_time:val('efET'),buildings:bl,guests:val('efG'),no_work:$('efN').checked,notes:val('efNo')};
  try{ const d=await api(id?'/events/'+id:'/events',{method:id?'PUT':'POST',body}); toast(d.event.conflicts.length?d.event.conflicts.length+' conflict'+(d.event.conflicts.length>1?'s':'')+' found':'Saved, no conflicts');
    closeSheet(); EVENTS=null; loadEvents(); refreshAlerts(); }
  catch(e){ showErr('efMsg',e); }
}
async function delEvent(id){ if(!confirm('Delete this event?')) return; await api('/events/'+id,{method:'DELETE'}); closeSheet(); EVENTS=null; loadEvents(); }
function icsForm(){
  sheet('Club events calendar','Events','<div class="panel"><div class="mid" style="font-size:13px;margin-bottom:8px">Paste the calendar feed link (ends in .ics) from the club\'s Google Calendar, Outlook, or club management software. Events import automatically and refresh every 6 hours. Tournaments and weddings are recognized by name, and buildings are matched from the event location.</div>'+
    F('Calendar link',inp('icsU',EVENTS.ics,'https://calendar.google.com/calendar/ical/…/basic.ics','url'))+
    '<div class="dim" style="margin-top:6px">In Google Calendar: Settings, the calendar, Integrate calendar, Secret address in iCal format.</div>'+
    '<button class="btn full" style="margin-top:12px" onclick="saveIcs()">Save and import</button>'+(EVENTS.ics?'<button class="btn-2 full" style="margin-top:8px" onclick="$(\'icsU\').value=\'\';saveIcs()">Unlink</button>':'')+errBox('icsMsg')+'</div>');
}
async function saveIcs(){
  try{ const d=await api('/events-feed',{method:'PUT',body:{url:val('icsU')}}); toast(val('icsU')?'Imported '+d.count+' events':'Calendar unlinked'); closeSheet(); EVENTS=null; loadEvents(); }
  catch(e){ showErr('icsMsg',e); }
}

/* ================= PHOTOS AND SIGN-OFF ================= */
async function woPhotosBlock(){
  const box=$('woPhotos'); if(!box||!WO) return;
  let ph=[]; try{ ph=(await api('/workorders/'+WO.id+'/photos')).photos; }catch(e){}
  const add=canWork()?'<div class="acts" style="margin-top:8px"><button class="btn-2" onclick="pickWoPhoto(\'before\')">+ Before photo</button><button class="btn-2" onclick="pickWoPhoto(\'after\')">+ After photo</button></div>':'';
  if(!ph.length&&!add){ box.innerHTML=''; return; }
  const col=k=>{ const l=ph.filter(p=>p.kind===k); return '<div style="flex:1;min-width:0"><div style="font-family:var(--mono);font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim);margin:0 0 5px">'+(k==='before'?'Before':k==='after'?'After':'Other')+'</div>'+
    (l.length?l.map(p=>'<img class="wph" data-id="'+p.id+'" alt="'+k+' photo" onclick="viewPhoto('+p.id+')">').join(''):'<div class="wph empty">none</div>')+'</div>'; };
  box.innerHTML='<div class="panel"><div class="eyebrow">Photos</div><div style="display:flex;gap:10px">'+col('before')+col('after')+'</div>'+
    (ph.some(p=>p.kind==='other')?'<div style="margin-top:8px">'+col('other')+'</div>':'')+add+'</div>';
  box.querySelectorAll('img.wph').forEach(async img=>{ try{ const r=await fetch('/api/wo-photo/'+img.dataset.id,{headers:{Authorization:'Bearer '+TOKEN}}); if(r.ok) img.src=URL.createObjectURL(await r.blob()); }catch(e){} });
}
function pickWoPhoto(kind){
  const i=document.createElement('input'); i.type='file'; i.accept='image/*'; i.setAttribute('capture','environment');
  i.onchange=async()=>{ const f=i.files&&i.files[0]; if(!f) return;
    try{ const d=await shrinkImage(f,1400,.72); await api('/workorders/'+WO.id+'/photos',{method:'POST',body:{kind,data:String(d).split(',').pop()}}); toast((kind==='before'?'Before':'After')+' photo saved'); woPhotosBlock(); }
    catch(e){ alert(e.message); } };
  i.click();
}
function viewPhoto(id){
  const img=document.querySelector('img.wph[data-id="'+id+'"]'); if(!img||!img.src) return;
  const v=document.createElement('div'); v.className='photo-view'; v.innerHTML='<img src="'+img.src+'"><button onclick="this.parentNode.remove()">✕</button>'+
    (canWork()?'<button class="del" onclick="delPhoto('+id+',this)">Delete</button>':''); v.onclick=e=>{ if(e.target===v) v.remove(); }; document.body.appendChild(v);
}
async function delPhoto(id,btn){ if(!confirm('Delete this photo?')) return; await api('/wo-photo/'+id,{method:'DELETE'}); btn.parentNode.remove(); woPhotosBlock(); }

let SIG=null;
function signaturePad(){
  const box=$('cmSig'); if(!box) return;
  box.innerHTML='<label class="fl">Sign-off (optional)</label><input id="cmSB" placeholder="Name of the person accepting the work, like the chef or department head">'+
    '<div class="sigwrap"><canvas id="sigC" width="600" height="200"></canvas><span class="rm" onclick="clearSig()">clear</span><div class="sigln">Sign here</div></div>';
  const c=$('sigC'), x=c.getContext('2d'); SIG={c,x,drawn:false};
  x.lineWidth=3; x.lineCap='round'; x.lineJoin='round'; x.strokeStyle='#1A2436';
  let down=false;
  const pt=e=>{ const r=c.getBoundingClientRect(); return [(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]; };
  c.addEventListener('pointerdown',e=>{ down=true; c.setPointerCapture(e.pointerId); const [a,b]=pt(e); x.beginPath(); x.moveTo(a,b); e.preventDefault(); });
  c.addEventListener('pointermove',e=>{ if(!down) return; const [a,b]=pt(e); x.lineTo(a,b); x.stroke(); SIG.drawn=true; });
  c.addEventListener('pointerup',()=>down=false); c.addEventListener('pointercancel',()=>down=false);
}
function clearSig(){ if(SIG){ SIG.x.clearRect(0,0,SIG.c.width,SIG.c.height); SIG.drawn=false; } }
function sigPayload(){ const o={signed_by:val('cmSB')}; if(SIG&&SIG.drawn) o.signature=SIG.c.toDataURL('image/png').split(',').pop(); return o; }
function sigBlock(w){
  if(!w.has_signature&&!w.signed_by) return '';
  return '<div style="margin-top:10px;border-top:1px solid var(--edge);padding-top:10px"><div style="font-family:var(--mono);font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim);margin:0 0 5px">Signed off'+(w.signed_by?' by '+esc(w.signed_by):'')+'</div>'+
    (w.has_signature?'<img id="woSigImg" alt="Signature" style="max-width:260px;width:100%;background:#fff;border:1px solid var(--edge);border-radius:3px">':'')+'</div>';
}
async function loadSig(){ const el=$('woSigImg'); if(!el) return; try{ const r=await fetch('/api/workorders/'+WO.id+'/signature',{headers:{Authorization:'Bearer '+TOKEN}}); if(r.ok) el.src=URL.createObjectURL(await r.blob()); }catch(e){} }

/* ================= KITCHEN ================= */
let KIT=null;
async function loadKitchen(){
  const b=$('kitchenBody');
  if(!KIT) b.innerHTML='<div class="panel"><span class="spin"></span><span class="dim">Loading kitchen logs</span></div>';
  try{ KIT=await api('/kitchen'); drawKitchen(); }
  catch(e){ b.innerHTML='<div class="panel"><div class="note n-safe"><b>Failed</b>'+esc(e.message)+'</div></div>'; }
}
function ring(pct){
  const r=34, c=2*Math.PI*r, col=pct>=90?'var(--mint)':pct>=75?'var(--sulfur)':'var(--rose)';
  return '<svg viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="'+r+'" fill="none" stroke="var(--raised)" stroke-width="8"/>'+
    '<circle cx="42" cy="42" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+(c*pct/100)+' '+c+'" transform="rotate(-90 42 42)"/>'+
    '<text x="42" y="49" text-anchor="middle" font-family="Libre Caslon Text,Georgia,serif" font-weight="700" font-size="21" fill="'+col+'">'+pct+'</text></svg>';
}
function drawKitchen(){
  const k=KIT, staff=isStaff(), wr=canWork()||staff;
  let h='';
  if(!staff) h+='<div class="panel" style="display:flex;gap:14px;align-items:center">'+ring(k.score)+'<div style="flex:1"><div class="eyebrow" style="margin-bottom:4px">Inspection ready</div>'+
    '<div class="mid" style="font-size:13px">Service items current: <b>'+k.item_pct+'%</b><br>Temperature checks logged, 7 days: <b>'+k.temp_pct+'%</b>'+(k.out_of_range_7?'<br><span style="color:var(--rose)">'+k.out_of_range_7+' out-of-range reading'+(k.out_of_range_7>1?'s':'')+' this week</span>':'')+'</div></div></div>';
  h+='<div class="panel"><div class="eyebrow">Temperature log'+(k.due_now?' · '+k.due_now+' due now':'')+'</div>';
  h+=k.points.map(p=>{
    const last=p.last, lim=p.kind==='hot'?'min '+p.min_f+'°':'max '+p.max_f+'°';
    const chk=p.checks>=2?('<span class="tag'+(p.am?' s-done':'')+'">AM '+(p.am?'✓':'')+'</span><span class="tag'+(p.pm?' s-done':'')+'">PM '+(p.pm?'✓':'')+'</span>'):'<span class="tag'+(p.today.length?' s-done':'')+'">today '+(p.today.length?'✓':'')+'</span>';
    return '<div class="tpt'+(p.due_now?' due':'')+'"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="min-width:0"><div class="t">'+esc(p.name)+'</div>'+
      '<div class="m">'+esc([p.location,p.apt,lim].filter(Boolean).join(' · '))+'</div></div><div style="display:flex;gap:4px;flex-shrink:0">'+chk+'</div></div>'+
      '<div class="wk">'+p.week.map(d=>'<span title="'+esc(d.date)+'" class="'+(d.bad?'bad':d.n>=p.checks?'ok':d.n?'part':'none')+'">'+(d.n?(p.kind==='hot'?d.min:d.max):'')+'</span>').join('')+'</div>'+
      (last?'<div class="m" style="margin-top:4px">Last '+last.reading+'°F by '+esc(last.by)+' · '+esc(ago(last.at))+(last.ok?'':' <b style="color:var(--rose)">OUT OF RANGE</b>')+'</div>':'')+
      (wr&&ME.role!=='viewer'?'<div class="row" style="margin-top:8px"><input type="number" inputmode="decimal" step="0.1" id="tp'+p.id+'" placeholder="°F" style="font-family:var(--mono);font-size:20px;font-weight:600;max-width:120px">'+
        '<button class="btn" style="flex:1" onclick="logTemp('+p.id+')">Log reading</button></div>':'')+
      (canWork()?'<span class="rm" style="font-size:11px" onclick="pointForm('+p.id+')">edit</span>':'')+'</div>';
  }).join('');
  if(canWork()) h+='<button class="btn-2 full" style="margin-top:8px" onclick="pointForm()">+ Add a cooler, freezer, or hot-hold</button>';
  h+='<div class="dim" style="margin-top:8px;font-size:12px">Coolers 41°F or below, freezers 0°F or below. An out-of-range reading opens a maintenance work order automatically.</div></div>';
  if(!staff){
    h+='<div class="panel"><div class="eyebrow">Scheduled kitchen service</div>'+k.items.map(i=>{
      const col={late:'var(--rose)',never:'var(--rose)',soon:'var(--sulfur)',ok:'var(--mint)'}[i.state];
      return '<div class="att" onclick="itemSheet('+i.id+')"><span class="lv" style="background:'+col+'"></span><div style="flex:1;min-width:0"><div class="t">'+esc(i.title)+'</div>'+
        '<div class="m">'+(i.last_done?'Last '+esc(fmtDate(i.last_done))+' · ':'No record · ')+(i.days==null?'':i.days<0?'<span style="color:var(--rose)">'+(-i.days)+' days overdue</span>':'due in '+i.days+' days')+' · every '+esc(freqLabel(i.freq_days))+(i.vendor_name?' · '+esc(i.vendor_name):'')+'</div></div>'+
        (canWork()?'<button class="btn-2" style="padding:6px 10px;font-size:12px" onclick="event.stopPropagation();doneForm('+i.id+')">Done</button>':'')+'</div>';
    }).join('')+(canWork()?'<button class="btn-2 full" style="margin-top:10px" onclick="itemForm()">+ Add an item</button>':'')+'</div>';
    h+='<div class="panel"><div class="eyebrow">Inspector binder</div><div class="mid" style="font-size:13px">Temperature logs by day and shift, every service date with who did it, and corrective actions. Print it or keep it on the phone for the inspector.</div>'+
      '<div class="acts" style="margin-top:10px"><button class="btn" onclick="openHtml(\'/kitchen/binder?days=30\')">Last 30 days</button><button class="btn-2" onclick="openHtml(\'/kitchen/binder?days=90\')">Last 90 days</button></div></div>';
  }
  $('kitchenBody').innerHTML=h;
}
async function logTemp(id){
  const p=KIT.points.find(x=>x.id===id), v=parseFloat($('tp'+id).value);
  if(!isFinite(v)) return toast('Enter the temperature');
  const bad=(p.max_f!=null&&v>p.max_f)||(p.min_f!=null&&v<p.min_f);
  let action='';
  if(bad){ action=prompt(v+'°F is out of range for '+p.name+'. What did you do? (moved product, checked door, called maintenance)'); if(action===null) return; }
  try{ const d=await api('/kitchen/temps',{method:'POST',body:{point_id:id,reading:v,action}}); KIT=d.state; drawKitchen();
    toast(d.ok?'Logged '+v+'°F':'Logged. Maintenance work order #'+d.wo_id+' opened'); if(!d.ok) refreshAlerts(); }
  catch(e){ alert(e.message); }
}
function pointForm(id){
  const p=id?KIT.points.find(x=>x.id===id):{kind:'cooler',checks:2,max_f:41};
  sheet(id?p.name:'New temperature point','Kitchen','<div class="panel">'+F('Name',inp('ptN',p.name,'Reach-in cooler, salad station'))+
    row2(F('Type',sel('ptK',[['cooler','Cooler'],['freezer','Freezer'],['hot','Hot holding / dish rinse']],p.kind)),F('Checks per day',sel('ptC',[1,2,3,4],p.checks)))+
    row2(F('Max °F (cold)',inp('ptMax',p.max_f!=null?p.max_f:'','41','number')),F('Min °F (hot)',inp('ptMin',p.min_f!=null?p.min_f:'','135','number')))+
    row2(F('Location',inp('ptL',p.location,'Cook line')),F('Equipment tag',inp('ptA',p.apt,'Optional','text',' list="tagList" style="font-family:var(--mono);text-transform:uppercase"')))+tagList()+
    '<button class="btn full" style="margin-top:12px" onclick="savePoint('+(id||0)+')">Save</button>'+(id?'<button class="btn-2 full" style="margin-top:8px;color:var(--rose)" onclick="delPoint('+id+')">Remove</button>':'')+errBox('ptMsg')+'</div>');
}
async function savePoint(id){
  try{ KIT=await api('/kitchen/points',{method:'POST',body:{id:id||undefined,name:val('ptN'),kind:val('ptK'),checks:val('ptC'),max_f:val('ptMax'),min_f:val('ptMin'),location:val('ptL'),apt:val('ptA')}}); closeSheet(); drawKitchen(); }
  catch(e){ showErr('ptMsg',e); }
}
async function delPoint(id){ if(!confirm('Stop logging this one? History stays.')) return; KIT=await api('/kitchen/points/'+id,{method:'DELETE'}); closeSheet(); drawKitchen(); }
async function itemSheet(id){
  const i=KIT.items.find(x=>x.id===id); if(!i) return;
  let log=[]; try{ log=(await api('/kitchen/item/'+id+'/log')).log; }catch(e){}
  let h='<div class="panel">'+(i.why?'<div class="mid" style="font-size:13px;margin-bottom:10px">'+esc(i.why)+'</div>':'')+'<div class="kv"><div class="k">Every</div><div>'+esc(freqLabel(i.freq_days))+'</div>'+
    '<div class="k">Last done</div><div>'+esc(i.last_done||'No record')+'</div><div class="k">Next due</div><div style="color:'+(i.days!=null&&i.days<0?'var(--rose)':'inherit')+'">'+esc(i.next_due||'')+'</div>'+
    (i.vendor_name?'<div class="k">Vendor</div><div>'+esc(i.vendor_name)+(i.vendor_phone?' · <a href="tel:'+esc(i.vendor_phone.replace(/[^0-9+]/g,''))+'" style="color:var(--ice)">'+esc(i.vendor_phone)+'</a>':'')+'</div>':'')+'</div>'+
    (canWork()?'<div class="acts" style="margin-top:12px"><button class="btn btn-good" onclick="doneForm('+id+')">Mark done</button><button class="btn-2" onclick="itemForm('+id+')">Edit</button></div>':'')+'</div>';
  h+='<div class="panel"><div class="eyebrow">History</div>'+(log.length?'<table>'+log.map(l=>'<tr><td style="white-space:nowrap"><b>'+esc(l.done_on)+'</b></td><td>'+esc([l.vendor,l.note].filter(Boolean).join(' · ')||'Done')+'<br><span class="dim" style="font-size:11px">'+esc(l.by)+'</span></td></tr>').join('')+'</table>':'<div class="dim">No record yet.</div>')+'</div>';
  sheet(i.title,'Kitchen service',h);
}
function doneForm(id){
  const i=KIT.items.find(x=>x.id===id);
  sheet(i.title,'Mark done','<div class="panel">'+row2(F('Date done',inp('dfD',today(),'','date')),F('Done by (vendor)',inp('dfV',i.vendor_name||'','In-house')))+
    F('Note',inp('dfN','','Certificate on file, tag updated, manifest #'))+'<button class="btn btn-good full" style="margin-top:12px" onclick="saveDone('+id+')">Save</button>'+errBox('dfMsg')+'</div>');
}
async function saveDone(id){ try{ KIT=await api('/kitchen/items/'+id+'/done',{method:'POST',body:{done_on:val('dfD'),vendor:val('dfV'),note:val('dfN')}}); toast('Recorded'); closeSheet(); drawKitchen(); refreshAlerts(); }catch(e){ showErr('dfMsg',e); } }
function itemForm(id){
  const i=id?KIT.items.find(x=>x.id===id):{freq_days:90};
  sheet(id?'Edit item':'New item','Kitchen service','<div class="panel">'+F('Item',inp('ifT2',i.title,'Walk-in evaporator coil cleaning'))+
    row2(F('Every (days)',inp('ifF',i.freq_days,'90','number')),F('Vendor',sel('ifVn',[['','In-house']].concat((META.vendors||[]).map(v=>[v.id,v.name])),i.vendor_id||'')))+
    F('Why it matters',inp('ifWh',i.why,'What the inspector looks for'))+
    '<button class="btn full" style="margin-top:12px" onclick="saveItem('+(id||0)+')">Save</button>'+(id?'<button class="btn-2 full" style="margin-top:8px;color:var(--rose)" onclick="delItem('+id+')">Remove</button>':'')+errBox('ifMsg2')+'</div>');
}
async function saveItem(id){ try{ KIT=await api('/kitchen/items',{method:'POST',body:{id:id||undefined,title:val('ifT2'),freq_days:val('ifF'),vendor_id:val('ifVn'),why:val('ifWh')}}); closeSheet(); drawKitchen(); }catch(e){ showErr('ifMsg2',e); } }
async function delItem(id){ if(!confirm('Remove this item?')) return; KIT=await api('/kitchen/items/'+id,{method:'DELETE'}); closeSheet(); drawKitchen(); }

/* ================= OFFLINE ================= */
const OQ_KEY='ciq_outbox';
function outbox(){ try{ return JSON.parse(localStorage.getItem(OQ_KEY)||'[]'); }catch(e){ return []; } }
function setOutbox(q){ try{ localStorage.setItem(OQ_KEY,JSON.stringify(q)); }catch(e){ toast('Phone storage is full. Some offline changes may not save.'); } drawNetBar(); }
function queueWrite(path,o){
  const q=outbox(); q.push({path,method:o.method,body:o.body||null,at:Date.now()}); setOutbox(q);
}
let SYNCING=false;
async function flushOutbox(){
  if(SYNCING||!navigator.onLine||!TOKEN) return;
  let q=outbox(); if(!q.length) return;
  SYNCING=true; drawNetBar();
  let sent=0, failed=[];
  for(const item of q){
    try{
      const r=await fetch('/api'+item.path,{method:item.method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+TOKEN},body:item.body?JSON.stringify(item.body):undefined});
      if(r.ok) sent++;
      else if(r.status>=500) failed.push(item);
      else { const d=await r.json().catch(()=>({})); toast('One offline change was refused: '+(d.error||r.status)); }
    }catch(e){ failed.push(item); break; }
  }
  const rest=q.slice(sent+failed.length); setOutbox(failed.concat(rest));
  SYNCING=false; drawNetBar();
  if(sent){ toast(sent+' offline change'+(sent>1?'s':'')+' synced'); try{ showTab(TAB); refreshAlerts(); }catch(e){} }
}
function drawNetBar(){
  let b=$('netBar');
  const n=outbox().length, off=!navigator.onLine;
  if(!off&&!n){ if(b) b.remove(); return; }
  if(!b){ b=document.createElement('div'); b.id='netBar'; document.querySelector('header').insertAdjacentElement('afterend',b); }
  b.className='netbar'+(off?' off':'');
  b.innerHTML=off?'<b>Offline</b> · showing what was last loaded'+(n?' · '+n+' change'+(n>1?'s':'')+' waiting to send':'')
    :(SYNCING?'Sending '+n+' offline change'+(n>1?'s':'')+'…':'<b>'+n+'</b> offline change'+(n>1?'s':'')+' waiting <button onclick="flushOutbox()">Send now</button>');
}
function initOffline(){
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
  window.addEventListener('online',()=>{ drawNetBar(); flushOutbox(); });
  window.addEventListener('offline',drawNetBar);
  setInterval(flushOutbox,30000);
  drawNetBar(); setTimeout(flushOutbox,2000);
}
// Writes that are safe to replay later. Anything else needs a connection.
const QUEUEABLE=[/^\/workorders$/,/^\/workorders\/\d+$/,/^\/workorders\/\d+\/(note|complete|photos)$/,/^\/unit\/[^/]+\/job$/,/^\/parts\/\d+\/txn$/,/^\/kitchen\/temps$/,/^\/kitchen\/items\/\d+\/done$/];
