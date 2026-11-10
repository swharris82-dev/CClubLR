/* Clubhouse IQ live video diagnosis.
   The phone's camera and microphone stream straight to Gemini Live over a
   WebSocket. The server only hands out a short single-use pass and the
   instructions for the call (built from the equipment record). The AI talks
   back out loud, with captions, and the call can be saved to history. */
(function(){
  const L = { ws:null, stream:null, el:null, ac:null, outAc:null, node:null, src:null, frameT:null, tickT:null,
              pass:null, handle:null, ready:false, ended:true, muted:false, facing:'environment', torch:false,
              lines:[], cur:{tech:null, ai:null}, playAt:0, playing:[], started:0, retries:0, wake:null, apt:null };

  const ICON = {
    mic:'<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/></svg>',
    micOff:'<svg viewBox="0 0 24 24"><path d="M15 9.500V6a3 3 0 0 0-5.800-1M9 9v2a3 3 0 0 0 4.700 2.500M5.500 11.500a6.500 6.500 0 0 0 10.300 5.300M18.500 11.500c0 .900-.200 1.800-.500 2.600M12 18v3M4 4l16 16"/></svg>',
    flip:'<svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 14-3l2 2.500M20 4v4.500h-4.500M20 15a8 8 0 0 1-14 3l-2-2.500M4 20v-4.500h4.500"/></svg>',
    torch:'<svg viewBox="0 0 24 24"><path d="M8 3h8v3l-2 3v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V9L8 6zM8 6h8M12 12v2.500"/></svg>',
    end:'<svg viewBox="0 0 24 24"><path d="M3.500 14.500c5-4.700 12-4.700 17 0l-2.300 2.300-3-1.300v-2.700a9 9 0 0 0-6.400 0v2.700l-3 1.300z"/></svg>'
  };
  const T = s => (window.LANG==='es' && window.ES_DICT && window.ES_DICT[s]) || s;

  function b64FromBytes(u8){ let s=''; const n=0x8000; for(let i=0;i<u8.length;i+=n) s+=String.fromCharCode.apply(null,u8.subarray(i,i+n)); return btoa(s); }
  function bytesFromB64(b){ const s=atob(b), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; }

  /* ---------- screen ---------- */
  function build(){
    const d=document.createElement('div'); d.className='live'; d.id='liveView';
    d.innerHTML=
      '<video playsinline muted autoplay></video>'+
      '<div class="live-top"><div class="eq" data-noi18n><span id="lvEq"></span><small id="lvSub"></small></div>'+
        '<span class="live-state" id="lvState"><i></i><span id="lvStateT">Connecting</span></span></div>'+
      '<div class="live-mid"><div class="live-wait" id="lvWait"><span class="spin"></span><div id="lvWaitT">Starting the camera</div></div></div>'+
      '<div class="live-bot">'+
        '<div class="live-caps" id="lvCaps" data-noi18n aria-live="polite"></div>'+
        '<div class="live-meter"><i id="lvMeter"></i></div>'+
        '<div class="live-say"><input type="text" id="lvText" placeholder="Type instead of talking" enterkeyhint="send"><button id="lvSend">Send</button></div>'+
        '<div class="live-ctl">'+
          '<button id="lvMic" aria-label="Mute microphone">'+ICON.mic+'</button>'+
          '<button id="lvFlip" aria-label="Switch camera">'+ICON.flip+'</button>'+
          '<button id="lvTorch" class="hide" aria-label="Flashlight">'+ICON.torch+'</button>'+
          '<button class="end" id="lvEnd">'+ICON.end+'<span>End</span></button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(d); document.body.style.overflow='hidden';
    L.el=d;
    d.querySelector('#lvEnd').onclick=()=>endLive(true);
    d.querySelector('#lvMic').onclick=toggleMic;
    d.querySelector('#lvFlip').onclick=flipCamera;
    d.querySelector('#lvTorch').onclick=toggleTorch;
    d.querySelector('#lvSend').onclick=sendTyped;
    d.querySelector('#lvText').addEventListener('keydown',e=>{ if(e.key==='Enter') sendTyped(); });
    const u=UNIT;
    d.querySelector('#lvEq').textContent = u ? u.apt : T('Live diagnosis');
    d.querySelector('#lvSub').textContent = u ? [u.building,u.system_type].filter(Boolean).join(', ') : T('No equipment open');
  }
  const q = id => L.el && L.el.querySelector('#'+id);
  function state(text, cls){ const s=q('lvState'); if(!s) return; s.className='live-state'+(cls?' '+cls:''); q('lvStateT').textContent=text; }
  function wait(text){ const w=q('lvWait'); if(!w) return; if(!text){ w.classList.add('hide'); return; }
    w.classList.remove('hide'); w.innerHTML='<span class="spin"></span><div>'+esc(text)+'</div>'; }
  function fail(text){
    stopMedia(false);
    const w=q('lvWait'); if(!w) return;
    w.classList.remove('hide');
    w.innerHTML='<div style="font-size:19px;font-weight:800">'+esc(T('Live video stopped'))+'</div><div class="err" data-noi18n>'+esc(text)+'</div>'+
      '<div class="row" style="max-width:320px;width:100%;margin-top:6px"><button class="btn-2" id="lvClose">Close</button>'+
      (L.lines.length?'<button class="btn" id="lvKeep">Save what we have</button>':'')+'</div>';
    w.querySelector('#lvClose').onclick=()=>endLive(false);
    const k=w.querySelector('#lvKeep'); if(k) k.onclick=()=>endLive(true);
    state(T('Ended'));
  }

  /* ---------- captions ---------- */
  function caption(who, text, done){
    if(!text && !done) return;
    let c=L.cur[who];
    if(!c && text){
      c={who, text:'', el:document.createElement('div')}; c.el.className='cap '+who;
      const box=q('lvCaps'); if(box){ box.appendChild(c.el); while(box.children.length>14) box.removeChild(box.firstChild); }
      L.cur[who]=c; L.lines.push(c);
    }
    if(c && text){ c.text+=text; c.el.textContent=c.text.trim(); const box=q('lvCaps'); if(box) box.scrollTop=box.scrollHeight; }
    if(done) L.cur[who]=null;
  }

  /* ---------- start ---------- */
  window.startLive = async function(){
    if(!L.ended) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.WebSocket){
      alert(T('This browser cannot do live video. Open the app in Chrome or Safari.')); return; }
    if(!navigator.onLine){ alert(T('Live video needs a signal. Use the written diagnosis until you are back online.')); return; }
    Object.assign(L,{ended:false, ready:false, lines:[], cur:{tech:null,ai:null}, handle:null, retries:0, muted:false, torch:false, apt:UNIT?UNIT.apt:null});
    build();
    try{
      // Audio contexts have to be created inside the tap that started this.
      const AC=window.AudioContext||window.webkitAudioContext;
      L.ac=new AC(); L.outAc=new AC({sampleRate:24000});
      await openCamera();
    }catch(e){
      const n=e&&e.name;
      fail(n==='NotAllowedError'||n==='SecurityError' ? T('The camera or microphone is blocked. Allow both for this app in your phone settings, then try again.')
         : n==='NotFoundError' ? T('No camera or microphone was found on this device.')
         : T('Could not start the camera.')+' '+(e&&e.message||''));
      return;
    }
    wait(T('Connecting to the diagnostic assistant'));
    try{
      L.pass=await api('/live/token',{method:'POST',body:{apt:L.apt, note:($('reportIn')&&$('reportIn').value.trim())||''}});
    }catch(e){ fail(e.message); return; }
    connect();
    try{ if(navigator.wakeLock) L.wake=await navigator.wakeLock.request('screen'); }catch(e){}
  };

  async function openCamera(){
    const want={ audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},
                 video:{facingMode:{ideal:L.facing},width:{ideal:1280},height:{ideal:720}} };
    const old=L.stream;
    let s;
    if(old){ // switching cameras: keep the microphone, swap the picture
      old.getVideoTracks().forEach(t=>t.stop());
      const v=await navigator.mediaDevices.getUserMedia({video:want.video});
      s=new MediaStream([...old.getAudioTracks(), ...v.getVideoTracks()]);
    } else s=await navigator.mediaDevices.getUserMedia(want);
    L.stream=s;
    const vid=L.el.querySelector('video'); vid.srcObject=s; vid.play().catch(()=>{});
    const vt=s.getVideoTracks()[0];
    const caps=vt&&vt.getCapabilities?vt.getCapabilities():{};
    const tb=q('lvTorch'); if(tb){ tb.classList.toggle('hide',!caps.torch); tb.classList.remove('lit'); L.torch=false; }
    if(!old) await startMic();
  }

  /* ---------- microphone: 16 kHz, 16-bit, sent about 8 times a second ---------- */
  async function startMic(){
    const ac=L.ac; if(ac.state==='suspended') await ac.resume();
    L.src=ac.createMediaStreamSource(new MediaStream(L.stream.getAudioTracks()));
    const ratio=ac.sampleRate/16000;
    let carry=new Float32Array(0);
    const push=f32=>{
      if(!L.ready||L.muted||!L.ws||L.ws.readyState!==1) { carry=new Float32Array(0); return; }
      const all=new Float32Array(carry.length+f32.length); all.set(carry); all.set(f32,carry.length);
      const n=Math.floor(all.length/ratio); if(n<=0){ carry=all; return; }
      const out=new Int16Array(n); let peak=0;
      for(let i=0;i<n;i++){
        const a=Math.floor(i*ratio), b=Math.min(all.length,Math.floor((i+1)*ratio)); let s=0;
        for(let j=a;j<b;j++) s+=all[j];
        const v=Math.max(-1,Math.min(1,s/Math.max(1,b-a))); out[i]=v<0?v*0x8000:v*0x7FFF; if(Math.abs(v)>peak) peak=Math.abs(v);
      }
      carry=all.slice(Math.floor(n*ratio));
      const m=q('lvMeter'); if(m) m.style.width=Math.min(100,Math.round(peak*240))+'%';
      send({realtimeInput:{audio:{data:b64FromBytes(new Uint8Array(out.buffer)),mimeType:'audio/pcm;rate=16000'}}});
    };
    let worklet=false;
    if(ac.audioWorklet){
      try{
        const code='class P extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0;}process(i){const c=i[0]&&i[0][0];if(c){this.b.push(c.slice(0));this.n+=c.length;if(this.n>=2048){const o=new Float32Array(this.n);let k=0;for(const x of this.b){o.set(x,k);k+=x.length;}this.port.postMessage(o,[o.buffer]);this.b=[];this.n=0;}}return true;}}registerProcessor("ciq-mic",P);';
        const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
        await ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        L.node=new AudioWorkletNode(ac,'ciq-mic',{numberOfInputs:1,numberOfOutputs:0});
        L.node.port.onmessage=e=>push(e.data);
        L.src.connect(L.node); worklet=true;
      }catch(e){ worklet=false; }
    }
    if(!worklet){
      L.node=ac.createScriptProcessor(4096,1,1);
      L.node.onaudioprocess=e=>push(new Float32Array(e.inputBuffer.getChannelData(0)));
      const mute=ac.createGain(); mute.gain.value=0;
      L.src.connect(L.node); L.node.connect(mute); mute.connect(ac.destination);
    }
  }

  /* ---------- camera frames: one a second ---------- */
  function startFrames(){
    clearInterval(L.frameT);
    const cv=document.createElement('canvas'), ctx=cv.getContext('2d');
    L.frameT=setInterval(()=>{
      if(!L.ready||!L.ws||L.ws.readyState!==1||L.ws.bufferedAmount>600000) return;
      const v=L.el&&L.el.querySelector('video'); if(!v||!v.videoWidth) return;
      const sc=Math.min(1,768/Math.max(v.videoWidth,v.videoHeight));
      cv.width=Math.round(v.videoWidth*sc); cv.height=Math.round(v.videoHeight*sc);
      ctx.drawImage(v,0,0,cv.width,cv.height);
      const d=cv.toDataURL('image/jpeg',.62);
      send({realtimeInput:{video:{data:d.slice(d.indexOf(',')+1),mimeType:'image/jpeg'}}});
    },1000);
  }

  /* ---------- connection ---------- */
  function send(o){ try{ if(L.ws&&L.ws.readyState===1) L.ws.send(JSON.stringify(o)); }catch(e){} }

  function connect(){
    const p=L.pass, resume=!!L.handle;
    let ws;
    try{ ws=new WebSocket(p.url+'?access_token='+encodeURIComponent(p.token)); }
    catch(e){ fail(T('Could not open the live connection.')+' '+e.message); return; }
    L.ws=ws; L.ready=false;
    ws.onopen=()=>{
      const setup=JSON.parse(JSON.stringify(p.setup));
      if(resume) setup.sessionResumption={handle:L.handle};
      ws.send(JSON.stringify({setup}));
    };
    ws.onmessage=async ev=>{
      let txt=ev.data;
      if(typeof txt!=='string'){ try{ txt=await (txt.text?txt.text():new Response(txt).text()); }catch(e){ return; } }
      let m; try{ m=JSON.parse(txt); }catch(e){ return; }
      if(ws!==L.ws) return;
      onServer(m, resume);
    };
    ws.onerror=()=>{};
    ws.onclose=ev=>{
      if(ws!==L.ws||L.ended) return;
      L.ready=false;
      const age=(Date.now()-L.started)/60000;
      if(L.handle && L.started && age<(p.minutes||30)-1 && L.retries<4){
        L.retries++; state(T('Reconnecting')); setTimeout(()=>{ if(!L.ended) connect(); },600); return;
      }
      const why=(ev.reason||'').trim();
      fail(!L.started
        ? T('The live service did not accept the connection.')+(why?' '+why:'')+' '+T('A manager can run Check AI connection from the More menu.')
        : age>=(p.minutes||30)-1 ? T('This call reached its time limit. Start a new one to keep going.')
        : T('The connection dropped.')+(why?' '+why:''));
    };
  }

  function onServer(m, resumed){
    if(m.setupComplete){
      L.ready=true; L.retries=0; wait(null); state(T('Live'),'on');
      startFrames();
      if(!L.started){
        L.started=Date.now();
        clearInterval(L.tickT);
        send({realtimeInput:{text: window.LANG==='es'
          ? 'La llamada acaba de empezar. Saluda en una frase corta y pregunta qué está viendo el técnico.'
          : 'The call just started. Greet in one short sentence and ask what the tech is looking at.'}});
      }
      return;
    }
    if(m.sessionResumptionUpdate){ const u=m.sessionResumptionUpdate; if(u.resumable&&u.newHandle) L.handle=u.newHandle; }
    if(m.goAway && L.handle){ try{ L.ws.close(); }catch(e){} return; }
    const sc=m.serverContent; if(!sc) return;
    if(sc.interrupted){ stopPlayback(); caption('ai','',true); }
    if(sc.inputTranscription&&sc.inputTranscription.text){ caption('ai','',true); caption('tech',sc.inputTranscription.text); }
    if(sc.outputTranscription&&sc.outputTranscription.text){ caption('tech','',true); caption('ai',sc.outputTranscription.text); }
    const parts=(sc.modelTurn&&sc.modelTurn.parts)||[];
    parts.forEach(pt=>{
      const d=pt.inlineData;
      if(d&&d.data&&/^audio\//.test(d.mimeType||'audio/pcm')) play(d.data,d.mimeType);
    });
    if(sc.turnComplete){ caption('ai','',true); caption('tech','',true); }
  }

  /* ---------- the AI's voice ---------- */
  function play(b64, mime){
    const ac=L.outAc; if(!ac) return;
    if(ac.state==='suspended') ac.resume();
    const rate=+((/rate=(\d+)/.exec(mime||'')||[])[1])||24000;
    const u8=bytesFromB64(b64), n=u8.length>>1, dv=new DataView(u8.buffer);
    if(!n) return;
    const buf=ac.createBuffer(1,n,rate), ch=buf.getChannelData(0);
    for(let i=0;i<n;i++) ch[i]=dv.getInt16(i*2,true)/32768;
    const s=ac.createBufferSource(); s.buffer=buf; s.connect(ac.destination);
    const at=Math.max(ac.currentTime+.03,L.playAt); s.start(at); L.playAt=at+buf.duration;
    L.playing.push(s); state(T('Speaking'),'on talk');
    s.onended=()=>{ L.playing=L.playing.filter(x=>x!==s); if(!L.playing.length&&L.ready) state(T('Live'),'on'); };
  }
  function stopPlayback(){ L.playing.forEach(s=>{ try{ s.onended=null; s.stop(); }catch(e){} }); L.playing=[]; L.playAt=0; if(L.ready) state(T('Live'),'on'); }

  /* ---------- controls ---------- */
  function toggleMic(){
    L.muted=!L.muted; const b=q('lvMic'); b.classList.toggle('off',L.muted); b.innerHTML=L.muted?ICON.micOff:ICON.mic;
    if(L.muted){ send({realtimeInput:{audioStreamEnd:true}}); const m=q('lvMeter'); if(m) m.style.width='0'; }
  }
  async function flipCamera(){
    L.facing=L.facing==='environment'?'user':'environment';
    try{ await openCamera(); }catch(e){ L.facing=L.facing==='environment'?'user':'environment'; try{ await openCamera(); }catch(e2){} }
  }
  async function toggleTorch(){
    const vt=L.stream&&L.stream.getVideoTracks()[0]; if(!vt) return;
    try{ L.torch=!L.torch; await vt.applyConstraints({advanced:[{torch:L.torch}]}); q('lvTorch').classList.toggle('lit',L.torch); }catch(e){ L.torch=false; }
  }
  function sendTyped(){
    const i=q('lvText'), t=i.value.trim(); if(!t||!L.ready) return;
    i.value=''; stopPlayback(); caption('ai','',true); caption('tech','',true); caption('tech',t,true);
    send({realtimeInput:{text:t}});
  }

  /* ---------- end ---------- */
  function stopMedia(removeView){
    L.ended=true; L.ready=false;
    clearInterval(L.frameT); clearInterval(L.tickT);
    try{ if(L.ws){ const w=L.ws; L.ws=null; w.close(); } }catch(e){}
    stopPlayback();
    try{ if(L.node){ L.node.disconnect(); if(L.node.port) L.node.port.onmessage=null; } if(L.src) L.src.disconnect(); }catch(e){}
    if(L.stream){ L.stream.getTracks().forEach(t=>t.stop()); L.stream=null; }
    try{ if(L.ac) L.ac.close(); if(L.outAc) L.outAc.close(); }catch(e){}
    L.ac=L.outAc=L.node=L.src=null; L.started=0;
    try{ if(L.wake){ L.wake.release(); L.wake=null; } }catch(e){}
    if(removeView&&L.el){ L.el.remove(); L.el=null; document.body.style.overflow=''; }
  }
  function endLive(offerSave){
    const lines=L.lines.map(l=>({who:l.who,text:l.text.trim()})).filter(l=>l.text);
    stopMedia(true);
    if(offerSave && lines.filter(l=>l.who==='ai').length && lines.map(l=>l.text).join(' ').length>80) liveSummary(lines);
  }
  window.endLive=endLive;
  document.addEventListener('visibilitychange',()=>{ if(document.hidden&&!L.ended&&L.ready){ L.muted||toggleMic(); } });

  /* ---------- after the call: draft a history entry ---------- */
  async function liveSummary(lines){
    const apt=L.apt;
    const convo='<details style="margin-top:14px"><summary class="dim">'+esc(T('What was said'))+'</summary><div data-noi18n style="margin-top:8px;font-size:14px;line-height:1.5">'+
      lines.map(l=>'<div style="margin-bottom:7px"><b style="color:'+(l.who==='ai'?'var(--ice)':'var(--sulfur)')+'">'+(l.who==='ai'?'AI':esc(ME.name.split(' ')[0]))+'</b> '+esc(l.text)+'</div>').join('')+'</div></details>';
    sheet(T('Call summary'), apt||'', '<div class="panel"><span class="spin" style="border-color:var(--edge);border-top-color:var(--ice)"></span>'+esc(T('Writing up the call'))+'</div>'+convo);
    let s=null, err='';
    try{ s=(await api('/live/summary',{method:'POST',body:{transcript:lines,apt}})).summary; }catch(e){ err=e.message; }
    if(!$('sheetBg')) return;
    s=s||{};
    const f=(id,label,val,area)=>'<label class="fl">'+label+'</label>'+(area?'<textarea id="'+id+'" data-noi18n>'+esc(val||'')+'</textarea>':'<input type="text" id="'+id+'" data-noi18n value="'+esc(val||'')+'">');
    let h='<div class="panel">';
    if(err) h+='<div class="note n-safe"><b>Could not write the summary</b><span data-noi18n>'+esc(err)+'</span></div>';
    h+=f('lsRep','What was reported',s.reported)+f('lsDx','Cause found',s.diagnosis,true)+
       f('lsWork','What you did',[s.work_performed,s.follow_up?('Follow-up: '+s.follow_up):''].filter(Boolean).join(' '),true)+
       '<div class="row"><div>'+f('lsCode','Fault code',s.error_code)+'</div><div>'+f('lsParts','Parts',s.parts)+'</div></div>'+
       '<div class="row"><div><label class="fl">Vendor cost avoided</label><input type="number" id="lsCost" placeholder="0"></div>'+
       '<div><label class="fl">Hours</label><input type="number" step=".25" id="lsHrs" placeholder="0"></div></div>';
    if(apt) h+='<button class="btn full" style="margin-top:14px" id="lsSave">Save to history</button>';
    else h+='<div class="note n-sys" style="margin-top:14px"><b>No equipment was open</b>Open the equipment and start the call from there to save calls to its history.</div>'+
            '<button class="btn-2 full" id="lsCopy">Copy summary</button>';
    h+='<div class="dim" id="lsMsg" style="margin-top:9px"></div></div>'+convo;
    $('sheetBg').querySelector('.sheet-bd').innerHTML=h;
    const val=id=>($(id)&&$(id).value.trim())||'';
    if($('lsSave')) $('lsSave').onclick=async()=>{
      $('lsSave').disabled=true;
      try{
        const d=await api('/unit/'+encodeURIComponent(apt)+'/job',{method:'POST',body:{
          job_date:today(), reported:val('lsRep'), priority:s.priority||'normal', category:'HVAC',
          diagnosis:val('lsDx'), work_performed:val('lsWork'), parts_used:val('lsParts'), error_code:val('lsCode'),
          vendor_cost_avoided:val('lsCost')||0, hours:val('lsHrs')||0, cost_basis:'Live video diagnosis',
          triage_json:{live:true,transcript:lines.slice(-60)} }});
        if(UNIT&&UNIT.apt===apt){ UNIT=d.unit; drawHistory(); drawPlate(); loadBrief(); }
        closeSheet(); toast('Saved to '+apt);
      }catch(e){ $('lsMsg').innerHTML='<span style="color:var(--rose)">'+esc(e.message)+'</span>'; $('lsSave').disabled=false; }
    };
    if($('lsCopy')) $('lsCopy').onclick=()=>copyText(['Reported: '+val('lsRep'),'Cause: '+val('lsDx'),'Work: '+val('lsWork'),val('lsCode')?'Code: '+val('lsCode'):'',val('lsParts')?'Parts: '+val('lsParts'):''].filter(Boolean).join('\n'));
  }

  /* ---------- AI connection check (managers) ---------- */
  window.aiCheck = async function(){
    sheet('AI connection','', '<div class="panel"><span class="spin" style="border-color:var(--edge);border-top-color:var(--ice)"></span>Testing each AI service</div>');
    let d;
    try{ d=await api('/ai/status'); }catch(e){ d={error:e.message}; }
    if(!$('sheetBg')) return;
    let h='<div class="panel">';
    if(d.error) h+='<div class="note n-safe"><b>Check failed</b><span data-noi18n>'+esc(d.error)+'</span></div>';
    else{
      h+='<div class="ai-row"><span class="dot '+(d.ready?'ok':'bad')+'"></span><div><div class="t">Written diagnosis, plate reader, briefs</div><div class="m">'+
           (d.ready?'Ready.':'Not working. At least one service below has to pass.')+'</div></div></div>'+
         '<div class="ai-row"><span class="dot '+(d.live?((d.services.find(x=>x.id==='gemini')||{}).ok?'ok':'bad'):'bad')+'"></span><div><div class="t">Live video diagnosis</div><div class="m">'+
           (d.live?'Uses Google Gemini.':'Needs a Google Gemini key. Add GEMINI_API_KEY in the hosting settings.')+'</div></div></div>';
      (d.services||[]).forEach(s=>{
        h+='<div class="ai-row"><span class="dot '+(s.ok?'ok':s.configured?'bad':'')+'"></span><div><div class="t" data-noi18n>'+esc(s.name)+'</div><div class="m" data-noi18n>'+esc(s.message)+'</div></div></div>';
      });
    }
    h+='</div><div class="panel"><div class="eyebrow">Where the keys go</div><div class="mid">Keys are set on the hosting service (Render, Environment), never in the app. GEMINI_API_KEY comes from aistudio.google.com. ANTHROPIC_API_KEY comes from console.anthropic.com. One is enough for written diagnosis. Live video needs the Gemini key.</div></div>';
    $('sheetBg').querySelector('.sheet-bd').innerHTML=h;
  };
  /* ---------- backup and restore (admin) ---------- */
  window.dataSheet = function(){
    sheet('Back up data','', '<div class="panel"><div class="eyebrow">Download a backup</div>'+
      '<div class="mid" style="margin-bottom:12px">Saves every piece of equipment, work order, PM task, part, vendor, and account into one file. Keep a copy somewhere safe.</div>'+
      '<button class="btn full" id="bkGet">Download backup file</button><div class="dim" id="bkMsg" style="margin-top:9px"></div></div>'+
      '<div class="panel"><div class="eyebrow">Restore from a backup</div>'+
      '<div class="mid" style="margin-bottom:12px">Use this to move the app to a new host. It replaces everything on this server with what is in the file, then the app restarts.</div>'+
      '<input type="file" id="bkFile" accept=".db,.sqlite,application/octet-stream"><button class="btn-2 full" style="margin-top:10px" id="bkPut">Restore this file</button>'+
      '<div class="dim" id="bkMsg2" style="margin-top:9px"></div></div>');
    $('bkGet').onclick=async()=>{
      $('bkMsg').textContent='Preparing the file';
      try{
        const r=await fetch('/api/admin/backup',{headers:{Authorization:'Bearer '+TOKEN}});
        if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||'Backup failed');
        const a=document.createElement('a'); a.href=URL.createObjectURL(await r.blob());
        a.download='clubhouse-iq-backup-'+today()+'.db'; document.body.appendChild(a); a.click(); a.remove();
        $('bkMsg').textContent='Downloaded.';
      }catch(e){ $('bkMsg').innerHTML='<span style="color:var(--rose)">'+esc(e.message)+'</span>'; }
    };
    $('bkPut').onclick=async()=>{
      const f=$('bkFile').files[0]; if(!f){ $('bkMsg2').textContent='Pick the backup file first.'; return; }
      if(!confirm('Replace everything on this server with the backup file? This cannot be undone.')) return;
      $('bkMsg2').textContent='Uploading';
      try{
        const r=await fetch('/api/admin/restore',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/octet-stream'},body:f});
        const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Restore failed');
        $('bkMsg2').textContent='Restored. The app is restarting. Sign in again in about a minute.';
        setTimeout(()=>{ try{ localStorage.removeItem('ciq_token'); }catch(e){} location.reload(); },9000);
      }catch(e){ $('bkMsg2').innerHTML='<span style="color:var(--rose)">'+esc(e.message)+'</span>'; }
    };
  };
})();
