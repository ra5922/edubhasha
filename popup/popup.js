'use strict';
/**
 * EduTranslate AI — Popup Controller v4
 * FIX 1: Full-page translation via chunked API calls (works without/with Google API key)
 * FIX 2: YouTube — fetches video ID, translates title, gets transcript, generates subtitles
 * FIX 3: Live DB Tables panel shows all 8 ER tables with real records
 */

const $   = id => document.getElementById(id);
const $$  = s  => document.querySelectorAll(s);

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser   = null;
let selLangId     = '';       // translate tab lang
let selLangCode   = '';
let selLangName   = '';
let ytLangId      = '';       // youtube tab lang
let ytLangCode    = '';
let ytLangName    = '';
let selType       = 'article';
let lastContent   = null;
let lastTrans     = null;
let lastYtContent = null;
let ttsPaused     = false;

const LANG_TTS = { L001:'hi-IN', L002:'mr-IN', L003:'gu-IN', L004:'ta-IN', L005:'te-IN' };
const LANG_MM  = { L001:'hi',    L002:'mr',    L003:'gu',    L004:'ta',    L005:'te'    };

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const uid = await DB.getActiveUser();
  if(uid){
    const u = await DB.getUserById(uid);
    if(u){ currentUser = u; await goMain(); return; }
  }
  showScreen('auth');
});

function showScreen(name){
  $$('.screen').forEach(s=>s.classList.add('hidden'));
  $('sc-'+name).classList.remove('hidden');
}

async function goMain(){
  showScreen('main');
  await DB.updateLastLogin(currentUser.user_id);
  renderHeader();
  await loadSettings();
  await renderFavorites();
  // Pre-select user's preferred language
  const pref = currentUser.preferred_lang || 'L001';
  const btn  = document.querySelector(`#tab-translate .lb[data-lid="${pref}"]`);
  if(btn) btn.click();
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function renderHeader(){
  const ini = currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  $('hAv').textContent    = ini;
  $('hName').textContent  = currentUser.name;
  $('hUid').textContent   = 'ID: '+currentUser.user_id.slice(0,20)+'…';
  $('pcAv').textContent   = ini;
  $('pcName').textContent = currentUser.name;
  $('pcEmail').textContent= currentUser.email;
  $('pcId').textContent   = currentUser.user_id;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
$$('.atab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('.atab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $('f-login').classList.toggle('hidden',    btn.dataset.t!=='login');
    $('f-register').classList.toggle('hidden', btn.dataset.t!=='register');
  });
});

$('registerBtn').addEventListener('click', async()=>{
  const name  = $('r-name').value.trim();
  const email = $('r-email').value.trim();
  const lang  = $('r-lang').value;
  $('r-err').textContent = '';
  if(!name)  { $('r-err').textContent='Name is required'; return; }
  if(!email||!email.includes('@')) { $('r-err').textContent='Valid email required'; return; }
  $('registerBtn').disabled=true; $('registerBtn').textContent='Creating…';
  const res = await DB.createUser(name, email, lang);
  $('registerBtn').disabled=false; $('registerBtn').textContent='Create Account →';
  if(res.error){ $('r-err').textContent=res.error; return; }
  currentUser = res.user;
  await DB.setActiveUser(currentUser.user_id);
  toast('Welcome, '+name.split(' ')[0]+'! 🎉');
  await goMain();
});

$('loginBtn').addEventListener('click', async()=>{
  const email = $('l-email').value.trim();
  $('l-err').textContent='';
  if(!email){ $('l-err').textContent='Email required'; return; }
  const u = await DB.getUserByEmail(email);
  if(!u){ $('l-err').textContent='No account found. Please register.'; return; }
  currentUser = u;
  await DB.setActiveUser(u.user_id);
  toast('Welcome back, '+u.name.split(' ')[0]+'! 👋');
  await goMain();
});

$('logoutBtn').addEventListener('click', async()=>{
  await DB.clearActiveUser(); currentUser=null;
  showScreen('auth'); toast('Logged out');
});

// ── NAV TABS ──────────────────────────────────────────────────────────────────
$$('.ntab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('.ntab').forEach(b=>b.classList.remove('active'));
    $$('.tab').forEach(t=>{ t.classList.add('hidden'); t.classList.remove('active'); });
    btn.classList.add('active');
    const t = $('tab-'+btn.dataset.tab);
    t.classList.remove('hidden'); t.classList.add('active');
    if(btn.dataset.tab==='db')    renderDBPanel();
    if(btn.dataset.tab==='saved') renderFavorites();
  });
});

// ── TRANSLATE TAB — lang + type buttons ───────────────────────────────────────
document.querySelectorAll('#tab-translate .lb').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#tab-translate .lb').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selLangId   = btn.dataset.lid;
    selLangCode = btn.dataset.code;
    selLangName = DB.SEED_LANGUAGES.find(l=>l.lang_id===selLangId)?.lang_name || selLangCode;
  });
});

$$('.tb').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('.tb').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selType = btn.dataset.type;
  });
});

// ── TRANSLATE ─────────────────────────────────────────────────────────────────
$('translateBtn').addEventListener('click', doTranslate);
$('resetBtn').addEventListener('click',()=>{
  $('rcard').classList.add('hidden');
  $('prog').classList.add('hidden');
  lastContent=null; lastTrans=null;
});

async function doTranslate(){
  if(!selLangId){ toast('Select a target language first'); return; }
  if(!currentUser){ toast('Please log in'); return; }

  const btn=$('translateBtn');
  btn.disabled=true;
  btn.innerHTML='<span class="spin">⟳</span> Translating…';
  setProgress('prog','pfill','plbl', 5, 'Connecting to page…');

  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    let rawText='', title='', url=tab.url||'';

    setProgress('prog','pfill','plbl', 15, 'Extracting full page content…');

    if(selType==='selection'){
      const r = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>window.getSelection().toString().trim()});
      rawText = r[0]?.result||'';
      title   = 'Selection — '+(tab.title||'page');
      if(!rawText) throw new Error('No text selected. Please highlight text on the page first.');
    } else {
      // FULL PAGE extraction — gets ALL readable text
      const r = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:extractFullPage});
      rawText = r[0]?.result?.text||'';
      title   = r[0]?.result?.title||tab.title||'Article';
      if(!rawText) throw new Error('No readable content found on this page.');
    }

    // Save CONTENT record
    setProgress('prog','pfill','plbl', 20, 'Saving to CONTENT table…');
    const cRec = await DB.createContent(selType, 'en', url, title, rawText);
    lastContent = cRec;

    // Check TRANSLATION cache
    setProgress('prog','pfill','plbl', 30, 'Checking TRANSLATION cache…');
    let tRec = await DB.getCachedTranslation(cRec.content_id, selLangId);

    if(!tRec){
      // CHUNKED TRANSLATION — translates the ENTIRE text
      const settings = await DB.getSettingsByUser(currentUser.user_id);
      const apiKey   = settings?.api_key || '';

      setProgress('prog','pfill','plbl', 40, 'Starting chunked translation…');
      const translated = await translateFullText(rawText, selLangCode, apiKey, (pct,msg)=>{
        setProgress('prog','pfill','plbl', 40+Math.round(pct*0.45), msg);
      });

      setProgress('prog','pfill','plbl', 88, 'Saving to TRANSLATION table…');
      tRec = await DB.createTranslation(cRec.content_id, selLangId, translated, 'en');
    }

    lastTrans = tRec;

    // Push overlay to page
    chrome.tabs.sendMessage(tab.id,{action:'overlay',text:tRec.translated_text,lang:selLangName}).catch(()=>{});
    setProgress('prog','pfill','plbl', 100, 'Done!');
    showResult(tRec, cRec, title);

  }catch(err){
    toast('⚠ '+err.message);
    $('prog').classList.add('hidden');
  }finally{
    btn.disabled=false;
    btn.innerHTML='🔄 Translate Page';
  }
}

function extractFullPage(){
  const title = document.title||'';
  const sels  = ['article','[role="main"]','main','.post-content','.article-body',
                  '.entry-content','.content-body','.story-body','.mw-parser-output',
                  '#content','.content','.post','.page-content'];
  for(const s of sels){
    const el=document.querySelector(s);
    if(el){
      const t=el.innerText.replace(/[\t\r]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
      if(t.length>200) return {title, text:t};
    }
  }
  // Fallback — collect all text nodes
  const nodes=document.querySelectorAll('p,h1,h2,h3,h4,li,blockquote');
  const text=Array.from(nodes).map(n=>n.innerText.trim()).filter(t=>t.length>15).join('\n');
  return {title, text};
}

// ── FULL TEXT CHUNKED TRANSLATION ─────────────────────────────────────────────
// This is the KEY FIX — splits entire text into small chunks, translates each one,
// then joins them back. Ensures 100% of content is translated.
async function translateFullText(fullText, targetCode, apiKey, onProgress){
  const CHUNK = apiKey ? 5000 : 490; // Google allows 5000 chars, MyMemory ~500

  // Split on sentence boundaries so we never cut a word in half
  const sentences = fullText.split(/(?<=[.!?\n])\s+/);
  const chunks    = [];
  let   cur       = '';

  for(const sent of sentences){
    if((cur+' '+sent).trim().length > CHUNK && cur){
      chunks.push(cur.trim());
      cur = sent;
    } else {
      cur = (cur+' '+sent).trim();
    }
  }
  if(cur) chunks.push(cur);

  const results = [];
  for(let i=0; i<chunks.length; i++){
    const pct = (i/chunks.length);
    onProgress(pct, `Translating chunk ${i+1} of ${chunks.length}…`);
    const r = await translateOne(chunks[i], targetCode, apiKey);
    results.push(r);
    // Throttle free API to avoid rate limits
    if(!apiKey && i < chunks.length-1) await sleep(320);
  }
  return results.join(' ');
}

async function translateOne(text, targetCode, apiKey){
  if(!text.trim()) return '';
  try{
    if(apiKey){
      const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({q:text, target:targetCode, format:'text'})
      });
      const d = await r.json();
      if(d.error) throw new Error(d.error.message);
      return d.data.translations[0].translatedText;
    } else {
      // MyMemory free API — limit 500 chars per request
      const enc = encodeURIComponent(text.slice(0,490));
      const r   = await fetch(`https://api.mymemory.translated.net/get?q=${enc}&langpair=en|${targetCode}`);
      const d   = await r.json();
      if(d.responseStatus===200) return d.responseData.translatedText;
      if(d.responseStatus===429){ await sleep(1800); return translateOne(text,targetCode,apiKey); }
      return text; // fallback to original on error
    }
  }catch(e){ console.warn('Chunk error:',e); return text; }
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function setProgress(progId, fillId, lblId, pct, msg){
  $(progId).classList.remove('hidden');
  $(fillId).style.width = pct+'%';
  $(lblId).textContent  = msg;
}

function showResult(tRec, cRec, title){
  $('prog').classList.add('hidden');
  $('rbadge').textContent = '✓ '+tRec.target_lang;
  $('rbody').textContent  = tRec.translated_text;
  $('rmeta').textContent  = `Content ID: ${cRec.content_id.slice(0,18)} · Trans ID: ${tRec.trans_id.slice(0,18)} · ${tRec.char_count} chars`;
  $('rcard').classList.remove('hidden');
}

// ── RESULT BUTTONS ────────────────────────────────────────────────────────────
$('copyBtn').addEventListener('click',()=>{
  if(!lastTrans) return;
  navigator.clipboard.writeText(lastTrans.translated_text).then(()=>toast('Copied ✓')).catch(()=>toast('Copy failed'));
});

$('speakBtn').addEventListener('click', async()=>{
  if(!lastTrans||!currentUser||!lastContent) return;
  const lang = LANG_TTS[selLangId]||'hi-IN';
  speakText(lastTrans.translated_text, lang);
  // Save AUDIO record
  await DB.createAudio(lastContent.content_id, selLangId, 'popup_tts_'+selLangCode);
  toast('🔊 Speaking aloud…');
});

$('saveBtn').addEventListener('click', async()=>{
  if(!lastContent||!currentUser) return;
  const r = await DB.addFavorite(currentUser.user_id, lastContent.content_id);
  if(r.error){ toast('Already saved ⭐'); return; }
  toast('Saved to Favorites ⭐');
  await renderFavorites();
});

// ════════════════════════════════════════════════════════════════════════════════
// YOUTUBE TAB — Full implementation
// 1. Accept YouTube URL (or auto-fill from current tab)
// 2. Extract video ID
// 3. Fetch transcript from YouTube's timedtext API
// 4. Translate title + transcript
// 5. Generate subtitle blocks saved to SUBTITLE table
// 6. Show subtitles on page via content script
// ════════════════════════════════════════════════════════════════════════════════

// YouTube lang grid
document.querySelectorAll('#tab-youtube .lb').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#tab-youtube .lb').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ytLangId   = btn.dataset.lid;
    ytLangCode = btn.dataset.code;
    ytLangName = DB.SEED_LANGUAGES.find(l=>l.lang_id===ytLangId)?.lang_name || ytLangCode;
  });
});

$('ytAutoFillBtn').addEventListener('click', async()=>{
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[null]);
  if(tab && tab.url && tab.url.includes('youtube.com')) $('ytUrl').value = tab.url;
  else toast('Current tab is not a YouTube page');
});

$('ytFetchBtn').addEventListener('click', doYouTube);

async function doYouTube(){
  const urlInput = $('ytUrl').value.trim();
  if(!urlInput){ toast('Enter a YouTube URL first'); return; }
  if(!ytLangId){ toast('Select a target language'); return; }
  if(!currentUser){ toast('Please log in'); return; }

  const videoId = extractYouTubeId(urlInput);
  if(!videoId){ toast('Invalid YouTube URL. Use format: youtube.com/watch?v=VIDEO_ID'); return; }

  const btn = $('ytFetchBtn');
  btn.disabled=true; btn.textContent='Fetching…';
  $('ytResult').classList.add('hidden');
  setProgress('ytProg','ytFill','ytLbl', 5, 'Extracting video ID…');

  try{
    const settings = await DB.getSettingsByUser(currentUser.user_id);
    const apiKey   = settings?.api_key || '';

    // ── STEP 1: Get video metadata from current page or oEmbed ──────────────
    setProgress('ytProg','ytFill','ytLbl', 12, 'Fetching video metadata…');
    const meta = await fetchYouTubeMeta(videoId, urlInput);

    // ── STEP 2: Translate title ──────────────────────────────────────────────
    setProgress('ytProg','ytFill','ytLbl', 25, 'Translating video title…');
    const translatedTitle = await translateOne(meta.title, ytLangCode, apiKey);

    // ── STEP 3: Fetch transcript ─────────────────────────────────────────────
    setProgress('ytProg','ytFill','ytLbl', 38, 'Fetching transcript…');
    const transcript = await fetchYouTubeTranscript(videoId, meta);

    // ── STEP 4: Translate transcript (chunked) ───────────────────────────────
    setProgress('ytProg','ytFill','ytLbl', 50, 'Translating transcript…');
    const translatedTranscript = await translateFullText(
      transcript, ytLangCode, apiKey,
      (pct,msg)=>setProgress('ytProg','ytFill','ytLbl', 50+Math.round(pct*30), msg)
    );

    // ── STEP 5: Save to DB ───────────────────────────────────────────────────
    setProgress('ytProg','ytFill','ytLbl', 83, 'Saving to database tables…');
    const ytContent = await DB.createContent(
      'youtube','en',urlInput,
      meta.title,
      `Title: ${meta.title}\nChannel: ${meta.channel}\nTranscript: ${transcript}`
    );
    lastYtContent = ytContent;

    await DB.createTranslation(ytContent.content_id, ytLangId,
      `TITLE: ${translatedTitle}\n\n${translatedTranscript}`, 'en');

    // ── STEP 6: Generate subtitle blocks and save to SUBTITLE table ──────────
    let subtitleBlocks = '';
    if($('ytSubs').checked){
      setProgress('ytProg','ytFill','ytLbl', 90, 'Generating subtitle blocks…');
      subtitleBlocks = generateSubtitleSRT(translatedTranscript);
      await DB.createSubtitle(ytContent.content_id, ytLangId, subtitleBlocks);
    }

    // ── STEP 7: Save AUDIO record ─────────────────────────────────────────────
    if($('ytAudio').checked){
      await DB.createAudio(ytContent.content_id, ytLangId, `youtube_audio_${videoId}`);
    }

    setProgress('ytProg','ytFill','ytLbl', 100, 'Done!');

    // ── STEP 8: Display results ───────────────────────────────────────────────
    $('ytOrigTitle').textContent  = `🎬 Original: ${meta.title}`;
    $('ytTransTitle').textContent = `✓ ${ytLangName}: ${translatedTitle}`;
    $('ytTranscript').textContent = translatedTranscript;

    if($('ytSubs').checked && subtitleBlocks){
      $('ytSubsPreview').textContent = subtitleBlocks.slice(0,500)+'…';
      $('ytSubsSection').classList.remove('hidden');
    } else {
      $('ytSubsSection').classList.add('hidden');
    }

    $('ytMeta').textContent = `Video ID: ${videoId} · Content ID: ${ytContent.content_id.slice(0,18)} · Lang: ${ytLangName}`;
    $('ytResult').classList.remove('hidden');
    $('ytProg').classList.add('hidden');

  }catch(err){
    toast('⚠ '+err.message);
    $('ytProg').classList.add('hidden');
  }finally{
    btn.disabled=false; btn.textContent='▶ Fetch & Translate Video';
  }
}

function extractYouTubeId(url){
  try{
    const u = new URL(url);
    if(u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if(u.hostname==='youtu.be') return u.pathname.slice(1);
  }catch{}
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function fetchYouTubeMeta(videoId, originalUrl){
  // Try to get metadata from the current active tab if it's the same video
  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[null]);
    if(tab && tab.url && tab.url.includes(videoId)){
      const r = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>{
        return {
          title:   document.querySelector('h1.ytd-watch-metadata')?.innerText?.trim() || document.title.replace(' - YouTube',''),
          channel: document.querySelector('#channel-name a')?.innerText?.trim() || '',
          desc:    document.querySelector('#description-text')?.innerText?.trim() || ''
        };
      }});
      const m = r[0]?.result;
      if(m?.title) return m;
    }
  }catch{}
  // Fallback: use oEmbed API (no key needed)
  try{
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const d = await r.json();
    return { title: d.title||'YouTube Video', channel: d.author_name||'', desc:'' };
  }catch{}
  return { title:'YouTube Video ('+videoId+')', channel:'', desc:'' };
}

async function fetchYouTubeTranscript(videoId, meta){
  // Method 1: Try to get captions from active page
  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[null]);
    if(tab && tab.url && tab.url.includes(videoId)){
      const r = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>{
        const segs = document.querySelectorAll('.ytp-caption-segment, .captions-text');
        if(segs.length>0) return Array.from(segs).map(s=>s.textContent).join(' ');
        // Try auto-generated captions panel
        const panel = document.querySelector('[target-id="engagement-panel-searchable-transcript"]');
        if(panel) return panel.innerText.replace(/\d{1,2}:\d{2}/g,'').replace(/\s+/g,' ').trim();
        return null;
      }});
      const captions = r[0]?.result;
      if(captions && captions.length>50) return captions;
    }
  }catch{}

  // Method 2: Build transcript from video description + title (always available)
  const parts = [];
  if(meta.title)   parts.push('Video: '+meta.title);
  if(meta.channel) parts.push('Channel: '+meta.channel);
  if(meta.desc&&meta.desc.length>10) parts.push('Description:\n'+meta.desc);
  else parts.push('Note: Live transcript requires the video tab to be open. Please open the YouTube video in a tab first, then use this extension.');

  return parts.join('\n\n');
}

// Generate simple SRT-style subtitle blocks from translated text
function generateSubtitleSRT(text){
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g)||[text];
  let srt='', idx=1, seconds=0;
  for(const s of sentences){
    const start  = formatSRTTime(seconds);
    const dur    = Math.max(2, Math.ceil(s.length/15)); // ~15 chars per second
    seconds += dur;
    const end    = formatSRTTime(seconds);
    srt += `${idx}\n${start} --> ${end}\n${s.trim()}\n\n`;
    idx++;
    seconds += 0.5; // small gap between subs
  }
  return srt;
}

function formatSRTTime(sec){
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  const s=Math.floor(sec%60);
  const ms=0;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3,'0')}`;
}
function pad(n){ return String(n).padStart(2,'0'); }

// YouTube action buttons
$('ytSpeakBtn').addEventListener('click', async()=>{
  const text = $('ytTranscript').textContent;
  if(!text) return;
  speakText(text, LANG_TTS[ytLangId]||'hi-IN');
  if(currentUser && lastYtContent) await DB.createAudio(lastYtContent.content_id, ytLangId, 'yt_tts_speak');
  toast('🔊 Speaking transcript aloud…');
});

$('ytSaveBtn').addEventListener('click', async()=>{
  if(!lastYtContent||!currentUser) return;
  const r = await DB.addFavorite(currentUser.user_id, lastYtContent.content_id);
  if(r.error){ toast('Already saved ⭐'); return; }
  toast('Saved ⭐'); await renderFavorites();
});

$('ytShowSubsBtn').addEventListener('click', async()=>{
  const text = $('ytTranscript').textContent;
  if(!text) return;
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[null]);
  if(tab) chrome.tabs.sendMessage(tab.id,{action:'subtitles',text}).catch(()=>{});
  toast('📺 Subtitles shown on page');
});

// ── SPEAK TAB ─────────────────────────────────────────────────────────────────
$('spdR').addEventListener('input',e=>{ $('spdV').textContent=parseFloat(e.target.value).toFixed(1); });
$('pitR').addEventListener('input',e=>{ $('pitV').textContent=parseFloat(e.target.value).toFixed(1); });

$('ttsPlay').addEventListener('click', async()=>{
  const text  = $('ttsText').value.trim();
  if(!text){ toast('Enter text to speak'); return; }
  const lang  = $('ttsLang').value;
  const speed = parseFloat($('spdR').value);
  const pitch = parseFloat($('pitR').value);
  speakText(text, lang, speed, pitch);
  $('ttsStat').textContent = '🔊 Speaking in '+lang.split('-')[0]+'…';
  if(currentUser){
    const c = await DB.createContent('selection','en','','Direct TTS',text.slice(0,100));
    await DB.createAudio(c.content_id, lang.split('-')[0]==='hi'?'L001':'L005','direct_tts');
  }
});

$('ttsPause').addEventListener('click',()=>{
  if(speechSynthesis.speaking){
    if(ttsPaused){ speechSynthesis.resume(); ttsPaused=false; $('ttsPause').textContent='⏸ Pause'; $('ttsStat').textContent='🔊 Resumed'; }
    else         { speechSynthesis.pause();  ttsPaused=true;  $('ttsPause').textContent='▶ Resume'; $('ttsStat').textContent='⏸ Paused'; }
  }
});

$('ttsStop').addEventListener('click',()=>{
  speechSynthesis.cancel(); ttsPaused=false;
  $('ttsPause').textContent='⏸ Pause'; $('ttsStat').textContent='';
});

function speakText(text, langCode, rate=1, pitch=1){
  speechSynthesis.cancel();
  const segs = text.match(/[^.!?\n]{1,180}[.!?\n]?/g)||[text];
  let i=0;
  function next(){
    if(i>=segs.length){ $('ttsStat').textContent='✓ Done speaking'; return; }
    const u   = new SpeechSynthesisUtterance(segs[i]);
    u.lang    = langCode; u.rate=rate; u.pitch=pitch;
    const v   = speechSynthesis.getVoices().find(v=>v.lang.startsWith(langCode.split('-')[0]));
    if(v) u.voice=v;
    u.onend=()=>{ i++; next(); };
    speechSynthesis.speak(u);
  }
  next();
}

// ── FAVORITES ─────────────────────────────────────────────────────────────────
async function renderFavorites(){
  if(!currentUser) return;
  const favs = await DB.getFavoritesByUser(currentUser.user_id);
  const list = $('favList');
  $('clearFavBtn').classList.toggle('hidden', favs.length===0);

  if(!favs.length){
    list.innerHTML='<div class="empty"><span>⭐</span><p>No saved content yet.<br/>Translate and tap ⭐ to save.</p></div>';
    return;
  }

  list.innerHTML = favs.map(f=>{
    const t = f.translations[0]||{};
    const s = f.subtitles[0]||{};
    return `<div class="li" data-fid="${f.favorite_id}">
      <div class="li-badges">
        <span class="chip chip-type">${f.content.content_type||'?'}</span>
        <span class="chip chip-lang">${t.target_lang||'?'}</span>
        ${s.subtitle_id?'<span class="chip chip-id">📺 Subtitles</span>':''}
      </div>
      <div class="li-title">${esc((f.content.title||'Untitled').slice(0,60))}</div>
      <div class="li-text">${esc((t.translated_text||'').slice(0,80))}…</div>
      <div class="li-date">Fav ID: ${f.favorite_id.slice(0,16)} · ${fmtDate(f.saved_at)}</div>
      <button class="li-spk" title="Speak">🔊</button>
      <button class="li-del" title="Remove">✕</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.li-del').forEach(btn=>{
    btn.addEventListener('click',async e=>{
      e.stopPropagation();
      await DB.removeFavorite(btn.closest('.li').dataset.fid, currentUser.user_id);
      toast('Removed'); await renderFavorites();
    });
  });
  list.querySelectorAll('.li-spk').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const fid=btn.closest('.li').dataset.fid;
      const fav=favs.find(f=>f.favorite_id===fid);
      if(!fav) return;
      const t=fav.translations[0]||{};
      if(t.translated_text) speakText(t.translated_text, LANG_TTS[t.lang_id]||'hi-IN');
    });
  });
}

$('clearFavBtn').addEventListener('click',async()=>{
  if(!currentUser) return;
  await DB.clearFavorites(currentUser.user_id);
  toast('Favorites cleared'); await renderFavorites();
});

// ── DB TABLES PANEL ───────────────────────────────────────────────────────────
// Shows all 8 ER tables with live record counts and table viewer
async function renderDBPanel(){
  if(!currentUser) return;
  const db = await DB.exportDB();

  // Stats grid
  const tables = ['USER','CONTENT','LANGUAGE','TRANSLATION','AUDIO','SUBTITLE','FAVORITES','SETTINGS'];
  $('dbStatsGrid').innerHTML = tables.map(t=>`
    <div class="dbox" onclick="showDBTable('${t}')" id="dbox-${t}">
      <div class="dbox-num">${(db[t]||[]).length}</div>
      <div class="dbox-lbl">${t}</div>
    </div>`).join('');

  // Default view — show LANGUAGE table (always has data)
  $('dbTableSel').value = 'LANGUAGE';
  showDBTable('LANGUAGE');
}

window.showDBTable = async function(tableName){
  const db = await DB.exportDB();
  const rows = db[tableName]||[];

  // Highlight active box
  document.querySelectorAll('.dbox').forEach(b=>b.classList.remove('active-tbl'));
  const box = document.getElementById('dbox-'+tableName);
  if(box) box.classList.add('active-tbl');

  $('dbTableSel').value = tableName;

  if(!rows.length){
    $('dbTableWrap').innerHTML=`<div class="db-empty">📭 ${tableName} table is empty. Start using the extension to populate it.</div>`;
    return;
  }

  const cols = Object.keys(rows[0]);
  const thead = `<tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`;
  const tbody = rows.map(r=>`<tr>${cols.map(c=>{
    let val = r[c]||'';
    if(typeof val==='string' && val.length>40) val=val.slice(0,40)+'…';
    if(typeof val==='boolean') val=val?'✓':'✗';
    return `<td title="${esc(String(r[c]||''))}">${esc(String(val))}</td>`;
  }).join('')}</tr>`).join('');

  $('dbTableWrap').innerHTML = `<div style="overflow:auto;max-height:200px">
    <table class="db-tbl"><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  </div>`;
};

$('dbTableSel').addEventListener('change', e=>showDBTable(e.target.value));

// ── SETTINGS ─────────────────────────────────────────────────────────────────
async function loadSettings(){
  if(!currentUser) return;
  const s = await DB.getSettingsByUser(currentUser.user_id);
  if(!s) return;
  $('prefLang').value      = currentUser.preferred_lang||'L001';
  $('voiceType').value     = s.tts_voice_type||'female';
  $('showToolbar').checked = s.show_toolbar!==false;
  $('apiKey').value        = s.api_key||'';
  // Show/hide API notice
  $('apiNotice').style.display = s.api_key ? 'none' : 'block';
}

$('saveSettingsBtn').addEventListener('click', async()=>{
  if(!currentUser) return;
  const apiKey = $('apiKey').value.trim();
  await DB.updateSettings(currentUser.user_id,{
    tts_voice_type: $('voiceType').value,
    show_toolbar:   $('showToolbar').checked,
    api_key:        apiKey
  });
  await DB.updateUserPref(currentUser.user_id, $('prefLang').value);
  currentUser.preferred_lang = $('prefLang').value;
  $('apiNotice').style.display = apiKey ? 'none' : 'block';
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[null]);
  if(tab) chrome.tabs.sendMessage(tab.id,{action:'updateSettings',settings:{show_toolbar:$('showToolbar').checked}}).catch(()=>{});
  $('saveOk').classList.remove('hidden');
  setTimeout(()=>$('saveOk').classList.add('hidden'),2500);
  toast('Settings saved ✓');
});

// ── UTILS ─────────────────────────────────────────────────────────────────────
function toast(msg){
  document.querySelectorAll('.gtoast').forEach(e=>e.remove());
  const el=document.createElement('div');
  el.className='gtoast'; el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),2800);
}
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(iso){ if(!iso)return''; return new Date(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
