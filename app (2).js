/* ============================================================
   Novel Reader · 应用逻辑
   txt / epub 阅读器（自包含，离线可用）
   ============================================================ */
(function(){
  'use strict';

  /* ---------- 工具 ---------- */
  const $ = (s, el) => (el||document).querySelector(s);
  const $$ = (s, el) => Array.prototype.slice.call((el||document).querySelectorAll(s));

  function toast(msg){
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(()=>t.classList.remove('show'), 2000);
  }

  /* localStorage 安全封装（本地离线场景下也尽量用全局内存兜底） */
  const memStore = {};
  const store = {
    get(k){
      try{ const v = localStorage.getItem(k); return v==null? null : JSON.parse(v); }
      catch(e){ return k in memStore ? memStore[k] : null; }
    },
    set(k, v){
      try{ localStorage.setItem(k, JSON.stringify(v)); }
      catch(e){ memStore[k] = v; }
    }
  };

  /* IndexedDB 存书籍 Blob（避免 localStorage 容量限制），带降级 */
  function idbOpen(){
    return new Promise((resolve, reject)=>{
      if(!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open('novelreader', 1);
      req.onupgradeneeded = ()=> req.result.createObjectStore('books', {keyPath:'id'});
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }
  function idbSet(id, blob){
    return idbOpen().then(db=> new Promise((res, rej)=>{
      const tx = db.transaction('books','readwrite');
      tx.objectStore('books').put({id, blob});
      tx.oncomplete = ()=> res();
      tx.onerror = ()=> rej(tx.error);
    }));
  }
  function idbGet(id){
    return idbOpen().then(db=> new Promise((res, rej)=>{
      const tx = db.transaction('books','readonly');
      const rq = tx.objectStore('books').get(id);
      rq.onsuccess = ()=> res(rq.result ? rq.result.blob : null);
      rq.onerror = ()=> rej(rq.error);
    })).catch(()=> null);
  }
  function idbDel(id){
    return idbOpen().then(db=> new Promise((res, rej)=>{
      const tx = db.transaction('books','readwrite');
      tx.objectStore('books').delete(id);
      tx.oncomplete = ()=> res();
      tx.onerror = ()=> rej(tx.error);
    })).catch(()=>{});
  }

  /* ---------- 状态 ---------- */
  const TYPES = { EPUB:'epub', TXT:'txt' };
  let library = [];        // [{id,title,type,progress,progressText,txtText?}]
  let current = null;      // 当前打开的书籍对象
  let currentBook = null;  // epub: ePub 实例
  let currentRendition = null;
  let fontScale = parseFloat(store.get('fontScale')) || 1.0;
  let themeName = store.get('theme') || 'paper';
  let flowMode = store.get('flow') || 'scrolled';   // 默认滚动模式，分页渲染更重易卡

  /* ---------- 读取文件 ---------- */
  function pickFile(){
    $('#file-input').click();
  }
  function readFileInput(ev){
    const file = ev.target.files && ev.target.files[0];
    if(file) handleFile(file);
    ev.target.value = '';
  }
  function handleFile(file){
    const name = file.name || '';
    const dot = name.lastIndexOf('.');
    const ext = dot>-1 ? name.slice(dot+1).toLowerCase() : '';
    const isEpub = ext==='epub';
    const isTxt = ext==='txt';
    if(!isEpub && !isTxt){ toast('仅支持 .epub 或 .txt 文件'); return; }
    const id = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const title = dot>-1 ? name.slice(0,dot) : name;

    const entry = { id, title, type: isEpub?TYPES.EPUB:TYPES.TXT, progress:0, progressText:'未开始' };
    library.push(entry);

    if(isTxt){
      const reader = new FileReader();
      reader.onload = ()=>{
        const raw = String(reader.result||'');
        entry.txt = splitTxt(raw);
        persist();
        renderLibrary();
        openBook(entry);
      };
      reader.onerror = ()=>{ toast('读取失败'); };
      reader.readAsText(file);
    } else {
      // epub 存 Blob 到 IDB，读取时再打开
      idbSet(id, file).then(()=>{
        persist();
        renderLibrary();
        openBook(entry);
      }).catch(()=>{ toast('存储失败'); });
    }
  }

  /* ---------- txt 分章 ---------- */
  function splitTxt(text){
    // 规范化换行
    text = text.replace(/\r\n?/g, '\n');
    const re = /^\s*(第[0-9零一二三四五六七八九十百千万两]+[章节回卷集部篇]|Chapter\s*\d+|序章|序言|楔子|引子|尾声|后记|番外|Epilogue|Prologue)\s*[:：]?\s*/i;
    const lines = text.split('\n');
    const chapters = [];
    let cur = null;
    for(let i=0;i<lines.length;i++){
      const line = lines[i];
      if(re.test(line.trim())){
        const title = line.trim().replace(/^\s+/,'').slice(0,40);
        cur = { title, paras: [] };
        chapters.push(cur);
        // 标题行本身作为一段
        if(line.trim()) cur.paras.push(line.trim());
      } else {
        if(line.trim()){
          if(!cur){ cur = { title:'正文', paras: [] }; chapters.push(cur); }
          cur.paras.push(line.trim());
        }
      }
    }
    if(chapters.length===0){ chapters.push({ title:'正文', paras: [text.trim()] }); }
    return chapters;
  }

  /* ---------- 持久化 ---------- */
  function persist(){
    // 只存可序列化字段（txtText 不存，太大走 IDB 后备）
    const slim = library.map(b => ({
      id:b.id, title:b.title, type:b.type, progress:b.progress, progressText:b.progressText
    }));
    store.set('library', slim);
  }

  /* ---------- 库界面 ---------- */
  function renderLibrary(){
    const c = $('#book-list');
    c.innerHTML = '';
    if(library.length===0){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h12"/></svg><div>书架还是空的</div><div style="font-size:13px;margin-top:6px;">点击下方「导入书籍」开始阅读</div>';
      c.appendChild(empty);
      return;
    }
    library.forEach(book=>{
      const card = document.createElement('div');
      card.className = 'bookcard';
      const typeLbl = book.type===TYPES.EPUB ? 'EPUB' : 'TXT';
      card.innerHTML =
        '<div class="thumb">'+typeLbl+'</div>'+
        '<div class="meta">'+
          '<div class="name">'+esc(book.title)+'</div>'+
          '<div class="info">'+typeLbl+' · '+esc(book.progressText||'未开始')+'</div>'+
          '<div class="progress"><i style="width:'+Math.round((book.progress||0)*100)+'%"></i></div>'+
        '</div>';
      card.addEventListener('click', ()=> openBook(book));
      c.appendChild(card);
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

  /* ---------- 打开书籍 ---------- */
  function show(screen){ $$('.screen').forEach(el=> el.classList.add('hidden')); $('#'+screen).classList.remove('hidden'); }
  // 内容区显示切换（txt 与 epub 二选一，缺省都隐藏会导致空白）
  function setViewport(type){
    const tv = $('#txt-view'), vw = $('#viewer');
    if(type===TYPES.TXT){ tv.style.display=''; vw.style.display='none'; }
    else { tv.style.display='none'; vw.style.display=''; }
  }
  function showLoading(on){ const l=$('#loading'); if(l) l.classList.toggle('hidden', !on); }

  function openBook(book){
    current = book;
    $('#reader-title').textContent = book.title;
    show('screen-reader');
    showLoading(true);
    if(book.type===TYPES.TXT){ openTxt(book); }
    else { openEpub(book); }
  }

  /* --- txt --- */
  let txtIdx = 0;
  function openTxt(book){
    setViewport('txt');
    if(!book.txt){
      // 从 IDB 读取
      idbGet(book.id).then(blob=>{
        if(!blob){ toast('未找到正文'); showLoading(false); return; }
        const reader = new FileReader();
        reader.onload = ()=>{ book.txt = splitTxt(String(reader.result||'')); renderTxtChapter(book, book.progressIdx||0); };
        reader.onerror = ()=>{ toast('读取失败'); showLoading(false); };
        reader.readAsText(blob);
      });
      return;
    }
    renderTxtChapter(book, book.progressIdx||0);
  }
  function renderTxtChapter(book, idx){
    const chapters = book.txt;
    txtIdx = Math.max(0, Math.min(idx, chapters.length-1));
    const ch = chapters[txtIdx];
    const host = $('#txt-view');
    host.innerHTML = '';
    // 标题
    const h = document.createElement('div');
    h.className = 'chapter-title';
    h.textContent = ch.title;
    host.appendChild(h);
    // 段落
    ch.paras.forEach(p=>{
      const el = document.createElement('p');
      el.textContent = p;
      host.appendChild(el);
    });
    book.progressIdx = txtIdx;
    book.progress = txtIdx / Math.max(1, chapters.length-1 || 1);
    book.progressText = '第 ' + (txtIdx+1) + '/' + chapters.length + ' 章';
    updateNav();
    updateProgress(book);
    persist();
    showLoading(false);
  }
  function txtNext(){
    if(current && current.txt && txtIdx < current.txt.length-1){ renderTxtChapter(current, txtIdx+1); }
    else toast('已是最后一章');
  }
  function txtPrev(){
    if(current && current.txt && txtIdx > 0){ renderTxtChapter(current, txtIdx-1); }
    else toast('已是第一章');
  }

  /* --- epub --- */
  function openEpub(book){
    setViewport('epub');
    idbGet(book.id).then(blob=>{
      if(!blob){ toast('未找到书籍'); showLoading(false); return; }
      blob.arrayBuffer().then(buf=>{
        try{
          currentBook = ePub(buf);
          if(currentRendition){ try{ currentRendition.destroy(); }catch(e){} }
          currentRendition = currentBook.renderTo('viewer', {
            width:'100%', height:'100%',
            flow: (flowMode==='scrolled' ? 'scrolled' : 'paginated'),
            spread: 'none',
            allowScriptedContent:true
          });
          applyThemeToEpub();
          currentRendition.display(book.progressCfi || undefined);
          if(currentRendition && currentRendition.on){
            currentRendition.on('rendered', ()=> showLoading(false));
            currentRendition.on('displayed', ()=> showLoading(false));
          }
          currentRendition.on('relocated', (loc)=>{
            if(loc && loc.start && loc.start.cfi){
              current.progressCfi = loc.start.cfi;
              current.progress = loc.percentage || 0;
              current.progressText = Math.round((loc.percentage||0)*100) + '%';
              updateProgress(current);
              persist();
            }
          });
          updateNav();
          // 章节列表
          currentBook.loaded.navigation.then(nav=>{
            const tocEl = $('#toc');
            tocEl.innerHTML = '';
            nav.toc.forEach(item=>{
              const el = document.createElement('div');
              el.className = 'item';
              el.textContent = item.label || '';
              el.addEventListener('click', ()=>{
                currentRendition.display(item.href);
                toggleSheet('chapter-sheet', false);
              });
              tocEl.appendChild(el);
            });
          }).catch(()=>{ $('#toc').innerHTML = '<div class="item">（本书未提供目录）</div>'; });
        }catch(e){ toast('epub 打开失败：'+e.message); showLoading(false); }
      }).catch(()=>{ toast('读取失败'); showLoading(false); });
    });
  }
  function epubNext(){ if(currentRendition) currentRendition.next(); }
  function epubPrev(){ if(currentRendition) currentRendition.prev(); }
  function epubToc(){
    toggleSheet('chapter-sheet', true);
  }

  /* ---------- 导航/进度 ---------- */
  function updateNav(){
    const prevB = $('#btn-prev'), nextB = $('#btn-next');
    if(current){
      if(current.type===TYPES.TXT){
        prevB.disabled = txtIdx<=0;
        nextB.disabled = txtIdx>=(current.txt.length-1);
      } else {
        prevB.disabled = false; nextB.disabled = false;
      }
    }
  }
  function updateProgress(book){
    const li = library.find(b=> b.id===book.id);
    if(li){ li.progress = book.progress; li.progressText = book.progressText; }
  }

  /* ---------- 设置 ---------- */
  function toggleSheet(id, open){
    const s = $('#'+id);
    s.classList.toggle('open', open!==false ? true : false);
    if(open===false) s.classList.remove('open'); else s.classList.add('open');
  }
  function applyTheme(){
    document.body.className = 'theme-' + themeName;
    $$('.theme-dot').forEach(d=> d.classList.toggle('sel', d.dataset.theme===themeName));
    store.set('theme', themeName);
    applyThemeToEpub();
  }
  function applyThemeToEpub(){
    if(!currentRendition || !currentBook) return;
    try{
      const themes = currentRendition.themes;
      themes.register('myt', {
        'body': { 'background': themeBg(), 'color': themeInk() },
        'p': { 'font-size': (17*fontScale)+'px', 'line-height':'1.8', 'text-align':'justify' }
      });
      themes.select('myt');
    }catch(e){}
  }
  function themeBg(){
    return {paper:'#f5f1ea', sepia:'#f2e8d5', green:'#e7efe4', dark:'#191b20'}[themeName];
  }
  function themeInk(){
    return {paper:'#2b2620', sepia:'#4a3f2e', green:'#2f3a2c', dark:'#d8d3c9'}[themeName];
  }
  function applyFont(){
    document.documentElement.style.setProperty('--read-font', (18*fontScale)+'px');
    applyThemeToEpub();
  }
  function changeFont(d){
    fontScale = Math.max(0.7, Math.min(1.6, fontScale + d));
    store.set('fontScale', fontScale);
    $('#font-val').textContent = Math.round(fontScale*100)+'%';
    applyFont();
    if(current && current.type===TYPES.TXT){
      const host = $('#txt-view');
      host.style.fontSize = (18*fontScale)+'px';
    }
  }
  function refreshModeBtns(){
    const s = $('#mode-scroll'), p = $('#mode-paged');
    if(s) s.classList.toggle('on', flowMode==='scrolled');
    if(p) p.classList.toggle('on', flowMode!=='scrolled');
  }
  function setFlow(mode){
    flowMode = (mode==='scrolled') ? 'scrolled' : 'paginated';
    store.set('flow', flowMode);
    refreshModeBtns();
    if(current && current.type===TYPES.EPUB){
      // 重建渲染，切换模式
      openEpub(current);
    }
  }

  /* ---------- 返回 ---------- */
  function goBack(){
    if(currentRendition){ try{ currentRendition.destroy(); }catch(e){} }
    currentRendition = null; currentBook = null;
    current = null;
    renderLibrary();
    show('screen-library');
  }

  /* ---------- 删除书籍 ---------- */
  function deleteBook(){
    if(!current) return;
    if(!confirm('删除书籍「'+current.title+'」？')) return;
    idbDel(current.id);
    library = library.filter(b=> b.id!==current.id);
    persist();
    goBack();
  }

  /* ---------- 初始化 ---------- */
  function init(){
    // 绑定
    $('#btn-import').addEventListener('click', pickFile);
    $('#file-input').addEventListener('change', readFileInput);
    $('#reader-back').addEventListener('click', goBack);
    $('#btn-prev').addEventListener('click', ()=>{ current && current.type===TYPES.TXT ? txtPrev() : epubPrev(); });
    $('#btn-next').addEventListener('click', ()=>{ current && current.type===TYPES.TXT ? txtNext() : epubNext(); });
    $('#btn-toc').addEventListener('click', ()=>{ current && current.type===TYPES.EPUB ? epubToc() : toggleSheet('chapter-sheet', true); });
    $('#btn-settings').addEventListener('click', ()=> toggleSheet('settings', true));
    $('#btn-delete').addEventListener('click', deleteBook);
    $('#sheet-mask').addEventListener('click', ()=>{
      toggleSheet('settings', false); toggleSheet('chapter-sheet', false);
    });
    // 主题
    $$('.theme-dot').forEach(d=> d.addEventListener('click', ()=>{
      themeName = d.dataset.theme;
      applyTheme();
    }));
    // 字号
    $('#font-down').addEventListener('click', ()=> changeFont(-0.1));
    $('#font-up').addEventListener('click', ()=> changeFont(0.1));
    // 阅读模式
    $('#mode-scroll').addEventListener('click', ()=> setFlow('scrolled'));
    $('#mode-paged').addEventListener('click', ()=> setFlow('paginated'));
    refreshModeBtns();

    // 拖拽/粘贴导入（桌面调试用）
    document.addEventListener('dragover', e=> e.preventDefault());
    document.addEventListener('drop', e=>{
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(f) handleFile(f);
    });

    // 恢复库
    library = store.get('library') || [];
    renderLibrary();
    applyTheme();
    applyFont();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
