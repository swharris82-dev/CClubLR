/* Clubhouse IQ: 3D property map.
   A hand-rolled canvas renderer (no libraries, works offline and in the
   Android WebView). Buildings come from the same layout the managers arrange
   in the 2D plan, so moving a building there moves it here.

   Gestures: drag sideways to spin, pinch or +/- to zoom, two fingers to pan,
   tap a building to fly to it and open its sheet. */
(function(){
const WORLD={w:1000,h:1300};
const ST_COL={critical:'#C8372D',warn:'#C99A2E',busy:'#3F6FA8',ok:'#2E8B62'};
const ST_LBL={critical:'Emergency',warn:'Needs attention',busy:'Open work',ok:'All clear'};
const REDUCED=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const LIGHT=norm([-0.45,-0.6,0.75]);

let M=null; // state for the mounted map
function norm(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
function ease(t){ return t<0?0:t>1?1:1-Math.pow(1-t,3); }
function easeBack(t){ if(t<=0) return 0; if(t>=1) return 1; const c=1.4; return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2); }
function lerp(a,b,t){ return a+(b-a)*t; }
function angLerp(a,b,t){ let d=((b-a+Math.PI*3)%(Math.PI*2))-Math.PI; return a+d*t; }
function hexRgb(h){ h=h.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function shade(hex,k,mixHex,mix){
  let c=hexRgb(hex);
  if(mixHex&&mix){ const m=hexRgb(mixHex); c=c.map((v,i)=>v*(1-mix)+m[i]*mix); }
  return 'rgb('+c.map(v=>Math.max(0,Math.min(255,Math.round(v*k)))).join(',')+')';
}
function rnd(seed){ let s=seed>>>0||1; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }

/* ---------- what kind of building is this? ---------- */
function kindOf(name){
  const n=name.toLowerCase();
  if(/dome|bubble/.test(n)) return 'dome';
  if(/central plant|plant room|boiler/.test(n)) return 'plant';
  if(/clubhouse/.test(n)) return 'clubhouse';
  if(/pool/.test(n)) return 'pool';
  if(/fitness|gym/.test(n)) return 'fitness';
  if(/tennis/.test(n)) return 'tennis';
  if(/cart/.test(n)) return 'cartbarn';
  if(/maint|shop yard/.test(n)) return 'shop';
  if(/grounds|course|golf course/.test(n)) return 'course';
  if(/golf|pro shop/.test(n)) return 'golfshop';
  if(/family|teen|youth/.test(n)) return 'family';
  return 'generic';
}

/* ---------- mesh helpers: every face is {p:[[x,y,z]..], c:color, b:building, win?} ---------- */
function quad(F,b,c,pts,extra){ F.push(Object.assign({p:pts,c,b},extra||{})); }
function box(F,b,x0,y0,x1,y1,z0,z1,wall,roof,win){
  quad(F,b,wall,[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],win?{win}:null);
  quad(F,b,wall,[[x1,y0,z0],[x0,y0,z0],[x0,y0,z1],[x1,y0,z1]],win?{win}:null);
  quad(F,b,wall,[[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]],win?{win}:null);
  quad(F,b,wall,[[x1,y1,z0],[x1,y0,z0],[x1,y0,z1],[x1,y1,z1]],win?{win}:null);
  if(roof) quad(F,b,roof,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]);
}
function gable(F,b,x0,y0,x1,y1,z,rh,roof,gableCol,over){
  over=over||0; const X0=x0-over,X1=x1+over,Y0=y0-over,Y1=y1+over;
  if(x1-x0>=y1-y0){ const ym=(y0+y1)/2;
    quad(F,b,roof,[[X0,Y1,z],[X1,Y1,z],[X1,ym,z+rh],[X0,ym,z+rh]]);
    quad(F,b,roof,[[X1,Y0,z],[X0,Y0,z],[X0,ym,z+rh],[X1,ym,z+rh]]);
    quad(F,b,gableCol,[[x0,y0,z],[x0,y1,z],[x0,ym,z+rh]]);
    quad(F,b,gableCol,[[x1,y1,z],[x1,y0,z],[x1,ym,z+rh]]);
  } else { const xm=(x0+x1)/2;
    quad(F,b,roof,[[X0,Y0,z],[X0,Y1,z],[xm,Y1,z+rh],[xm,Y0,z+rh]]);
    quad(F,b,roof,[[X1,Y1,z],[X1,Y0,z],[xm,Y0,z+rh],[xm,Y1,z+rh]]);
    quad(F,b,gableCol,[[x1,y0,z],[x0,y0,z],[xm,y0,z+rh]]);
    quad(F,b,gableCol,[[x0,y1,z],[x1,y1,z],[xm,y1,z+rh]]);
  }
}
function hip(F,b,x0,y0,x1,y1,z,rh,roof,over){
  over=over||0; const X0=x0-over,X1=x1+over,Y0=y0-over,Y1=y1+over;
  const w=X1-X0,h=Y1-Y0,i=Math.min(w,h)/2;
  let a,c; // ridge ends
  if(w>=h){ a=[X0+i,(Y0+Y1)/2,z+rh]; c=[X1-i,(Y0+Y1)/2,z+rh]; }
  else { a=[(X0+X1)/2,Y0+i,z+rh]; c=[(X0+X1)/2,Y1-i,z+rh]; }
  if(w>=h){
    quad(F,b,roof,[[X0,Y1,z],[X1,Y1,z],c,a]);
    quad(F,b,roof,[[X1,Y0,z],[X0,Y0,z],a,c]);
    quad(F,b,roof,[[X0,Y0,z],[X0,Y1,z],a]);
    quad(F,b,roof,[[X1,Y1,z],[X1,Y0,z],c]);
  } else {
    quad(F,b,roof,[[X0,Y0,z],[X0,Y1,z],c,a]);
    quad(F,b,roof,[[X1,Y1,z],[X1,Y0,z],a,c]);
    quad(F,b,roof,[[X1,Y0,z],[X0,Y0,z],a]);
    quad(F,b,roof,[[X0,Y1,z],[X1,Y1,z],c]);
  }
}
function cyl(F,b,cx,cy,r,z0,z1,col,top,seg){
  seg=seg||12; const pts=[];
  for(let i=0;i<seg;i++){ const a=i/seg*Math.PI*2; pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]); }
  for(let i=0;i<seg;i++){ const p=pts[i],q=pts[(i+1)%seg]; quad(F,b,col,[[p[0],p[1],z0],[q[0],q[1],z0],[q[0],q[1],z1],[p[0],p[1],z1]],{soft:1}); }
  if(top) quad(F,b,top,pts.map(p=>[p[0],p[1],z1]).reverse(),null);
}
/* Air-supported fabric dome over a rounded-rectangle footprint. */
function dome(F,b,x0,y0,x1,y1,hgt,k){
  const cx=(x0+x1)/2, cy=(y0+y1)/2, a=(x1-x0)/2, bb=(y1-y0)/2, H=hgt*k;
  const LAT=6, LON=24, P=4;
  const ring=(phi)=>{ const s=Math.pow(Math.cos(phi),0.55), z=H*Math.sin(phi), out=[];
    for(let j=0;j<LON;j++){ const t=j/LON*Math.PI*2, c=Math.cos(t), sn=Math.sin(t);
      out.push([cx+a*s*Math.sign(c)*Math.pow(Math.abs(c),2/P), cy+bb*s*Math.sign(sn)*Math.pow(Math.abs(sn),2/P), z]); }
    return out; };
  let prev=ring(0);
  for(let i=1;i<=LAT;i++){
    const phi=i/LAT*Math.PI/2*0.999, cur=ring(phi);
    for(let j=0;j<LON;j++){ const j2=(j+1)%LON;
      const col=(j%3===0)?'#DCE4EE':'#F3F6FA';
      if(i===LAT) quad(F,b,col,[prev[j],prev[j2],cur[j]],{soft:1});
      else quad(F,b,col,[prev[j],prev[j2],cur[j2],cur[j]],{soft:1}); }
    prev=cur;
  }
}

/* ---------- build one building's faces ---------- */
function buildFaces(bi,name,r,k){
  const F=[], kind=kindOf(name), x0=r.x,y0=r.y,x1=r.x+r.w,y1=r.y+r.h, m=Math.min(r.w,r.h);
  const H=v=>v*k;
  const winW={c:'#2B3F5C',rows:1};
  switch(kind){
    case 'clubhouse': {
      const h=H(Math.max(46,m*0.32));
      box(F,bi,x0,y0,x1,y1,0,h,'#B7654A',null,{c:'#2F4058',rows:2});
      hip(F,bi,x0,y0,x1,y1,h,H(m*0.22),'#4E5A66',6);
      // portico on the front
      const px=(x0+x1)/2, pw=Math.min(r.w*0.32,90);
      box(F,bi,px-pw/2,y1,px+pw/2,y1+22,0,h*0.82,'#EDE6D8','#E3DACA');
      for(let i=0;i<4;i++) cyl(F,bi,px-pw/2+8+i*(pw-16)/3,y1+16,3.2,0,h*0.82,'#F6F2EA',null,6);
      cyl(F,bi,x0+r.w*0.2,y0+r.h*0.35,6,h,h+H(m*0.26),'#8E4A36','#5A2F22',6);
      cyl(F,bi,x1-r.w*0.2,y0+r.h*0.35,6,h,h+H(m*0.26),'#8E4A36','#5A2F22',6);
      break; }
    case 'plant': {
      const h=H(Math.max(40,m*0.4));
      box(F,bi,x0,y0,x1-r.w*0.38,y1,0,h,'#9C5B45','#6E7681',{c:'#3B4A5E',rows:1,door:1});
      // cooling tower cell
      const tx0=x1-r.w*0.36, th=H(Math.max(46,m*0.48));
      box(F,bi,tx0,y0+r.h*0.1,x1,y1-r.h*0.1,0,th,'#A9B4BF','#8C97A3',{c:'#7E8894',rows:3,louver:1});
      cyl(F,bi,(tx0+x1)/2,(y0+y1)/2,Math.min(r.w*0.13,r.h*0.3),th,th+10*k,'#74808C','#2C3440',14);
      // boiler stack
      cyl(F,bi,x0+r.w*0.16,y0+r.h*0.25,6,h,h+H(48),'#5E6670','#30363D',8);
      break; }
    case 'dome': {
      dome(F,bi,x0,y0,x1,y1,Math.max(55,m*0.42),k);
      // revolving-door vestibule on the front
      const vx=(x0+x1)/2;
      box(F,bi,vx-18,y1-8,vx+18,y1+20,0,H(26),'#C9D3DE','#9AA8B6',{c:'#3E5A7E',rows:1,door:1});
      // inflation blower / heater boxes beside it
      box(F,bi,x1-6,y1-r.h*0.3,x1+20,y1-r.h*0.1,0,H(18),'#7C8794','#5E6976');
      break; }
    case 'pool': {
      const px1=x0+r.w*0.42, h=H(Math.max(26,m*0.25));
      box(F,bi,x0,y0,px1,y1,0,h,'#EFE7D6',null,{c:'#2E5E7E',rows:1});
      gable(F,bi,x0,y0,px1,y1,h,H(16),'#3E6B8A','#E6DCC6',4);
      quad(F,bi,'#E9E3D3',[[px1+4,y0,1],[x1,y0,1],[x1,y1,1],[px1+4,y1,1]]);
      quad(F,bi,'#4FB3D9',[[px1+14,y0+12,2],[x1-10,y0+12,2],[x1-10,y1-12,2],[px1+14,y1-12,2]],{water:1});
      break; }
    case 'fitness': {
      const h=H(Math.max(38,m*0.36));
      box(F,bi,x0,y0,x1,y1,0,h,'#D8D2C6','#9AA3AD',{c:'#1F3550',rows:1,band:1});
      box(F,bi,x0+r.w*0.25,y0+r.h*0.3,x0+r.w*0.55,y0+r.h*0.6,h,h+H(9),'#8B949E','#6F7883');
      break; }
    case 'tennis': {
      const h=H(Math.max(30,m*0.3));
      box(F,bi,x0,y0,x1,y1,0,h,'#C2CDB4',null,{c:'#2E4A33',rows:1,door:1});
      gable(F,bi,x0,y0,x1,y1,h,H(m*0.22),'#2F5D3A','#B3BFA4',5);
      break; }
    case 'cartbarn': {
      const h=H(Math.max(26,m*0.25));
      box(F,bi,x0,y0,x1,y1,0,h,'#8C9AA6',null,{c:'#4A5866',rows:1,bays:1});
      gable(F,bi,x0,y0,x1,y1,h,H(m*0.14),'#A7B2BC','#7D8B97',4);
      break; }
    case 'shop': {
      const h=H(Math.max(30,m*0.28));
      box(F,bi,x0,y0,x1,y1,0,h,'#B9B2A3',null,{c:'#5C6670',rows:1,bays:1});
      gable(F,bi,x0,y0,x1,y1,h,H(m*0.16),'#6B7A88','#A89F8F',4);
      break; }
    case 'golfshop': {
      const h=H(Math.max(30,m*0.3));
      box(F,bi,x0,y0,x1,y1,0,h,'#E6DDC9',null,{c:'#2F4058',rows:1,door:1});
      hip(F,bi,x0,y0,x1,y1,h,H(m*0.24),'#365A45',5);
      break; }
    case 'family': {
      const h=H(Math.max(30,m*0.3));
      box(F,bi,x0,y0,x1,y1,0,h,'#C98E6A',null,{c:'#2F4058',rows:1,door:1});
      gable(F,bi,x0,y0,x1,y1,h,H(m*0.24),'#4E5A66','#BE8160',5);
      break; }
    case 'course': {
      // putting green, bunker, flag (flag is drawn as a sprite)
      const cx=(x0+x1)/2, cy=(y0+y1)/2, n=22, g=[], s=[];
      for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; g.push([cx+Math.cos(a)*r.w*0.46,cy+Math.sin(a)*r.h*0.42,1.5]);
        s.push([cx+r.w*0.3+Math.cos(a)*r.w*0.12,cy+r.h*0.22+Math.sin(a)*r.h*0.1,2]); }
      quad(F,bi,'#7FBF6A',g,{flat:1}); quad(F,bi,'#E8DDB8',s,{flat:1});
      break; }
    default: {
      const h=H(Math.max(30,m*0.3));
      box(F,bi,x0,y0,x1,y1,0,h,'#C9C2B4','#8E98A3',{c:'#2F4058',rows:1});
    }
  }
  return F;
}
function topZ(name,r){
  const m=Math.min(r.w,r.h), k=kindOf(name);
  return {clubhouse:Math.max(46,m*0.32)+m*0.22,plant:Math.max(46,m*0.48)+10,dome:Math.max(55,m*0.42),pool:Math.max(26,m*0.25)+16,
    fitness:Math.max(38,m*0.36)+9,tennis:Math.max(30,m*0.3)+m*0.22,cartbarn:Math.max(26,m*0.25)+m*0.14,shop:Math.max(30,m*0.28)+m*0.16,
    golfshop:Math.max(30,m*0.3)+m*0.24,family:Math.max(30,m*0.3)+m*0.24,course:60}[k]||Math.max(30,m*0.3);
}

/* ---------- static ground features ---------- */
function groundFeatures(layout){
  const G=[];
  G.push({p:[[0,0,0],[WORLD.w,0,0],[WORLD.w,WORLD.h,0],[0,WORLD.h,0]],c:'#BFD4A8'});
  for(let i=0;i<14;i++){ const y=i*WORLD.h/14; if(i%2) G.push({p:[[0,y,0],[WORLD.w,y,0],[WORLD.w,y+WORLD.h/14,0],[0,y+WORLD.h/14,0]],c:'#B7CEA0'}); }
  const blob=(cx,cy,rx,ry,c,n,wob,seed,extra)=>{ const R=rnd(seed),p=[]; for(let i=0;i<n;i++){ const a=i/n*Math.PI*2,w=1+(R()-.5)*wob; p.push([cx+Math.cos(a)*rx*w,cy+Math.sin(a)*ry*w,0]); } G.push(Object.assign({p,c},extra||{})); };
  blob(210,70,260,70,'#A8CC8C',20,.12,3); blob(520,1200,560,110,'#A8CC8C',22,.1,7);
  blob(880,1180,98,58,'#5FA8CF',24,.05,11,{water:1});
  blob(200,1180,34,24,'#8FD07A',14,.1,5);
  const road=(a,b)=>{ const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1,nx=-dy/l*13,ny=dx/l*13;
    G.push({p:[[a[0]+nx,a[1]+ny,0],[b[0]+nx,b[1]+ny,0],[b[0]-nx,b[1]-ny,0],[a[0]-nx,a[1]-ny,0]],c:'#D9D2C0'}); };
  [[[500,1300],[500,707]],[[487,720],[880,720]],[[500,430],[500,237]],[[487,250],[900,250]]].forEach(s=>road(s[0],s[1]));
  G.push({p:[[60,300,0],[360,300,0],[360,500,0],[60,500,0]],c:'#CFCAC0'});
  for(let i=0;i<6;i++){ const x=90+i*48; G.push({p:[[x-1.5,310,0],[x+1.5,310,0],[x+1.5,370,0],[x-1.5,370,0]],c:'#F4F2EC'}); G.push({p:[[x-1.5,430,0],[x+1.5,430,0],[x+1.5,490,0],[x-1.5,490,0]],c:'#F4F2EC'}); }
  // trees, kept off buildings, roads, water and the lot
  const R=rnd(1902), trees=[], rects=Object.values(layout);
  const blocked=(x,y)=>rects.some(r=>x>r.x-28&&x<r.x+r.w+28&&y>r.y-28&&y<r.y+r.h+40)||
    (Math.abs(x-500)<34&&(y>690||(y>220&&y<450)))||(Math.abs(y-720)<32&&x>470&&x<900)||(Math.abs(y-250)<32&&x>470&&x<920)||
    (x>40&&x<380&&y>285&&y<515)||(((x-880)/120)**2+((y-1180)/80)**2<1)||(((x-200)/50)**2+((y-1180)/40)**2<1);
  for(let t=0;t<400&&trees.length<70;t++){ const x=20+R()*(WORLD.w-40), y=20+R()*(WORLD.h-40); if(!blocked(x,y)&&!trees.some(q=>Math.hypot(q.x-x,q.y-y)<34)) trees.push({x,y,s:.8+R()*.6,h:R()}); }
  return {G,trees};
}

/* ---------- camera ---------- */
function cam(){ return M.cam; }
function proj(x,y,z){
  z*=1.45; const c=M.cam, dx=x-c.tx, dy=y-c.ty, co=Math.cos(c.yaw), si=Math.sin(c.yaw);
  const rx=dx*co-dy*si, ry=dx*si+dy*co, sp=Math.sin(c.pitch), cp=Math.cos(c.pitch);
  return [M.cw/2+rx*c.zoom, M.ch*0.52+(ry*sp-z*cp)*c.zoom, ry*cp+z*sp];
}
function fitZoom(pitch,yaw){
  const co=Math.cos(yaw),si=Math.sin(yaw),sp=Math.sin(pitch); let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;
  [[0,0],[WORLD.w,0],[WORLD.w,WORLD.h],[0,WORLD.h]].forEach(([x,y])=>{ const dx=x-WORLD.w/2,dy=y-WORLD.h/2, rx=dx*co-dy*si, ry=dx*si+dy*co;
    mnx=Math.min(mnx,rx);mxx=Math.max(mxx,rx); mny=Math.min(mny,ry*sp);mxy=Math.max(mxy,ry*sp); });
  return Math.min(M.cw/(mxx-mnx),M.ch/((mxy-mny)+80*Math.cos(pitch)))*0.98;
}
function tweenCam(to,ms,done){
  const from=Object.assign({},M.cam), t0=performance.now();
  if(REDUCED) ms=1;
  M.tween={from,to,t0,ms,done};
  kick();
}
function stepTween(now){
  const T=M.tween; if(!T) return;
  const t=ease((now-T.t0)/T.ms), c=M.cam;
  ['tx','ty','zoom','pitch'].forEach(k=>{ if(T.to[k]!==undefined) c[k]=lerp(T.from[k],T.to[k],t); });
  if(T.to.yaw!==undefined) c.yaw=angLerp(T.from.yaw,T.to.yaw,t);
  if(t>=1){ M.tween=null; if(T.done) T.done(); }
}

/* ---------- drawing ---------- */
function faceNormal(p){ let nx=0,ny=0,nz=0; for(let i=0;i<p.length;i++){ const a=p[i],b=p[(i+1)%p.length];
  nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1]); } return norm([nx,ny,nz]); }
function viewDot(n){ const c=M.cam, co=Math.cos(c.yaw), si=Math.sin(c.yaw);
  const ny=n[0]*si+n[1]*co; return ny*Math.cos(c.pitch)+n[2]*Math.sin(c.pitch); }
function lightK(n){ return 0.62+0.42*Math.max(0,n[0]*LIGHT[0]+n[1]*LIGHT[1]+n[2]*LIGHT[2]); }

function draw(now){
  const ctx=M.ctx, W=M.cw, H=M.ch, c=M.cam, t=now/1000;
  ctx.setTransform(M.dpr,0,0,M.dpr,0,0);
  // sky
  const sky=ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#CFE2F3'); sky.addColorStop(.55,'#EEF3F8'); sky.addColorStop(1,'#E3EBDD');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);
  const poly=(pts,fill,stroke,lw)=>{ ctx.beginPath(); pts.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])); ctx.closePath();
    if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); } };
  // ground (always behind everything)
  M.ground.G.forEach(f=>{ let col=f.c; if(f.water&&!REDUCED){ col=shade(f.c,1+0.05*Math.sin(t*1.6)); } poly(f.p.map(q=>proj(q[0],q[1],q[2])),col); });
  // shadows
  ctx.fillStyle='rgba(40,55,40,.16)';
  M.blds.forEach(B=>{ if(B.kind==='course') return; const r=B.r, h=B.top*B.k*0.5, sx=-LIGHT[0]/LIGHT[2]*h, sy=-LIGHT[1]/LIGHT[2]*h;
    const fp=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]], all=fp.concat(fp.map(q=>[q[0]+sx,q[1]+sy]));
    const pr=all.map(q=>proj(q[0],q[1],0)); const hull=convexHull(pr); poly(hull,'rgba(40,55,40,'+(0.12*(B.dim?0.4:1))+')'); });
  // status rings on the ground
  M.blds.forEach(B=>{ if(B.status==='ok') return; const r=B.r, pad=10, col=ST_COL[B.status];
    const pts=[[r.x-pad,r.y-pad],[r.x+r.w+pad,r.y-pad],[r.x+r.w+pad,r.y+r.h+pad],[r.x-pad,r.y+r.h+pad]].map(q=>proj(q[0],q[1],0.5));
    ctx.globalAlpha=B.dim?.25:(B.status==='critical'&&!REDUCED?.55+.35*Math.sin(t*5):.7);
    ctx.setLineDash([8,6]); ctx.lineDashOffset=REDUCED?0:-t*18; poly(pts,null,col,3); ctx.setLineDash([]); ctx.globalAlpha=1; });
  // collect faces and sprites, sort back to front
  const items=[];
  M.blds.forEach(B=>{
    if(B.k<=0.001) return;
    if(B.kAt!==B.k){ B.faces=buildFaces(B.i,B.name,B.r,B.k).map(f=>Object.assign(f,{n:faceNormal(f.p)})); B.kAt=B.k; }
    B.hit=[];
    B.faces.forEach(f=>{
      const vd=viewDot(f.n); if(vd<=0.0001&&!f.flat) return;
      const pr=f.p.map(q=>proj(q[0],q[1],q[2]));
      let d=0; pr.forEach(q=>d+=q[2]); d/=pr.length;
      items.push({d,pr,f,B,vd}); B.hit.push(pr);
    });
  });
  M.ground.trees.forEach(T=>{ const p=proj(T.x,T.y,0); items.push({d:p[2]+2,tree:T,p}); });
  M.blds.forEach(B=>{ if(B.kind==='course'){ const r=B.r, p=proj(r.x+r.w*0.46,r.y+r.h*0.45,0); items.push({d:p[2]+30,flag:B,p}); }
    if(B.kind==='plant'&&B.k>0.9&&!REDUCED){ const r=B.r, tx=r.x+r.w*0.82, ty=r.y+r.h/2, tz=Math.max(46,Math.min(r.w,r.h)*0.48)+10;
      for(let i=0;i<5;i++){ const ph=((t*0.35+i/5)%1); const p=proj(tx+Math.sin(t+i)*6,ty,tz+ph*70); items.push({d:p[2]+400,puff:1,p,ph,s:Math.min(r.w,r.h)*0.11}); }
      const sx=r.x+r.w*0.16, sy=r.y+r.h*0.25, sz=Math.max(40,Math.min(r.w,r.h)*0.4)+48;
      for(let i=0;i<3;i++){ const ph=((t*0.25+i/3)%1); const p=proj(sx+ph*14,sy-ph*8,sz+ph*45); items.push({d:p[2]+400,puff:2,p,ph,s:7}); } }
    if(B.kind==='plant'&&B.k>0.9){ const r=B.r, tz=Math.max(46,Math.min(r.w,r.h)*0.48)+10*B.k; const cx=r.x+r.w*0.82, cy=r.y+r.h/2, rr=Math.min(r.w*0.13,r.h*0.3)*0.85;
      const p=proj(cx,cy,tz+0.5); items.push({d:p[2]+1,fan:1,cx,cy,tz,rr,B}); }
  });
  items.sort((a,b)=>a.d-b.d);
  items.forEach(it=>{
    if(it.tree){ drawTree(ctx,it.p,it.tree,c.zoom,t); return; }
    if(it.flag){ drawFlag(ctx,it.p,c.zoom,t,it.flag.dim); return; }
    if(it.puff){ const a=(1-it.ph)*(it.puff===1?.55:.35), rr=(it.s*(0.6+it.ph*1.4))*c.zoom; ctx.fillStyle=it.puff===1?'rgba(255,255,255,'+a+')':'rgba(120,125,135,'+a+')';
      ctx.beginPath(); ctx.arc(it.p[0],it.p[1],Math.max(1,rr),0,Math.PI*2); ctx.fill(); return; }
    if(it.fan){ const ang=REDUCED?0:t*9; ctx.strokeStyle='rgba(20,26,34,.85)'; ctx.lineWidth=Math.max(1,2.2*c.zoom);
      for(let i=0;i<4;i++){ const a=ang+i*Math.PI/2, p=proj(it.cx+Math.cos(a)*it.rr,it.cy+Math.sin(a)*it.rr,it.tz+0.6), o=proj(it.cx,it.cy,it.tz+0.6);
        ctx.beginPath(); ctx.moveTo(o[0],o[1]); ctx.lineTo(p[0],p[1]); ctx.stroke(); } return; }
    const f=it.f, B=it.B; let k=f.soft?0.55+0.5*Math.max(0,it.vd)*lightK(f.n):lightK(f.n);
    let col;
    if(f.water){ col=shade(f.c,1+(REDUCED?0:0.06*Math.sin(t*2.2))); }
    else col=shade(f.c,k,M.tint?ST_COL[B.status]:null,M.tint?0.45:0);
    ctx.globalAlpha=B.dim?0.32:1;
    poly(it.pr,col,f.flat||f.water?null:'rgba(30,35,45,.18)',0.7);
    if(f.water&&!REDUCED) drawRipples(ctx,it.pr,t);
    if(f.win&&B.k>0.6) drawWindows(ctx,it.pr,f.win,k,B.dim);
    if(B.sel){ ctx.globalAlpha=1; poly(it.pr,null,'rgba(184,150,62,.9)',1.6); }
    ctx.globalAlpha=1;
  });
  // markers and labels, always on top
  const marks=[];
  M.blds.forEach(B=>{ if(B.k<0.98) return; const r=B.r, bob=REDUCED?0:Math.sin(t*2.4+B.i)*5;
    const p=proj(r.x+r.w/2,r.y+r.h/2,B.top+34+bob); marks.push({B,p}); });
  marks.sort((a,b)=>a.p[2]-b.p[2]);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  marks.forEach(({B,p})=>{
    const col=ST_COL[B.status], R=11; ctx.globalAlpha=B.dim?0.35:1;
    if(B.status==='critical'&&!REDUCED){ const ph=(t*1.2)%1; ctx.strokeStyle=col; ctx.globalAlpha=(1-ph)*(B.dim?.3:.8); ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p[0],p[1],R+ph*18,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=B.dim?0.35:1; }
    const base=proj(B.r.x+B.r.w/2,B.r.y+B.r.h/2,B.top+4);
    ctx.strokeStyle='rgba(23,50,92,.45)'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(p[0],p[1]+R); ctx.lineTo(base[0],base[1]); ctx.stroke();
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(p[0],p[1],R,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2.4; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='700 11px Figtree,system-ui,sans-serif';
    ctx.fillText(B.open?String(B.open):B.status==='ok'?'✓':'!',p[0],p[1]+0.5);
    B.mark=[p[0],p[1],R+6];
    ctx.globalAlpha=1;
  });
  // labels: most important first, skip any that would overlap one already placed
  const PRI={critical:0,warn:1,busy:2,ok:3}, placed=[];
  marks.slice().sort((a,b)=>(b.B.sel-a.B.sel)||(PRI[a.B.status]-PRI[b.B.status])||(b.p[2]-a.p[2])).forEach(({B,p})=>{
    if(!(M.labels||B.sel)) return;
    ctx.font=(B.sel?'700 12px':'600 10.5px')+' Figtree,system-ui,sans-serif';
    const tw=ctx.measureText(B.name).width+12, ly=p[1]-11-12, box=[p[0]-tw/2-2,ly-11,tw+4,22];
    if(!B.sel&&placed.some(q=>box[0]<q[0]+q[2]&&q[0]<box[0]+box[2]&&box[1]<q[1]+q[3]&&q[1]<box[1]+box[3])) return;
    placed.push(box); ctx.globalAlpha=B.dim?0.4:1;
    ctx.fillStyle=B.sel?'#17325C':'rgba(255,255,255,.93)'; roundRect(ctx,p[0]-tw/2,ly-9,tw,18,9); ctx.fill();
    ctx.fillStyle=B.sel?'#F3E3B3':'#17325C'; ctx.fillText(B.name,p[0],ly+0.5); ctx.globalAlpha=1;
  });
  // compass
  const cxp=W-26, cyp=26; ctx.save(); ctx.translate(cxp,cyp); ctx.rotate(-c.yaw);
  ctx.fillStyle='rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#B8322A'; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(4,0); ctx.lineTo(-4,0); ctx.fill();
  ctx.fillStyle='#17325C'; ctx.beginPath(); ctx.moveTo(0,12); ctx.lineTo(4,0); ctx.lineTo(-4,0); ctx.fill();
  ctx.restore(); ctx.fillStyle='#17325C'; ctx.font='700 9px Figtree,system-ui,sans-serif';
  const na=-c.yaw-Math.PI/2; ctx.fillText('N',cxp+Math.cos(na)*22,cyp+Math.sin(na)*22);
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function convexHull(P){ const p=P.map(q=>[q[0],q[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]); const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[]; p.forEach(q=>{ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); });
  for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0) up.pop(); up.push(q); }
  return lo.slice(0,-1).concat(up.slice(0,-1)); }
function bil(pr,u,v){ const a=pr[0],b=pr[1],c=pr[2],d=pr[3]; return [ (a[0]*(1-u)+b[0]*u)*(1-v)+(d[0]*(1-u)+c[0]*u)*v, (a[1]*(1-u)+b[1]*u)*(1-v)+(d[1]*(1-u)+c[1]*u)*v ]; }
function drawWindows(ctx,pr,w,k,dim){
  if(pr.length!==4) return;
  const len=Math.hypot(pr[1][0]-pr[0][0],pr[1][1]-pr[0][1]); if(len<14) return;
  const cols=Math.max(1,Math.min(9,Math.round(len/22))), rows=w.rows||1;
  ctx.fillStyle=shade(w.c,0.8+k*0.3); ctx.globalAlpha=dim?0.3:0.9;
  const q=(u0,v0,u1,v1)=>{ const a=bil(pr,u0,v0),b=bil(pr,u1,v0),c=bil(pr,u1,v1),d=bil(pr,u0,v1); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.lineTo(c[0],c[1]); ctx.lineTo(d[0],d[1]); ctx.closePath(); ctx.fill(); };
  if(w.band){ q(0.04,0.35,0.96,0.75); }
  else if(w.bays){ for(let i=0;i<cols;i++) q((i+0.18)/cols,0,(i+0.82)/cols,0.7); }
  else if(w.louver){ for(let j=0;j<5;j++) q(0.08,0.12+j*0.15,0.92,0.18+j*0.15); }
  else { for(let j=0;j<rows;j++) for(let i=0;i<cols;i++){ if(w.door&&i===Math.floor(cols/2)&&j===0){ q((i+0.25)/cols,0,(i+0.75)/cols,0.62); continue; }
      const v0=(j+0.3)/rows*0.9+0.05, v1=(j+0.75)/rows*0.9+0.05; q((i+0.25)/cols,v0,(i+0.75)/cols,v1); } }
  ctx.globalAlpha=1;
}
function drawRipples(ctx,pr,t){
  if(pr.length!==4) return; ctx.strokeStyle='rgba(255,255,255,.55)'; ctx.lineWidth=1.2;
  for(let i=0;i<3;i++){ const v=((t*0.18+i/3)%1); const a=bil(pr,0.15,v), b=bil(pr,0.85,v); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.quadraticCurveTo((a[0]+b[0])/2,(a[1]+b[1])/2-2,b[0],b[1]); ctx.stroke(); }
}
function drawTree(ctx,p,T,z,t){
  const s=T.s*z, sway=REDUCED?0:Math.sin(t*1.3+T.h*9)*1.2*z;
  ctx.fillStyle='rgba(40,55,40,.18)'; ctx.beginPath(); ctx.ellipse(p[0]+6*s,p[1]+2*s,11*s,5*s,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#6B4F33'; ctx.fillRect(p[0]-1.6*s,p[1]-12*s,3.2*s,12*s);
  const g=T.h>.5?['#3F7A3A','#4E8F45','#64A653']:['#2F6B3F','#3E7F4C','#55995F'];
  [[0,-20,11],[-6,-15,8],[6,-15,8],[0,-27,7]].forEach((q,i)=>{ ctx.fillStyle=g[Math.min(2,i?1:0)+(i===3?1:0)];
    ctx.beginPath(); ctx.arc(p[0]+q[0]*s+sway*(i===3?1.4:1),p[1]+q[1]*s,q[2]*s,0,Math.PI*2); ctx.fill(); });
}
function drawFlag(ctx,p,z,t,dim){
  ctx.globalAlpha=dim?0.35:1; const h=46*z;
  ctx.strokeStyle='#5B4A2A'; ctx.lineWidth=Math.max(1,1.6*z); ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(p[0],p[1]-h); ctx.stroke();
  ctx.fillStyle='#B8322A'; ctx.beginPath(); ctx.moveTo(p[0],p[1]-h);
  for(let i=0;i<=8;i++){ const x=i/8*20*z, y=REDUCED?0:Math.sin(t*5-i*0.7)*2.2*z*i/8; ctx.lineTo(p[0]+x,p[1]-h+y); }
  for(let i=8;i>=0;i--){ const x=i/8*20*z, y=REDUCED?0:Math.sin(t*5-i*0.7)*2.2*z*i/8; ctx.lineTo(p[0]+x,p[1]-h+12*z+y); }
  ctx.closePath(); ctx.fill(); ctx.globalAlpha=1;
}

/* ---------- loop ---------- */
function alive(){ return M&&M.canvas.isConnected&&M.canvas.offsetParent!==null&&!document.hidden; }
function frame(now){
  M.raf=0; if(!alive()) return;
  if(M.lastDraw&&now-M.lastDraw<30&&!M.tween&&!M.drag){ M.raf=requestAnimationFrame(frame); return; }
  M.lastDraw=now;
  stepTween(now);
  // rise-in
  let rising=false;
  M.blds.forEach(B=>{ const t=(now-M.born-B.i*90)/750; const k=REDUCED?1:easeBack(t); if(Math.abs(k-B.k)>0.0005){ B.k=k; rising=true; } if(t<1) rising=true; });
  if(M.spin&&!M.drag&&!M.tween) M.cam.yaw+=(now-(M.last||now))/1000*0.18;
  M.last=now;
  draw(now);
  const ambient=!REDUCED&&M.ambient;
  if(rising||M.tween||M.spin||ambient) M.raf=requestAnimationFrame(frame);
}
function kick(){ if(M&&!M.raf){ M.lastDraw=0; M.raf=requestAnimationFrame(frame); } }

/* ---------- interaction ---------- */
function pick(x,y){
  let best=null,bd=-1e9;
  M.blds.forEach(B=>{ if(B.mark&&Math.hypot(x-B.mark[0],y-B.mark[1])<B.mark[2]){ best=B; bd=1e9; } });
  if(best) return best;
  M.blds.forEach(B=>{ (B.hit||[]).forEach(pr=>{ if(inPoly(x,y,pr)){ const d=pr.reduce((s,q)=>s+q[2],0)/pr.length; if(d>bd){ bd=d; best=B; } } }); });
  return best;
}
function inPoly(x,y,p){ let c=false; for(let i=0,j=p.length-1;i<p.length;j=i++){ if(((p[i][1]>y)!==(p[j][1]>y))&&(x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])) c=!c; } return c; }
function wire(){
  const cv=M.canvas, pts=new Map(); let start=null, pinch=null, moved=false;
  const loc=e=>{ const r=cv.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };
  cv.addEventListener('pointerdown',e=>{ pts.set(e.pointerId,loc(e)); moved=false; M.tween=null;
    if(pts.size===1){ start={p:loc(e),yaw:M.cam.yaw,pitch:M.cam.pitch,mouse:e.pointerType==='mouse'}; M.drag=true; }
    if(pts.size===2){ const [a,b]=[...pts.values()]; pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1]),z:M.cam.zoom,mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],tx:M.cam.tx,ty:M.cam.ty}; }
    try{ cv.setPointerCapture(e.pointerId); }catch(_){}
  });
  cv.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,loc(e));
    if(pts.size>=2&&pinch){ const [a,b]=[...pts.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]), mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      M.cam.zoom=Math.max(M.minZ*0.8,Math.min(M.minZ*6,pinch.z*d/pinch.d)); panBy(mid[0]-pinch.mid[0],mid[1]-pinch.mid[1],pinch); moved=true; kick(); return; }
    if(start){ const p=loc(e), dx=p[0]-start.p[0], dy=p[1]-start.p[1]; if(Math.hypot(dx,dy)>6) moved=true;
      if(moved){ M.cam.yaw=start.yaw+dx*0.009; if(start.mouse) M.cam.pitch=Math.max(0.35,Math.min(Math.PI/2,start.pitch+dy*0.006)); M.spin=false; syncBtns(); kick(); } }
  });
  const up=e=>{ const wasTap=pts.size===1&&!moved&&start; const p=loc(e); pts.delete(e.pointerId);
    if(pts.size<2) pinch=null; if(pts.size===0){ M.drag=false; start=null; }
    if(wasTap&&e.type==='pointerup'){ const B=pick(p[0],p[1]); if(B) focus(B,true); else unfocus(); } };
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{ e.preventDefault(); M.cam.zoom=Math.max(M.minZ*0.8,Math.min(M.minZ*6,M.cam.zoom*Math.exp(-e.deltaY*0.0015))); kick(); },{passive:false});
}
function panBy(dx,dy,base){
  const c=M.cam, co=Math.cos(c.yaw), si=Math.sin(c.yaw), sp=Math.max(0.2,Math.sin(c.pitch));
  const rx=-dx/c.zoom, ry=-dy/c.zoom/sp; c.tx=base.tx+rx*co+ry*si; c.ty=base.ty-rx*si+ry*co;
}
function focus(B,openSheet){
  M.blds.forEach(x=>{ x.sel=x===B; x.dim=x!==B; });
  const r=B.r, z=Math.min(M.minZ*3.2,Math.max(M.minZ*1.6,M.cw/(Math.max(r.w,r.h)*2.6)));
  tweenCam({tx:r.x+r.w/2,ty:r.y+r.h/2+20,zoom:z,pitch:0.62},700,()=>{ if(openSheet&&typeof buildingSheet==='function') buildingSheet(B.name); });
  M.spin=false; syncBtns(); showInfo(B);
}
function unfocus(){
  M.blds.forEach(x=>{ x.sel=false; x.dim=false; }); showInfo(null);
  tweenCam({tx:WORLD.w/2,ty:WORLD.h/2,zoom:fitZoom(M.cam.pitch,M.cam.yaw)},600);
}
function showInfo(B){
  const el=document.getElementById('map3dInfo'); if(!el) return;
  if(!B){ el.classList.remove('on'); return; }
  el.innerHTML='<span class="m3-dot" style="background:'+ST_COL[B.status]+'"></span><b>'+esc(B.name)+'</b><span>'+
    esc([ST_LBL[B.status],B.equipment+' equipment',B.open?B.open+' open':''].filter(Boolean).join(' · '))+'</span>';
  el.classList.add('on');
}
function syncBtns(){
  const s=document.getElementById('m3Spin'); if(s) s.classList.toggle('on',!!M.spin);
  const v=document.getElementById('m3View'); if(v) v.textContent=M.cam.pitch>1.3?'3D':'Top';
  const l=document.getElementById('m3Lbl'); if(l) l.classList.toggle('on',!!M.labels);
  const c=document.getElementById('m3Tint'); if(c) c.classList.toggle('on',!!M.tint);
}

/* ---------- public ---------- */
window.map3dMount=function(host,data){
  const keep=M&&M.cam?{yaw:M.cam.yaw,pitch:M.cam.pitch,labels:M.labels,tint:M.tint}:null;
  if(M&&M.raf) cancelAnimationFrame(M.raf);
  host.innerHTML='<div class="m3"><canvas id="map3dCanvas" aria-label="3D map of the club grounds. Drag sideways to turn it, pinch to zoom, tap a building."></canvas>'+
    '<div class="m3-ctl">'+
      '<button title="Turn left" onclick="map3dRotate(-1)">⟲</button><button title="Turn right" onclick="map3dRotate(1)">⟳</button>'+
      '<button title="Zoom in" onclick="map3dZoom(1.3)">+</button><button title="Zoom out" onclick="map3dZoom(1/1.3)">−</button>'+
      '<button id="m3View" title="Top view / 3D" onclick="map3dTilt()">Top</button>'+
      '<button id="m3Spin" title="Slow orbit" onclick="map3dSpin()">◎</button>'+
    '</div>'+
    '<div class="m3-ctl m3-ctl-l"><button id="m3Lbl" title="Labels" onclick="map3dLabels()">Aa</button><button id="m3Tint" title="Color buildings by status" onclick="map3dTint()">◐</button><button title="Show the whole club" onclick="map3dFit()">⤢</button></div>'+
    '<div id="map3dInfo" class="m3-info"></div></div>';
  const canvas=host.querySelector('canvas');
  M={canvas,ctx:canvas.getContext('2d'),cam:{yaw:keep?keep.yaw:-0.55,pitch:keep?keep.pitch:0.72,zoom:1,tx:WORLD.w/2,ty:WORLD.h/2},
     labels:keep?keep.labels:true,tint:keep?keep.tint:false,spin:false,ambient:true,born:performance.now()};
  M.ground=groundFeatures(data.layout);
  M.blds=data.buildings.filter(b=>data.layout[b.name]).map((b,i)=>{ const r=data.layout[b.name];
    return Object.assign({},b,{i,r,kind:kindOf(b.name),top:topZ(b.name,r),k:keep?1:0,kAt:-1}); });
  if(keep) M.born=-1e6;
  const size=()=>{ const w=host.clientWidth||360, h=Math.round(Math.min(640,Math.max(340,w*1.15)));
    M.dpr=Math.min(2.5,window.devicePixelRatio||1); M.cw=w; M.ch=h;
    canvas.width=Math.round(w*M.dpr); canvas.height=Math.round(h*M.dpr); canvas.style.width=w+'px'; canvas.style.height=h+'px';
    M.minZ=fitZoom(0.72,M.cam.yaw); };
  size(); M.cam.zoom=fitZoom(M.cam.pitch,M.cam.yaw);
  if(!keep){ M.cam.zoom*=0.55; M.cam.yaw-=0.7; tweenCam({zoom:fitZoom(M.cam.pitch,-0.55),yaw:-0.55},1400); }
  window.removeEventListener('resize',window._m3rs); window._m3rs=()=>{ if(M&&M.canvas.isConnected){ size(); kick(); } }; window.addEventListener('resize',window._m3rs);
  document.removeEventListener('visibilitychange',window._m3vis); window._m3vis=()=>kick(); document.addEventListener('visibilitychange',window._m3vis);
  wire(); syncBtns(); kick();
};
window.map3dRotate=d=>{ if(!M) return; M.spin=false; const q=Math.PI/2, target=Math.round(M.cam.yaw/q)*q+d*q; tweenCam({yaw:target},650); syncBtns(); };
window.map3dZoom=f=>{ if(!M) return; tweenCam({zoom:Math.max(M.minZ*0.8,Math.min(M.minZ*6,M.cam.zoom*f))},300); };
window.map3dTilt=()=>{ if(!M) return; const top=M.cam.pitch<1.3, p=top?Math.PI/2:0.72; tweenCam({pitch:p,zoom:M.blds.some(b=>b.sel)?M.cam.zoom:fitZoom(p,M.cam.yaw)},800,syncBtns); setTimeout(syncBtns,820); };
window.map3dSpin=()=>{ if(!M) return; M.spin=!M.spin; syncBtns(); kick(); };
window.map3dLabels=()=>{ if(!M) return; M.labels=!M.labels; syncBtns(); kick(); };
window.map3dTint=()=>{ if(!M) return; M.tint=!M.tint; syncBtns(); kick(); };
window.__m3cam=()=>M&&Object.assign({},M.cam);
window.map3dFit=()=>{ if(!M) return; unfocus(); };
window.map3dFocus=name=>{ if(!M) return; const B=M.blds.find(b=>b.name===name); if(B){ M.canvas.scrollIntoView({behavior:REDUCED?'auto':'smooth',block:'center'}); focus(B,false); } };
})();
