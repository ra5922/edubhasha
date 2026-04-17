'use strict';
self.addEventListener('install',  ()=>self.skipWaiting());
self.addEventListener('activate', ()=>self.clients.claim());

chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.create({id:'et4-tr',    title:'Translate with EduTranslate AI', contexts:['selection']});
  chrome.contextMenus.create({id:'et4-speak', title:'Speak with EduTranslate AI',     contexts:['selection']});
});

chrome.contextMenus.onClicked.addListener(async(info,tab)=>{
  if(!info.selectionText) return;
  const {et_db4,et_uid4}=await chrome.storage.local.get(['et_db4','et_uid4']);
  if(!et_db4||!et_uid4) return;
  const user=et_db4.USER.find(u=>u.user_id===et_uid4);
  if(!user) return;
  const lang=et_db4.LANGUAGE.find(l=>l.lang_id===user.preferred_lang)||et_db4.LANGUAGE[0];
  if(info.menuItemId==='et4-tr'){
    const r=await quickTr(info.selectionText.slice(0,500),lang.mm_code,et_db4);
    chrome.tabs.sendMessage(tab.id,{action:'overlay',text:r,lang:lang.lang_name}).catch(()=>{});
  }
  if(info.menuItemId==='et4-speak'){
    chrome.tabs.sendMessage(tab.id,{action:'speak',text:info.selectionText,lang:user.preferred_lang}).catch(()=>{});
  }
});

async function quickTr(text,code,db){
  try{
    const key=db?.SETTINGS?.[0]?.api_key||'';
    if(key){
      const r=await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text,target:code,format:'text'})});
      const d=await r.json(); return d.data?.translations?.[0]?.translatedText||'Error';
    }
    const enc=encodeURIComponent(text);
    const r=await fetch(`https://api.mymemory.translated.net/get?q=${enc}&langpair=en|${code}`);
    const d=await r.json(); return d.responseData?.translatedText||'Translation unavailable';
  }catch{ return 'Translation failed.'; }
}
