'use strict';
(function(){
  if(window.__etai4) return; window.__etai4=true;
  const TTSMAP={L001:'hi-IN',L002:'mr-IN',L003:'gu-IN',L004:'ta-IN',L005:'te-IN'};
  let lang='hi-IN', showBar=true;

  chrome.storage.local.get(['et_uid4','et_db4'],d=>{
    const db=d.et_db4, uid=d.et_uid4;
    if(!db) return;
    if(uid){
      const u=db.USER.find(u=>u.user_id===uid);
      const s=db.SETTINGS.find(s=>s.user_id===uid);
      if(u){ const l=db.LANGUAGE.find(l=>l.lang_id===u.preferred_lang); if(l) lang=l.tts_code; }
      if(s) showBar=s.show_toolbar!==false;
    }
    if(showBar) build();
  });

  function build(){
    // ── FAB + panel ──────────────────────────────────────────────────────────
    const tb=el('div'); tb.id='et4-tb';
    const panel=el('div'); panel.id='et4-panel';
    const pills=el('div'); pills.className='et4-pills';
    [['L001','hi-IN','हि'],['L002','mr-IN','म'],['L003','gu-IN','ગ'],['L004','ta-IN','த'],['L005','te-IN','తె']].forEach(([id,tc,sc])=>{
      const p=el('button'); p.className='et4-pill'+(tc===lang?' on':''); p.textContent=sc;
      p.onclick=()=>{ document.querySelectorAll('.et4-pill').forEach(x=>x.classList.remove('on')); p.classList.add('on'); lang=tc; };
      pills.appendChild(p);
    });
    const bSel=btn('✂ Translate Selection','et4-btn et4-p');
    const bPg =btn('📄 Translate Page',    'et4-btn et4-g');
    const bSpk=btn('🔊 Speak Selection',   'et4-btn et4-g');
    bSel.onclick=async()=>{ const t=getSel(); if(!t){pop('Select text first');return;} panel.classList.remove('open'); showOv('Translating…',lang); const r=await tr(t); showOv(r,lang); };
    bPg.onclick =async()=>{ const t=getPage(); if(!t)return; panel.classList.remove('open'); showOv('Translating full page…',lang); const r=await trFull(t); showOv(r,lang); };
    bSpk.onclick=()=>{ const t=getSel(); if(!t){pop('Select text first');return;} speak(t,lang); panel.classList.remove('open'); };
    panel.append(el('div','Quick Translate','et4-ptitle'),pills,bSel,bPg,bSpk);
    const fab=el('button','🌐',''); fab.id='et4-fab'; fab.onclick=()=>panel.classList.toggle('open');
    document.addEventListener('click',e=>{ if(!tb.contains(e.target)) panel.classList.remove('open'); });
    tb.append(panel,fab); document.body.appendChild(tb);

    // ── Overlay ──────────────────────────────────────────────────────────────
    const ov=el('div'); ov.id='et4-ov';
    const oh=el('div','','et4-oh');
    const ot=el('span','🌐 Translation','');
    const cl=btn('✕','et4-cl'); cl.onclick=()=>ov.classList.remove('show');
    oh.append(ot,cl);
    const ob=el('div','','et4-ob'); ob.id='et4-ob';
    const of_=el('div','','et4-of');
    const spk=btn('🔊 Speak','et4-btn et4-p'); spk.onclick=()=>speak(ob.textContent,lang);
    const cp =btn('📋 Copy', 'et4-btn et4-g');  cp.onclick=()=>navigator.clipboard.writeText(ob.textContent).catch(()=>{});
    of_.append(spk,cp); ov.append(oh,ob,of_); document.body.appendChild(ov);

    // ── Subtitle bar ──────────────────────────────────────────────────────────
    const sb=el('div'); sb.id='et4-subs'; document.body.appendChild(sb);

    // ── Selection popup ───────────────────────────────────────────────────────
    const sp=el('div'); sp.id='et4-sp';
    const spT=btn('Translate','et4-spb'); const spS=btn('Speak','et4-spb et4-spbs');
    spT.onclick=async()=>{ const t=getSel(); sp.classList.remove('on'); if(!t)return; const r=await tr(t); showOv(r,lang); };
    spS.onclick=()=>{ const t=getSel(); sp.classList.remove('on'); if(t) speak(t,lang); };
    sp.append(el('span','EduAI',''),spT,spS); document.body.appendChild(sp);
    document.addEventListener('mouseup',e=>{
      setTimeout(()=>{
        const s=getSel();
        if(s&&s.length>3&&!sp.contains(e.target)){
          const rc=window.getSelection().getRangeAt(0).getBoundingClientRect();
          sp.style.top=(scrollY+rc.top-44)+'px'; sp.style.left=(scrollX+rc.left)+'px'; sp.classList.add('on');
        } else if(!sp.contains(e.target)) sp.classList.remove('on');
      },50);
    });
  }

  function showOv(text,l){
    const ob=document.getElementById('et4-ob');
    const ov=document.getElementById('et4-ov');
    if(!ob||!ov) return;
    ob.textContent=text; ov.classList.add('show');
  }

  function showSubs(text){
    const sb=document.getElementById('et4-subs'); if(!sb) return;
    const words=text.split(' '); let i=0;
    sb.classList.add('on');
    const next=()=>{ if(i>=words.length){sb.classList.remove('on');return;} sb.textContent=words.slice(i,i+12).join(' '); i+=12; setTimeout(next,2600); };
    next();
  }

  // Single chunk translate
  async function tr(text){
    try{
      const {api_key}=await new Promise(r=>chrome.storage.local.get('api_key',r));
      if(api_key){
        const r=await fetch(`https://translation.googleapis.com/language/translate/v2?key=${api_key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text.slice(0,800),target:lang.split('-')[0],format:'text'})});
        const d=await r.json(); return d.data?.translations?.[0]?.translatedText||text;
      }
      const enc=encodeURIComponent(text.slice(0,490));
      const r=await fetch(`https://api.mymemory.translated.net/get?q=${enc}&langpair=en|${lang.split('-')[0]}`);
      const d=await r.json(); return d.responseData?.translatedText||text;
    }catch{ return text; }
  }

  // Chunked translate for full page
  async function trFull(text){
    const {api_key}=await new Promise(r=>chrome.storage.local.get('api_key',r));
    const code=lang.split('-')[0];
    const CHUNK=api_key?5000:490;
    const sents=text.split(/(?<=[.!?\n])\s+/);
    const chunks=[]; let cur='';
    for(const s of sents){ if((cur+s).length>CHUNK&&cur){chunks.push(cur);cur=s;}else cur=(cur+' '+s).trim(); }
    if(cur) chunks.push(cur);
    const results=[];
    for(const chunk of chunks){
      try{
        if(api_key){
          const r=await fetch(`https://translation.googleapis.com/language/translate/v2?key=${api_key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:chunk,target:code,format:'text'})});
          const d=await r.json(); results.push(d.data?.translations?.[0]?.translatedText||chunk);
        } else {
          const enc=encodeURIComponent(chunk.slice(0,490));
          const r=await fetch(`https://api.mymemory.translated.net/get?q=${enc}&langpair=en|${code}`);
          const d=await r.json(); results.push(d.responseData?.translatedText||chunk);
          await new Promise(r=>setTimeout(r,300));
        }
      }catch{ results.push(chunk); }
    }
    return results.join(' ');
  }

  function speak(text,lc,rate=1){
    speechSynthesis.cancel();
    const segs=text.match(/[^.!?\n]{1,180}[.!?\n]?/g)||[text]; let i=0;
    function next(){ if(i>=segs.length)return; const u=new SpeechSynthesisUtterance(segs[i]); u.lang=lc; u.rate=rate; const v=speechSynthesis.getVoices().find(v=>v.lang.startsWith(lc.split('-')[0])); if(v)u.voice=v; u.onend=()=>{i++;next();}; speechSynthesis.speak(u); }
    next();
  }

  function getSel(){ return window.getSelection().toString().trim(); }
  function getPage(){
    const sels=['article','[role="main"]','main','.post-content','.article-body','.entry-content','#content','.content'];
    for(const s of sels){ const e=document.querySelector(s); if(e&&e.innerText.length>100) return e.innerText.replace(/\s+/g,' ').slice(0,3000); }
    return Array.from(document.querySelectorAll('p,h1,h2,h3')).map(n=>n.innerText.trim()).filter(t=>t.length>20).join(' ').slice(0,3000);
  }
  function el(tag,text,cls){ const e=document.createElement(tag); if(text&&text!=='')e.textContent=text; if(cls)e.className=cls; return e; }
  function btn(text,cls){ return el('button',text,cls); }
  function pop(msg){ const d=document.createElement('div'); d.style.cssText='position:fixed;bottom:90px;right:20px;background:#13173A;color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;z-index:2147483647;font-family:sans-serif;animation:none'; d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),2500); }

  chrome.runtime.onMessage.addListener((msg,_,res)=>{
    if(msg.action==='overlay')  { showOv(msg.text,msg.lang); res({ok:true}); }
    if(msg.action==='subtitles'){ showSubs(msg.text);         res({ok:true}); }
    if(msg.action==='speak')    { speak(msg.text,TTSMAP[msg.lang]||'hi-IN'); res({ok:true}); }
    if(msg.action==='updateSettings'){ const tb=document.getElementById('et4-tb'); if(tb)tb.style.display=msg.settings.show_toolbar?'flex':'none'; res({ok:true}); }
    return true;
  });
})();
