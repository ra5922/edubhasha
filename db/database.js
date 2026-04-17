'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  EduTranslate AI  —  Database Layer                        ║
 * ║  Implements all 8 tables from the ER Diagram:              ║
 * ║  USER · CONTENT · LANGUAGE · TRANSLATION                   ║
 * ║  AUDIO · SUBTITLE · FAVORITES · SETTINGS                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
const DB = {

  // ── Seed data for LANGUAGE table ────────────────────────────────────────────
  SEED_LANGUAGES: [
    { lang_id:'L001', lang_name:'Hindi',    tts_code:'hi-IN', mm_code:'hi', script:'हिंदी'    },
    { lang_id:'L002', lang_name:'Marathi',  tts_code:'mr-IN', mm_code:'mr', script:'मराठी'   },
    { lang_id:'L003', lang_name:'Gujarati', tts_code:'gu-IN', mm_code:'gu', script:'ગુજરાતી' },
    { lang_id:'L004', lang_name:'Tamil',    tts_code:'ta-IN', mm_code:'ta', script:'தமிழ்'   },
    { lang_id:'L005', lang_name:'Telugu',   tts_code:'te-IN', mm_code:'te', script:'తెలుగు'  }
  ],

  _id(p){ return p+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,6).toUpperCase(); },
  async _load(){ return new Promise(r=>chrome.storage.local.get('et_db4',d=>r(d.et_db4||null))); },
  async _save(db){ return new Promise(r=>chrome.storage.local.set({et_db4:db},r)); },

  async getDB(){
    let db = await this._load();
    if(!db){
      db = {
        // ── 8 Tables ──────────────────────────────────────────────────────────
        USER:        [],
        CONTENT:     [],
        LANGUAGE:    JSON.parse(JSON.stringify(this.SEED_LANGUAGES)),
        TRANSLATION: [],
        AUDIO:       [],
        SUBTITLE:    [],
        FAVORITES:   [],
        SETTINGS:    [],
        _version: 4
      };
      await this._save(db);
    }
    return db;
  },

  // ════════════════════ USER TABLE ════════════════════════════════════════════
  async createUser(name, email, prefLang){
    const db = await this.getDB();
    const ex = db.USER.find(u => u.email === email.toLowerCase().trim());
    if(ex) return { error: 'Email already registered', user: ex };
    const u = {
      user_id:        this._id('USR'),
      name:           name.trim(),
      email:          email.toLowerCase().trim(),
      preferred_lang: prefLang || 'L001',
      created_at:     new Date().toISOString(),
      last_login:     new Date().toISOString()
    };
    db.USER.push(u);
    await this._save(db);
    await this.createSettings(u.user_id);
    return { success: true, user: u };
  },
  async getUserById(id){   const db=await this.getDB(); return db.USER.find(u=>u.user_id===id)||null; },
  async getUserByEmail(e){ const db=await this.getDB(); return db.USER.find(u=>u.email===e.toLowerCase())||null; },
  async updateLastLogin(id){ const db=await this.getDB(); const u=db.USER.find(u=>u.user_id===id); if(u){u.last_login=new Date().toISOString();await this._save(db);} },
  async updateUserPref(id,lid){ const db=await this.getDB(); const u=db.USER.find(u=>u.user_id===id); if(u){u.preferred_lang=lid;await this._save(db);} },

  // ════════════════════ LANGUAGE TABLE ════════════════════════════════════════
  async getAllLanguages(){ const db=await this.getDB(); return db.LANGUAGE; },
  async getLanguageById(id){ const db=await this.getDB(); return db.LANGUAGE.find(l=>l.lang_id===id)||null; },

  // ════════════════════ CONTENT TABLE ═════════════════════════════════════════
  async createContent(type, origLang, url, title, rawText){
    const db = await this.getDB();
    const ex = url ? db.CONTENT.find(c=>c.url===url && c.content_type===type) : null;
    if(ex) return ex;
    const c = {
      content_id:    this._id('CNT'),
      content_type:  type,            // 'article' | 'youtube' | 'selection'
      orig_language: origLang || 'en',
      url:           url || '',
      title:         (title||'Untitled').slice(0,200),
      raw_text:      (rawText||'').slice(0,8000),
      created_at:    new Date().toISOString()
    };
    db.CONTENT.push(c);
    await this._save(db);
    return c;
  },
  async getContentById(id){ const db=await this.getDB(); return db.CONTENT.find(c=>c.content_id===id)||null; },

  // ════════════════════ TRANSLATION TABLE ═════════════════════════════════════
  async createTranslation(contentId, langId, translatedText, sourceLang){
    const db   = await this.getDB();
    const lang = db.LANGUAGE.find(l=>l.lang_id===langId);
    const t = {
      trans_id:        this._id('TRN'),
      content_id:      contentId,
      lang_id:         langId,
      source_lang:     sourceLang || 'en',
      target_lang:     lang ? lang.lang_name : langId,
      translated_text: translatedText,
      char_count:      translatedText.length,
      created_at:      new Date().toISOString()
    };
    db.TRANSLATION.push(t);
    await this._save(db);
    return t;
  },
  async getCachedTranslation(contentId, langId){ const db=await this.getDB(); return db.TRANSLATION.find(t=>t.content_id===contentId&&t.lang_id===langId)||null; },

  // ════════════════════ AUDIO TABLE ═══════════════════════════════════════════
  async createAudio(contentId, langId, audioFile){
    const db = await this.getDB();
    const a = {
      audio_id:   this._id('AUD'),
      content_id: contentId,
      lang_id:    langId,
      audio_file: audioFile || 'tts_browser',
      created_at: new Date().toISOString()
    };
    db.AUDIO.push(a);
    await this._save(db);
    return a;
  },

  // ════════════════════ SUBTITLE TABLE ════════════════════════════════════════
  async createSubtitle(contentId, langId, subtitleText){
    const db = await this.getDB();
    // Remove old subtitle for same content+lang before saving new one
    db.SUBTITLE = db.SUBTITLE.filter(s=>!(s.content_id===contentId&&s.lang_id===langId));
    const s = {
      subtitle_id:   this._id('SUB'),
      content_id:    contentId,
      lang_id:       langId,
      subtitle_text: subtitleText,
      created_at:    new Date().toISOString()
    };
    db.SUBTITLE.push(s);
    await this._save(db);
    return s;
  },
  async getSubtitle(contentId, langId){ const db=await this.getDB(); return db.SUBTITLE.find(s=>s.content_id===contentId&&s.lang_id===langId)||null; },

  // ════════════════════ FAVORITES TABLE ═══════════════════════════════════════
  async addFavorite(userId, contentId){
    const db = await this.getDB();
    if(db.FAVORITES.find(f=>f.user_id===userId&&f.content_id===contentId)) return { error:'Already saved' };
    const f = {
      favorite_id: this._id('FAV'),
      user_id:     userId,
      content_id:  contentId,
      saved_at:    new Date().toISOString()
    };
    db.FAVORITES.push(f);
    await this._save(db);
    return { success:true, favorite:f };
  },
  async getFavoritesByUser(userId){
    const db = await this.getDB();
    return db.FAVORITES
      .filter(f=>f.user_id===userId)
      .sort((a,b)=>new Date(b.saved_at)-new Date(a.saved_at))
      .map(f=>({
        ...f,
        content:      db.CONTENT.find(c=>c.content_id===f.content_id)||{},
        translations: db.TRANSLATION.filter(t=>t.content_id===f.content_id),
        subtitles:    db.SUBTITLE.filter(s=>s.content_id===f.content_id)
      }));
  },
  async removeFavorite(favId, userId){
    const db = await this.getDB();
    const before = db.FAVORITES.length;
    db.FAVORITES = db.FAVORITES.filter(f=>!(f.favorite_id===favId&&f.user_id===userId));
    if(db.FAVORITES.length < before){ await this._save(db); return true; }
    return false;
  },
  async clearFavorites(userId){ const db=await this.getDB(); db.FAVORITES=db.FAVORITES.filter(f=>f.user_id!==userId); await this._save(db); },

  // ════════════════════ SETTINGS TABLE ════════════════════════════════════════
  async createSettings(userId){
    const db = await this.getDB();
    if(db.SETTINGS.find(s=>s.user_id===userId)) return;
    const s = {
      settings_id:    this._id('SET'),
      user_id:        userId,
      tts_voice_type: 'female',
      tts_speed:      1.0,
      tts_pitch:      1.0,
      auto_translate: false,
      show_toolbar:   true,
      api_key:        '',
      updated_at:     new Date().toISOString()
    };
    db.SETTINGS.push(s);
    await this._save(db);
    return s;
  },
  async getSettingsByUser(userId){ const db=await this.getDB(); return db.SETTINGS.find(s=>s.user_id===userId)||null; },
  async updateSettings(userId, updates){
    const db = await this.getDB();
    const s  = db.SETTINGS.find(s=>s.user_id===userId);
    if(s){ Object.assign(s, updates, {updated_at:new Date().toISOString()}); await this._save(db); return s; }
    return null;
  },

  // ════════════════════ SESSION ════════════════════════════════════════════════
  async getActiveUser(){ return new Promise(r=>chrome.storage.local.get('et_uid4',d=>r(d.et_uid4||null))); },
  async setActiveUser(id){ return new Promise(r=>chrome.storage.local.set({et_uid4:id},r)); },
  async clearActiveUser(){ return new Promise(r=>chrome.storage.local.remove('et_uid4',r)); },

  // ════════════════════ EXPORT (for DB Stats panel) ════════════════════════════
  async exportDB(){ return this.getDB(); }
};
