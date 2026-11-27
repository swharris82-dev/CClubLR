/* App-wide motion: KPI and stat numbers count up when a screen draws,
   dashboard bars grow from the baseline, and screens ease in.
   Everything here is decoration; it never changes data. */
(function(){
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var st=document.createElement('style');
  st.textContent=
    '#trendWrap svg path{transform-box:fill-box;transform-origin:50% 100%;animation:ciqGrow .7s cubic-bezier(.2,.9,.25,1) both}'+
    '#trendWrap svg path:nth-of-type(2n){animation-delay:.06s}'+
    '.kpi,.stats .stat{animation:ciqRise .45s cubic-bezier(.2,.9,.3,1) both}'+
    '.kpis .kpi:nth-child(2){animation-delay:.05s}.kpis .kpi:nth-child(3){animation-delay:.1s}.kpis .kpi:nth-child(4){animation-delay:.15s}'+
    '.kpis .kpi:nth-child(n+5){animation-delay:.2s}'+
    '.kpi.bad{position:relative}.kpi.bad::after{content:"";position:absolute;top:12px;right:12px;width:8px;height:8px;border-radius:50%;background:var(--rose);animation:ciqPing 1.6s ease-out infinite}'+
    '@keyframes ciqGrow{from{transform:scaleY(0)}}@keyframes ciqRise{from{opacity:0;transform:translateY(8px)}}'+
    '@keyframes ciqPing{0%{box-shadow:0 0 0 0 rgba(184,50,42,.5)}100%{box-shadow:0 0 0 9px rgba(184,50,42,0)}}'+
    '@media(prefers-reduced-motion:reduce){#trendWrap svg path,.kpi,.stats .stat,.kpi.bad::after{animation:none}}';
  document.head.appendChild(st);
  if(reduce)return;

  // Count a number up from zero, keeping any $ , % or words around it.
  function countUp(el){
    if(el.dataset.cu)return;el.dataset.cu='1';
    var txt=el.textContent,m=txt.match(/-?[\d,]+(\.\d+)?/);if(!m)return;
    var raw=m[0],target=parseFloat(raw.replace(/,/g,''));if(!isFinite(target)||target===0)return;
    var dec=(raw.split('.')[1]||'').length,comma=raw.indexOf(',')>=0||Math.abs(target)>=10000,pre=txt.slice(0,m.index),post=txt.slice(m.index+raw.length);
    var t0=performance.now(),D=Math.min(1100,450+Math.log10(Math.abs(target)+1)*180);
    function fmt(v){var s=v.toFixed(dec);if(comma){var p=s.split('.');p[0]=Number(p[0]).toLocaleString('en-US');s=p.join('.')}return s}
    (function f(now){var k=Math.min(1,(now-t0)/D),e=1-Math.pow(1-k,3);el.textContent=pre+fmt(target*e)+post;if(k<1)requestAnimationFrame(f);else el.textContent=txt})(t0);
  }
  function scan(root){
    if(!root.querySelectorAll)return;
    root.querySelectorAll('.kpi .n,.stats .stat .n').forEach(countUp);
  }
  new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1){if(n.matches&&n.matches('.kpi .n,.stats .stat .n'))countUp(n);scan(n)}})})})
    .observe(document.documentElement,{childList:true,subtree:true});
})();
