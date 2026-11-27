/* Startup animation: the club crest reveal.
   Loaded as the first thing in <body> so it covers the app before anything
   paints. Plays once per browser session (tap to skip). Tap the crest in the
   header to replay it. Honors reduced motion with a short fade. */
(function(){
  var css=
  '#ciqSplash{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;'+
    'background:radial-gradient(120% 90% at 50% 42%,#21457a 0%,#14294a 46%,#081429 100%);color:#fff;overflow:hidden;cursor:pointer;'+
    'transition:opacity .6s ease,transform .6s ease,filter .6s ease}'+
  '#ciqSplash.out{opacity:0;transform:scale(1.04);filter:blur(6px);pointer-events:none}'+
  '#ciqSplash .sp-rays{position:absolute;left:50%;top:42%;width:1400px;height:1400px;margin:-700px 0 0 -700px;opacity:0;'+
    'background:repeating-conic-gradient(from 0deg,rgba(220,194,124,.07) 0 4deg,transparent 4deg 15deg);'+
    '-webkit-mask:radial-gradient(circle,#000 0,transparent 62%);mask:radial-gradient(circle,#000 0,transparent 62%);animation:spRays 9s linear infinite,spFade 1.2s .5s ease forwards}'+
  '#ciqSplash .sp-stage{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center}'+
  '#ciqSplash .sp-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible}'+
  '#ciqSplash .sp-ring circle{fill:none;stroke-linecap:round}'+
  '#ciqSplash .sp-r1{stroke:#DCC27C;stroke-width:1.6;stroke-dasharray:691;stroke-dashoffset:691;animation:spDraw 1.1s .1s cubic-bezier(.6,0,.2,1) forwards}'+
  '#ciqSplash .sp-r2{stroke:#B8963E;stroke-width:1;opacity:.7;stroke-dasharray:4 7;transform-origin:120px 120px;animation:spSpin 14s linear infinite,spFade .8s .5s both}'+
  '#ciqSplash .sp-r2{opacity:0}'+
  '#ciqSplash .sp-ticks line{stroke:#DCC27C;stroke-width:2;stroke-linecap:round;opacity:0;animation:spTick .4s ease forwards}'+
  '#ciqSplash .sp-glow{position:absolute;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,rgba(220,194,124,.45),rgba(220,194,124,0) 65%);opacity:0;animation:spGlow 2.2s .7s ease-in-out forwards}'+
  '#ciqSplash .sp-crest{position:relative;height:168px;width:auto;aspect-ratio:240/382;opacity:0;transform:translateY(18px) scale(.62);filter:blur(10px) drop-shadow(0 10px 18px rgba(0,0,0,.45));'+
    'animation:spCrest 1.05s .45s cubic-bezier(.2,1.3,.35,1) forwards}'+
  '#ciqSplash .sp-crest img{display:block;width:100%;height:100%}'+
  '#ciqSplash .sp-shine{position:absolute;inset:0;-webkit-mask:url(/crest.png) center/contain no-repeat;mask:url(/crest.png) center/contain no-repeat;'+
    'background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.85) 50%,transparent 62%) no-repeat;background-size:260% 100%;background-position:130% 0;animation:spShine 1s 1.45s ease-in-out forwards}'+
  '#ciqSplash .sp-word{margin-top:26px;font-family:"Libre Caslon Text",Georgia,serif;font-size:38px;letter-spacing:.5px;white-space:nowrap;line-height:1}'+
  '#ciqSplash .sp-word span{display:inline-block;opacity:0;transform:translateY(14px);animation:spUp .55s cubic-bezier(.2,.9,.3,1) forwards}'+
  '#ciqSplash .sp-word em{font-style:italic;color:#DCC27C;font-weight:700}'+
  '#ciqSplash .sp-rule{height:1.5px;width:0;margin:16px auto 12px;background:linear-gradient(90deg,transparent,#DCC27C,transparent);animation:spRule .8s 1.75s ease forwards}'+
  '#ciqSplash .sp-sub{font-family:Figtree,system-ui,sans-serif;font-size:11.5px;font-weight:700;color:#a9bdd6;text-transform:uppercase;letter-spacing:.7em;opacity:0;animation:spSub .9s 1.9s ease forwards;text-align:center;padding:0 16px}'+
  '#ciqSplash .sp-skip{position:absolute;bottom:calc(22px + env(safe-area-inset-bottom,0px));font:600 12px Figtree,system-ui,sans-serif;color:#6f86a6;opacity:0;animation:spFade .6s 1.2s forwards}'+
  '@keyframes spDraw{to{stroke-dashoffset:0}}@keyframes spSpin{to{transform:rotate(360deg)}}@keyframes spRays{to{transform:rotate(360deg)}}'+
  '@keyframes spFade{to{opacity:1}}@keyframes spTick{from{opacity:0}to{opacity:.85}}'+
  '@keyframes spGlow{0%{opacity:0;transform:scale(.6)}45%{opacity:1;transform:scale(1.08)}100%{opacity:.55;transform:scale(1)}}'+
  '@keyframes spCrest{60%{filter:blur(0) drop-shadow(0 10px 18px rgba(0,0,0,.45))}to{opacity:1;transform:none;filter:blur(0) drop-shadow(0 10px 18px rgba(0,0,0,.45))}}'+
  '@keyframes spShine{to{background-position:-30% 0}}@keyframes spUp{to{opacity:1;transform:none}}'+
  '@keyframes spRule{to{width:220px}}@keyframes spSub{to{opacity:1;letter-spacing:.28em}}'+
  '@media(prefers-reduced-motion:reduce){#ciqSplash *{animation-duration:.01s!important;animation-delay:0s!important}}';

  function build(){
    var st=document.getElementById('ciqSplashCss');
    if(!st){st=document.createElement('style');st.id='ciqSplashCss';st.textContent=css;document.head.appendChild(st)}
    var ticks='';for(var i=0;i<24;i++){var a=i*15*Math.PI/180,r1=i%2?108:104,r2=116;
      ticks+='<line x1="'+(120+r1*Math.sin(a)).toFixed(1)+'" y1="'+(120-r1*Math.cos(a)).toFixed(1)+'" x2="'+(120+r2*Math.sin(a)).toFixed(1)+'" y2="'+(120-r2*Math.cos(a)).toFixed(1)+'" style="animation-delay:'+(.25+i*.03).toFixed(2)+'s"/>'}
    var word='Clubhouse'.split('').map(function(c,i){return '<span style="animation-delay:'+(1.05+i*.045).toFixed(2)+'s">'+c+'</span>'}).join('')+
      '<span style="animation-delay:1.5s">&nbsp;</span><span style="animation-delay:1.55s"><em>IQ</em></span>';
    var d=document.createElement('div');d.id='ciqSplash';d.setAttribute('role','presentation');d.setAttribute('aria-hidden','true');
    d.innerHTML='<div class="sp-rays"></div><div class="sp-stage"><div class="sp-glow"></div>'+
      '<svg class="sp-ring" viewBox="0 0 240 240"><circle class="sp-r1" cx="120" cy="120" r="110" transform="rotate(-90 120 120)"/><circle class="sp-r2" cx="120" cy="120" r="98"/><g class="sp-ticks">'+ticks+'</g></svg>'+
      '<div class="sp-crest"><img src="/crest.png" alt=""><div class="sp-shine"></div></div></div>'+
      '<div class="sp-word">'+word+'</div><div class="sp-rule"></div><div class="sp-sub">Country Club of Little Rock · Est. 1902</div>'+
      '<div class="sp-skip">Tap to continue</div>';
    return d;
  }
  function play(force){
    var seen=false;try{seen=sessionStorage.getItem('ciq_splash')==='1'}catch(e){}
    if(seen&&!force)return;
    try{sessionStorage.setItem('ciq_splash','1')}catch(e){}
    var old=document.getElementById('ciqSplash');if(old)old.remove();
    var d=build(),done=false,reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    function end(){if(done)return;done=true;d.classList.add('out');setTimeout(function(){d.remove()},650)}
    d.addEventListener('click',end);
    (document.body||document.documentElement).appendChild(d);
    setTimeout(end,reduce?700:3300);
  }
  window.ciqSplash=play;
  play(false);
  document.addEventListener('DOMContentLoaded',function(){
    var b=document.querySelector('header .brand img');
    if(b){b.style.cursor='pointer';b.title='Replay intro';b.addEventListener('click',function(){play(true)})}
  });
})();
