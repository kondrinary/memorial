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



if (!ENABLE_SEED) {
  const seedBtn = document.getElementById('seedBtn');
  if (seedBtn) seedBtn.style.display = "none";
}

  function applyTexts() {
  const t = TEXTS[CURRENT_LANG];



  document.getElementById("startBtn").innerText = t.startBtn;
  document.getElementById("birthInput").placeholder = t.birthInput;
  document.getElementById("deathInput").placeholder = t.deathInput;
  document.querySelector("#introBox .title").innerText = t.projectTitle;
  document.querySelector("#introBox .desc").innerText = t.introDesc;
  document.getElementById("status").innerText = ""; // сюда можно выводить описание на проигрывании

  const contactsBar = document.getElementById("contactsBar");
  if (contactsBar) contactsBar.innerText = t.contacts;  

}

const langBtn = document.getElementById("langBtn");
if (langBtn){
  langBtn.addEventListener("click", () => {
    CURRENT_LANG = (CURRENT_LANG === "ru" ? "en" : "ru");
    langBtn.innerText = (CURRENT_LANG === "ru" ? "ENG" : "РУС");
    applyTexts();
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
applyTexts();

// переключение описания при старте
startBtn.addEventListener('click', async ()=>{

  clearError();
  // поменять описание на «play» и переключить фон fire -> noise
  document.querySelector("#introBox .desc").innerText = TEXTS[CURRENT_LANG].playDesc;
  const fire = document.getElementById('fireFrame');
  const noise = document.getElementById('noiseFrame');
  if (fire) fire.style.display = 'none';
  if (noise) noise.style.display = 'block';


    if (typeof Tone === 'undefined'){
      if (debugInfo) debugInfo.textContent = 'Tone.js не загрузился. Проверьте интернет.';
      return;
    }
    try {
      await Tone.start();
    } catch(e){
      if (debugInfo) debugInfo.textContent = 'Браузер заблокировал аудио. Кликните ещё раз / разрешите звук.';
      return;
    }

    // Синт
    try {
      if (debugInfo) debugInfo.textContent = 'Готовлю звук…';
      await Synth.init();
      if (debugInfo) debugInfo.textContent = 'Звук готов.';
    } catch(e){
      console.error(e);
      if (debugInfo) debugInfo.textContent = 'Ошибка инициализации синтезатора.';
      return;
    }

    // Firebase
    const ok = Data.init();
    if (!ok){
      if (debugInfo) debugInfo.textContent = 'Ошибка инициализации Firebase (config.js).';
      return;
    }

    // Единые «серверные» часы
    Data.watchServerOffset();

    // UI
    startBtn.style.display   = 'none';
    formSection.style.display = 'flex';
    if (debugInfo) debugInfo.textContent = 'Подписываюсь на базу…';

    // Подписка на базу
    let startedPlayback = false;
    Data.subscribe((list)=>{
      if (!startedPlayback){
        if (!list || list.length === 0){
          rightPane.textContent = 'Нет данных для проигрывания. Добавьте дату ниже.';
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
      if (debugInfo) debugInfo.textContent = `Ошибка чтения из базы: ${err?.code || err?.name || 'unknown'} — ${err?.message || ''}`;
    });
  });

// ====== КНОПКА «Добавить» (с полосой ошибки) ======
addBtn.addEventListener('click', async ()=>{
  const bStr = birthInput.value.trim();
  const dStr = deathInput.value.trim();

  // прячем прошлую ошибку перед проверкой
  clearError();

  const bDate = parseValidDate(bStr);
  const dDate = parseValidDate(dStr);

  if (!bDate || !dDate){
    showError('Ошибка: формат строго ДД.ММ.ГГГГ');
    return;
  }
  if (dDate.getTime() < bDate.getTime()){
    showError('Ошибка: дата смерти раньше даты рождения.');
    return;
  }

  const bDigits = bStr.replace(/\D/g,'');
  const dDigits = dStr.replace(/\D/g,'');

  const ok = await Data.pushDate(bDigits, dDigits);
  if (ok){
    // успех → прячем ошибку и чистим поля
    clearError();
    birthInput.value = '';
    deathInput.value = '';
    // статус можно не трогать (пусть остаётся описанием воспроизведения)
  } else {
    showError('Ошибка записи. Проверьте соединение/Rules.');
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
      if (debugInfo) debugInfo.textContent = 'Пробую добавить тестовую запись…';

      const okInit = Data.init();
      if (!okInit){
        if (debugInfo) debugInfo.textContent = 'Firebase не инициализируется. Проверь config.js.';
        return;
      }

      const preset = SEED_PRESETS[seedIndex % SEED_PRESETS.length];
      seedIndex++;

      const okPush = await Data.pushDate(preset.b, preset.d);
      if (okPush){
        if (debugInfo) debugInfo.textContent = 'Тестовая запись добавлена: ' + preset.b + ' – ' + preset.d;
      } else {
        if (debugInfo) debugInfo.textContent = 'Ошибка записи (Rules/сеть).';
      }
    });
  }
})();
