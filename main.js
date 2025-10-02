// main.js — UI + старт, подписка, формат/валидация, добавление, тест-записи
(function(){
  // ===== DOM =====
  const startBtn     = document.getElementById('startBtn');
  const formSection  = document.getElementById('formSection');
  const birthInput   = document.getElementById('birthInput');
  const deathInput   = document.getElementById('deathInput');
  const addBtn       = document.getElementById('addBtn');
  const statusEl     = document.getElementById('status');
  const rightPane    = document.getElementById('right');
  const debugInfo    = document.getElementById('debugInfo');
  const seedBtn      = document.getElementById('seedBtn');

  // ===== ERROR/OK плашки =====
  const errorBar = document.getElementById('errorBar');
  const okBar    = document.getElementById('okBar');

  // --- мини-переводчик по ключу из TEXTS ---
  function tr(key, fallback){
    const lang = (typeof CURRENT_LANG === 'string' ? CURRENT_LANG : 'ru');
    const pack = (typeof TEXTS === 'object' && TEXTS[lang]) || {};
    return (key in pack) ? pack[key] : (fallback ?? key);
  }

  window.tr = tr;                       // чтобы другие модули могли переводить
  function setDebug(msg){               // единый вывод в панель дебага
    if (!debugInfo) return;
    debugInfo.textContent = (msg ?? '');
  }
  window.setDebug = setDebug;

  document.documentElement.classList.remove('app-started');

  function showError(msg){
    if (!errorBar) return;
    errorBar.textContent = msg;
    errorBar.hidden = false;
    if (okBar) { okBar.hidden = true; okBar.textContent = ''; }
  }
  function clearError(){
    if (!errorBar) return;
    errorBar.hidden = true;
    errorBar.textContent = '';
  }
  function showOk(msg){
    if (errorBar){ errorBar.hidden = true; errorBar.textContent = ''; }
    if (!okBar) return;
    okBar.textContent = msg;
    okBar.hidden = false;
  }
  function clearOk(){
    if (!okBar) return;
    okBar.hidden = true;
    okBar.textContent = '';
  }

  // Скрыть seed-кнопку из конфигурации
  if (!ENABLE_SEED) {
    const seedBtn = document.getElementById('seedBtn');
    if (seedBtn) seedBtn.style.display = "none";
  }

  function applyTexts() {
    const L = TEXTS[CURRENT_LANG];

    document.getElementById("startBtn").innerText = L.startBtn;
    document.getElementById("birthInput").placeholder = L.birthInput;
    document.getElementById("deathInput").placeholder = L.deathInput;
    document.querySelector("#introBox .title").innerText = L.projectTitle;
    document.getElementById("addBtn").innerText = L.addBtn;

      const contactsCardText = document.getElementById('contactsCardText');
  if (contactsCardText) contactsCardText.innerHTML = L.contacts;

    // если старт уже нажат (кнопка скрыта) — показываем playDesc, иначе introDesc
    const isPlaying = (startBtn && startBtn.style.display === 'none');
    document.querySelector("#introBox .desc").innerText = isPlaying ? L.playDesc : L.introDesc;

    document.getElementById("status").innerText = "";
    const contactsBar = document.getElementById("contactsBar");
    if (contactsBar) contactsBar.innerHTML = L.contacts;

    // inline-кнопка «что сейчас играет» если создана — локализуем
    const nowInline = document.getElementById('nowPlayInline');
    if (nowInline) nowInline.textContent = L.nowPlayingBtn || 'что сейчас звучит?';

    // правое «ухо» — языковая кнопка (ENG/РУС)
    const dbRight = document.getElementById('dbRight');
    if (dbRight) dbRight.textContent = (CURRENT_LANG === 'ru' ? 'ENG' : 'РУС');
  }
  // делаем доступной из внешних блоков
  window.applyTexts = applyTexts;

  // ===== Форматирование ввода "ДД.ММ.ГГГГ" =====
  function formatDateInput(el){
    let v = el.value.replace(/\D/g,'').slice(0,8);
    let out = '';
    if (v.length > 0) out += v.slice(0,2);
    if (v.length >= 3) out += '.' + v.slice(2,4);
    if (v.length >= 5) out += '.' + v.slice(4,8);
    el.value = out;
  }
  birthInput?.addEventListener('input', ()=>formatDateInput(birthInput));
  deathInput?.addEventListener('input', ()=>formatDateInput(deathInput));

  // ===== Валидация "ДД.ММ.ГГГГ" =====
  function parseValidDate(str){
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str);
    if (!m) return null;
    const [_, dd, mm, yyyy] = m;
    const d = new Date(+yyyy, +mm - 1, +dd);
    if (d.getFullYear() !== +yyyy || d.getMonth() !== (+mm - 1) || d.getDate() !== +dd) return null;
    return d;
  }

  // ===== стартовые тексты =====
  clearError(); clearOk(); applyTexts(); setDebug(tr('waitingStart'));

  // ====== КНОПКА «Старт» ======
  startBtn.addEventListener('click', async ()=>{
    clearError(); clearOk();



    // описание → play
    document.querySelector("#introBox .desc").innerText = TEXTS[CURRENT_LANG].playDesc;
    const fire  = document.getElementById('fireFrame');
    const noise = document.getElementById('noiseFrame');
    if (fire)  fire.style.display  = 'none';
    if (noise) noise.style.display = 'block';

    if (typeof Tone === 'undefined'){
      showError(tr('errToneMissing'));
      setDebug(tr('errToneMissing'));
      return;
    }
    try {
      await Tone.start();
    } catch(e){
      showError(tr('errAudioBlocked'));
      setDebug(tr('errAudioBlocked'));
      return;
    }

    try {
      if (debugInfo) setDebug(tr('statusPreparingSound'));
      await Synth.init();
      if (debugInfo) setDebug(tr('statusSoundReady'));
    } catch(e){
      console.error(e);
      showError(tr('errSynthInit'));
      setDebug(tr('errSynthInit'));
      return;
    }

    const ok = Data.init();
    if (!ok){
      showError(tr('errFirebaseInit'));
      setDebug(tr('errFirebaseInit'));
      return;
    }

    Data.watchServerOffset();

    startBtn.style.display    = 'none';
    formSection.style.display = 'flex';
    if (debugInfo) setDebug(tr('statusSubscribing'));

     document.documentElement.classList.add('app-started'); 
    // ← маркер: перешли на второй экран (для «ушей»/счётчика)
    document.dispatchEvent(new Event('app-started'));

    let startedPlayback = false;
    Data.subscribe((list)=>{
      if (!startedPlayback){
        if (!list || list.length === 0){
          rightPane.textContent = tr('statusNoData');
          return;
        }
        if (window.Visual && typeof Visual.build === 'function') {
          Visual.build(list);
        }

        OverlayFX.init({
          rootEl: document.getElementById('stream'),
          blendMode: 'screen',
          blurPx: 6,
          trailAlpha: 0.10
        });

        if (window.Player && typeof Player.start === 'function') {
          Player.start();
        }
        startedPlayback = true;
        return;
      }

      if (window.Visual && typeof Visual.append === 'function') {
        Visual.append(list);
      }
      if (window.Player && typeof Player.onTimelineChanged === 'function') {
        Player.onTimelineChanged();
      }
    }, (err)=>{
      console.error('[RTDB on(value) error]', err);
      if (debugInfo) debugInfo.textContent =
        `${tr('dbReadError')}: ${err?.code || err?.name || 'unknown'} — ${err?.message || ''}`;
    });
  });

  // ====== КНОПКА «Добавить» ======
  addBtn.addEventListener('click', async ()=>{
    const bStr = birthInput.value.trim();
    const dStr = deathInput.value.trim();

    clearError(); clearOk();

    const bDate = parseValidDate(bStr);
    const dDate = parseValidDate(dStr);

    if (!bDate || !dDate){
      showError(tr('errBadFormat'));
      return;
    }
    if (dDate.getTime() < bDate.getTime()){
      showError(tr('errDeathBeforeBirth'));
      return;
    }

    const bDigits = bStr.replace(/\D/g,'');
    const dDigits = dStr.replace(/\D/g,'');

    const ok = await Data.pushDate(bDigits, dDigits);
    if (ok){
      birthInput.value = '';
      deathInput.value = '';
      showOk(tr('okBar'));

      // показать низ, где появляется новая запись
      setTimeout(()=> {
        const pane = document.getElementById('right');
        if (pane) pane.scrollTop = pane.scrollHeight;
      }, 60);
    } else {
      showError(tr('errWriteFailed'));
    }
  });

  // ====== КНОПКА «Тестовая запись» ======
  const SEED_PRESETS = [
    { b:'01011990', d:'02022000' },
    { b:'15071985', d:'22092010' },
    { b:'31121970', d:'01012000' },
    { b:'03031999', d:'04042004' }
  ];
  let seedIndex = 0;

  if (seedBtn){
    seedBtn.addEventListener('click', async ()=>{
      if (debugInfo) debugInfo.textContent = tr('seedAdding');

      const okInit = Data.init();
      if (!okInit){
        if (debugInfo) debugInfo.textContent = tr('seedInitFailed');
        return;
      }

      const preset = SEED_PRESETS[seedIndex % SEED_PRESETS.length];
      seedIndex++;

      const okPush = await Data.pushDate(preset.b, preset.d);
      if (okPush){
        if (debugInfo) debugInfo.textContent = `${tr('seedAdded')} ${preset.b} – ${preset.d}`;
        setTimeout(()=> {
          const pane = document.getElementById('right');
          if (pane) pane.scrollTop = pane.scrollHeight;
        }, 60);
      } else {
        if (debugInfo) debugInfo.textContent = tr('seedWriteFailed');
      }
    });
  }

  // === локализация на старте
  window.addEventListener('load', applyTexts);
})();

/* === Фактическая высота плашки контактов -> сдвиг дебага (если контакт-бар включат) === */
(function(){
  const bar = document.getElementById('contactsBar');
  if (!bar) return;
  const apply = () => {
    const h = bar.offsetHeight || 0;
    document.documentElement.style.setProperty('--contacts-current-h', h + 'px');
  };
  if (typeof ResizeObserver !== 'undefined'){
    try{ new ResizeObserver(apply).observe(bar); }catch(e){}
  }
  window.addEventListener('load', apply);
  window.addEventListener('resize', apply);
})();

/* === Верхние «уши» у дебага: слева — счётчик (только после старта), справа — переключатель языка === */
(function(){
  // убедимся, что уши есть
  let left  = document.getElementById('dbLeft');
  if (!left){
    left = document.createElement('div');
    left.id = 'dbLeft';
    left.className = 'debug-side';
    document.body.appendChild(left);
  }
  let right = document.getElementById('dbRight');
  if (!right){
    right = document.createElement('button');
    right.id = 'dbRight';
    right.className = 'debug-side';
    document.body.appendChild(right);
  }

  // правое «ухо» — языковая кнопка
  function syncLangEar(){ right.textContent = (CURRENT_LANG === 'ru' ? 'ENG' : 'РУС'); }
  right.onclick = ()=>{
    CURRENT_LANG = (CURRENT_LANG === 'ru' ? 'en' : 'ru');
    syncLangEar();
    window.applyTexts && window.applyTexts();

    // Скрыть бары при переключении языка
const ok   = document.getElementById('okBar');
const err  = document.getElementById('errorBar');
if (ok) ok.hidden = true;
if (err) err.hidden = true;


    // НЕ теряем дебаг на первом экране: вернём «ожидание старта»
    const startBtn = document.getElementById('startBtn');
    if (startBtn && startBtn.style.display !== 'none'){
      window.setDebug && window.setDebug(tr('waitingStart'));
    }

    // перерисовать счётчик на новом языке
    renderCount(computeCount());
    document.dispatchEvent(new Event('lang-changed'));
  };
  syncLangEar();

  // левое «ухо»: счётчик по таймлайну (pairEnd)
  function computeCount(){
    try{
      if (window.Visual && Array.isArray(Visual.timeline)){
        return Visual.timeline.reduce((acc, x)=> acc + (x && x.pairEnd ? 1 : 0), 0);
      }
    }catch(e){}
    return 0;
  }
  function renderCount(n){
    const L = (typeof TEXTS === 'object' && TEXTS[CURRENT_LANG]) || (TEXTS && TEXTS.ru) || { dbCount:'N={n}' };
    left.textContent = (L.dbCount || 'N={n}').replace('{n}', n);
  }

  // показываем левое «ухо» только после старта
  function syncDbLeftVisibility(){
    const startBtn = document.getElementById('startBtn');
    const onSecondScreen = !startBtn || startBtn.style.display === 'none';
    left.style.display = onSecondScreen ? 'block' : 'none';
  }

  // первичная отрисовка и видимость
  renderCount(computeCount());
  syncDbLeftVisibility();

  // автообновление цифры
  const REFRESH = (window.AppConfig && AppConfig.UI && AppConfig.UI.DB_COUNT_REFRESH_MS) || 4000;
  if (!left.__countTimer){
    left.__countTimer = setInterval(()=>renderCount(computeCount()), REFRESH);
  }

  // события
  document.addEventListener('app-started', ()=>{
    syncDbLeftVisibility();
    renderCount(computeCount());
  });
  document.addEventListener('lang-changed', ()=> renderCount(computeCount()));
  window.addEventListener('load', syncDbLeftVisibility);
})();

/* === Inline «что сейчас играет» в ряд с формами (кнопку создаём после addBtn) === */
(function(){
  const addBtn = document.getElementById('addBtn');
  const L = (typeof TEXTS === 'object' && TEXTS[CURRENT_LANG]) || (TEXTS && TEXTS.ru) || {};
  if (addBtn && !document.getElementById('nowPlayInline')){
    const btn = document.createElement('button');
    btn.id = 'nowPlayInline';
    btn.type = 'button';
    btn.className = addBtn.className || '';
    btn.textContent = L.nowPlayingBtn || 'что сейчас звучит?';
    addBtn.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', ()=>{
      const pane   = document.getElementById('right');
      const stream = document.getElementById('stream');
      if (!pane || !stream) return;
      const el = stream.querySelector('.digit.active, .active');
      if (!el) return;
      const paneRect = pane.getBoundingClientRect();
      const elRect   = el.getBoundingClientRect();
      const topInPane = elRect.top - paneRect.top + pane.scrollTop;
      const targetTop = Math.max(0, topInPane - (pane.clientHeight - el.clientHeight)/2);
      pane.scrollTo({ top: targetTop, behavior: 'smooth' });
    });

    // после появления кнопки — пересчитать ширину баров
    window.recalcBarsWidth && window.recalcBarsWidth();
  }
})();

/* === Автоприлипание к НИЗУ вертикального контейнера #right (пока пользователь не скроллит) === */
(function(){
  const pane   = document.getElementById('right');
  const stream = document.getElementById('stream');
  if (!pane || !stream) return;

  let stick = true;

  function atBottom(){
    return (pane.scrollHeight - pane.clientHeight - pane.scrollTop) < 8;
  }
  function keepAtBottom(){
    if (stick){
      pane.scrollTop = pane.scrollHeight;
    }
  }

  function onUserScroll(){ stick = atBottom(); }
  pane.addEventListener('scroll', onUserScroll, { passive:true });
  pane.addEventListener('wheel',  onUserScroll, { passive:true });
  pane.addEventListener('touchmove', onUserScroll, { passive:true });

  if (typeof MutationObserver !== 'undefined'){
    const mo = new MutationObserver(()=> requestAnimationFrame(keepAtBottom));
    mo.observe(stream, { childList:true, subtree:true, characterData:true });
  }

  if (window.Data && typeof Data.pushDate === 'function' && !Data.__wrappedPushDate){
    const _push = Data.pushDate;
    Data.pushDate = async function(...args){
      try{
        const ok = await _push.apply(this, args);
        setTimeout(keepAtBottom, 30);
        return ok;
      }catch(e){
        setTimeout(keepAtBottom, 30);
        throw e;
      }
    };
    Data.__wrappedPushDate = true;
  }

  window.addEventListener('load', keepAtBottom);
  setTimeout(keepAtBottom, 120);
})();



// === Раскладка верхнего дебага: одинаковая линия, зазоры, узкий режим ===
(function(){
  const root = document.documentElement;
  const dbLeft  = document.getElementById('dbLeft');
  const dbRight = document.getElementById('dbRight');
  const dbg     = document.getElementById('debugInfo');

  if (!dbLeft || !dbRight || !dbg) return;

  function px(n){ return Math.max(0, Math.round(n)) + 'px'; }

  function layout(){
    const minGap = parseInt(getComputedStyle(root).getPropertyValue('--debug-min-gap')) || 16;

    const lRect = dbLeft.getBoundingClientRect();
    const rRect = dbRight.getBoundingClientRect();
    const dRect = dbg.getBoundingClientRect();

    // ширина «ушей» + минимальные отступы
    const leftReserve  = (lRect.width  ? (lRect.width  + minGap) : 0);
    const rightReserve = (rRect.width ? (rRect.width + minGap) : 0);

    root.style.setProperty('--debug-left-reserve',  px(leftReserve));
    root.style.setProperty('--debug-right-reserve', px(rightReserve));

    // если «уши» съели почти весь центр — включаем компактный режим
    const tooTight = (leftReserve + rightReserve + 40) > dRect.width; // +40 — небольшая страховка
    root.classList.toggle('debug-tight', tooTight);
  }

  // считать при загрузке/ресайзе/смене языка/обновлении счётчика
  window.addEventListener('load', layout);
  window.addEventListener('resize', layout);
  document.addEventListener('lang-changed', layout);

  // если у тебя счётчик обновляется по таймеру — пересчитываем после него:
  if (window.AppConfig?.UI?.DB_COUNT_REFRESH_MS){
    setInterval(layout, Math.min(AppConfig.UI.DB_COUNT_REFRESH_MS, 3000));
  }

  // и сразу
  layout();
})();




/* === OK/ERROR бары: строго МЕЖДУ формой и описанием, но только ПОСЛЕ старта === */
(function(){
  const ok    = document.getElementById('okBar');
  const err   = document.getElementById('errorBar');
  const form  = document.getElementById('formSection');
  const intro = document.getElementById('introBox');      // плашка описания
  if (!ok || !err || !form || !intro) return;

  // Размещение баров между формой и описанием — выполняем только после старта
  function placeBetween(){
    form.insertAdjacentElement('afterend', ok);
    ok.insertAdjacentElement('afterend', err);
    err.insertAdjacentElement('afterend', intro);

    // сразу за описанием ставим карточку контактов
const contactsCard = document.getElementById('contactsCard');
if (contactsCard) intro.insertAdjacentElement('afterend', contactsCard);


    window.recalcBarsWidth && window.recalcBarsWidth();
  }

  // если уже на втором экране (после refresh) — разместить сразу
  const startBtn = document.getElementById('startBtn');
  if (!startBtn || startBtn.style.display === 'none'){ placeBetween(); }
  // а в обычном случае — дождаться события старта
  document.addEventListener('app-started', placeBetween);

  // Подгон ширины: от левого края birth до правого края nowPlayInline (или addBtn)
  const pane = document.querySelector('.left-inner');
  function applyBarsWidth(){
    const leftEl   = document.getElementById('birthInput');
    const rightEl  = document.getElementById('nowPlayInline') || document.getElementById('addBtn');
    const col1Ref  = document.querySelector('.left-inner .card'); // начало левой колонки
    if (!pane || !leftEl || !rightEl || !col1Ref) return;

    const paneRect  = pane.getBoundingClientRect();
    const col1Left  = col1Ref.getBoundingClientRect().left - paneRect.left + pane.scrollLeft;

    const Labs      = leftEl.getBoundingClientRect().left  - paneRect.left + pane.scrollLeft;
    const Rabs      = rightEl.getBoundingClientRect().right - paneRect.left + pane.scrollLeft;
    const L         = Math.max(0, Labs - col1Left);
    const W         = Math.max(0, Rabs - Labs);

    document.documentElement.style.setProperty('--bars-left',  L + 'px');
    document.documentElement.style.setProperty('--bars-width', W + 'px');
  }
  window.recalcBarsWidth = applyBarsWidth;

  window.addEventListener('load',   applyBarsWidth);
  window.addEventListener('resize', applyBarsWidth);
  if (typeof ResizeObserver !== 'undefined'){
    try{
      new ResizeObserver(applyBarsWidth).observe(pane);
      new ResizeObserver(applyBarsWidth).observe(form);
      new ResizeObserver(applyBarsWidth).observe(intro);
    }catch(e){}
  }
  setTimeout(applyBarsWidth, 120);
})();


// === Упрощённый центр для дебаг-текста в верхней полосе ===
(function(){
  const di = document.getElementById('debugInfo');
  if (!di) return;

  let center = di.querySelector('.di-center');
  if (!center){
    center = document.createElement('span');
    center.className = 'di-center';
    center.textContent = di.textContent || '';
    di.textContent = '';
    di.appendChild(center);
  }

  const oldSetDebug = window.setDebug;
  window.setDebug = function(msg){
    center.textContent = (msg ?? '');
    if (typeof oldSetDebug === 'function'){
      try{ oldSetDebug(msg); }catch(e){}
    }
  };
})();


// === Авто-скейл шрифтов для портретного экрана (мобилка) ===
(function(){
  const root = document.documentElement;

  // базовое значение из CSS (:root { --ui-scale: … })
  const cssVal = getComputedStyle(root).getPropertyValue('--ui-scale').trim();
  const base   = Number(cssVal) || 1;

  // запомним базу один раз
  if (!root.__uiBase) root.__uiBase = base;

  function applyScale(){
    const w = Math.max(1, window.innerWidth  || 1);
    const h = Math.max(1, window.innerHeight || 1);
    const portrait = h > w;

    // капы можно вынести в конфиг (не обязательно):
    const capMax = (window.AppConfig?.UI?.MOBILE_SCALE_MAX) ?? (root.__uiBase * 1.5);
    const capMin = (window.AppConfig?.UI?.MOBILE_SCALE_MIN) ??  root.__uiBase;

    let scale = root.__uiBase;
    if (portrait){
      // пропорционально соотношению сторон, но в разумных пределах
      const k = 0.90 * (h / w);              // «чувствительность»
      scale = Math.max(capMin, Math.min(capMax, root.__uiBase * k));
    }
    root.style.setProperty('--ui-scale', scale.toFixed(3));
  }

  window.addEventListener('load', applyScale);
  window.addEventListener('resize', applyScale);
  window.addEventListener('orientationchange', applyScale);

  // на всякий случай — наружу
  window.applyResponsiveUIScale = applyScale;
})();

