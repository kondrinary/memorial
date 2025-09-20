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
  startBtn.addEventListener('click', async ()=>{
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
    formSection.style.display = 'block';
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

OverlayFX?.init({ rootEl: document.getElementById('stream'), enableNoise: true });

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

  // ====== КНОПКА «Добавить» ======
  addBtn.addEventListener('click', async ()=>{
    const bStr = birthInput.value.trim();
    const dStr = deathInput.value.trim();

    const bDate = parseValidDate(bStr);
    const dDate = parseValidDate(dStr);

    if (!bDate || !dDate){
      statusEl.textContent = 'Ошибка: формат строго ДД.ММ.ГГГГ';
      statusEl.style.color = 'red';
      return;
    }
    if (dDate.getTime() < bDate.getTime()){
      statusEl.textContent = 'Ошибка: дата смерти раньше даты рождения.';
      statusEl.style.color = 'red';
      return;
    }

    const bDigits = bStr.replace(/\D/g,'');
    const dDigits = dStr.replace(/\D/g,'');

    const ok = await Data.pushDate(bDigits, dDigits);
    if (ok){
      statusEl.textContent = 'Добавлено!';
      statusEl.style.color = 'green';
      birthInput.value = '';
      deathInput.value = '';
    } else {
      statusEl.textContent = 'Ошибка записи. Проверьте соединение/Rules.';
      statusEl.style.color = 'red';
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
