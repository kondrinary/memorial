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


  // ===== ERROR плашка подключение и проверка =====
const errorBar = document.getElementById('errorBar');
const okBar    = document.getElementById('okBar');


// --- мини-переводчик по ключу из TEXTS ---
function tr(key, fallback){
  const lang = (typeof CURRENT_LANG === 'string' ? CURRENT_LANG : 'ru');
  const pack = (typeof TEXTS === 'object' && TEXTS[lang]) || {};
  return (key in pack) ? pack[key] : (fallback ?? key);
}

window.tr = tr;                       // ← чтобы player.js мог переводить
function setDebug(msg){               // ← единый вывод в нижнюю панель
  if (!debugInfo) return;
  debugInfo.textContent = (msg ?? '');
}
window.setDebug = setDebug;           // ← player.js тоже сможет вызвать

function showError(msg){
  if (!errorBar) return;
  errorBar.textContent = msg;
  errorBar.hidden = false;   // показать
}

function clearError(){
  if (!errorBar) return;
  errorBar.hidden = true;    // спрятать
  errorBar.textContent = '';
}

function showOk(msg){
  // при успехе скрываем ошибку
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
  
// если старт уже нажат (кнопка скрыта) — показываем playDesc, иначе introDesc
const isPlaying = (startBtn && startBtn.style.display === 'none');
document.querySelector("#introBox .desc").innerText = isPlaying ? L.playDesc : L.introDesc;


  document.getElementById("status").innerText = "";
  const contactsBar = document.getElementById("contactsBar");
  if (contactsBar) contactsBar.innerText = L.contacts;
}


const langBtn = document.getElementById("langBtn");
if (langBtn){
  langBtn.addEventListener("click", () => {
    CURRENT_LANG = (CURRENT_LANG === "ru" ? "en" : "ru");
    langBtn.innerText = (CURRENT_LANG === "ru" ? "ENG" : "РУС");
    applyTexts();

    
  // очищаем панели и debug при смене языка
  clearError();
  clearOk();
  setDebug('');


  // если старт ещё не нажали (кнопка видна) — показываем локализованное «ожидание»
  if (startBtn && startBtn.style.display !== 'none'){
    setDebug(tr('waitingStart'));
  }
  

  });
}

  

  // ===== Видимость seed-кнопки из config.js =====
  if (window.AppConfig && AppConfig.ENABLE_SEED === false && seedBtn) {
    seedBtn.style.display = 'none';
  }

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

  // ====== КНОПКА «Старт» ======
// при загрузке подтянуть тексты по текущему языку
clearError();
clearOk();
applyTexts();
setDebug(tr('waitingStart'));

// переключение описания при старте
startBtn.addEventListener('click', async ()=>{

  clearError();
  clearOk();
  // поменять описание на «play» и переключить фон fire -> noise
  document.querySelector("#introBox .desc").innerText = TEXTS[CURRENT_LANG].playDesc;
  const fire = document.getElementById('fireFrame');
  const noise = document.getElementById('noiseFrame');
  if (fire) fire.style.display = 'none';
  if (noise) noise.style.display = 'block';


// Tone.js не подключён
if (typeof Tone === 'undefined'){
  showError(tr('errToneMissing'));
  setDebug(tr('errToneMissing'));
  return;
}
// нет работает звук/браузер заблокировал аудио
try {
  await Tone.start();
} catch(e){
  showError(tr('errAudioBlocked'));
  setDebug(tr('errAudioBlocked'));
  return;
}

    // Синт
    try {
      if (debugInfo) setDebug(tr('statusPreparingSound'));
      await Synth.init();
      if (debugInfo) setDebug(tr('statusSoundReady'))
    } catch(e){
  console.error(e);
  showError(tr('errSynthInit'));
  setDebug(tr('errSynthInit'));
  return;
    }

// Firebase
const ok = Data.init();
if (!ok){
  showError(tr('errFirebaseInit'));
  setDebug(tr('errFirebaseInit'));
  return;
}

    // Единые «серверные» часы
    Data.watchServerOffset();

    // UI
    startBtn.style.display   = 'none';
    formSection.style.display = 'flex';
    if (debugInfo) setDebug(tr('statusSubscribing'))

    // Подписка на базу
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
  blendMode: 'screen',  // или 'lighter'
  blurPx: 6,
  trailAlpha: 0.10      // 0 — вообще без «послесвечения»
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

// ====== КНОПКА «Добавить» (с полосой ошибки) ======
addBtn.addEventListener('click', async ()=>{
  const bStr = birthInput.value.trim();
  const dStr = deathInput.value.trim();

  // перед новой проверкой прячем прошлые панели
  clearError();
  clearOk();

  const bDate = parseValidDate(bStr);
  const dDate = parseValidDate(dStr);

  if (!bDate || !dDate){
    showError(tr('errBadFormat')); // неверный формат даты
    return;
  }
  if (dDate.getTime() < bDate.getTime()){
    showError(tr('errDeathBeforeBirth')); // смерть раньше рождения
    return;
  }

  const bDigits = bStr.replace(/\D/g,'');
  const dDigits = dStr.replace(/\D/g,'');

  const ok = await Data.pushDate(bDigits, dDigits);
  if (ok){
    birthInput.value = '';
    deathInput.value = '';
    showOk( tr('okBar') ); // добавлено в базу
  } else {
    showError( tr('errWriteFailed') );  // ошибка записи в базу
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
      } else {
        if (debugInfo) debugInfo.textContent = tr('seedWriteFailed'); // ошибка записи
      }
    });
  }
})();
