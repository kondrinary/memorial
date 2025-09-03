(function(){
  const startBtn    = document.getElementById('startBtn');
  const formSection = document.getElementById('formSection');
  const birthInput  = document.getElementById('birthInput');
  const deathInput  = document.getElementById('deathInput');
  const addBtn      = document.getElementById('addBtn');
  const statusEl    = document.getElementById('status');
  const rightPane   = document.getElementById('right');
  const debugInfo   = document.getElementById('debugInfo');
  const seedBtn     = document.getElementById('seedBtn');

    if (window.AppConfig && window.AppConfig.ENABLE_SEED === false) {
    if (seedBtn) seedBtn.style.display = 'none';
  } else {
    if (seedBtn) seedBtn.style.display = ''; // по умолчанию видно
  }

  // флаг: запускали ли плеер уже хотя бы раз
  let startedPlayback = false;

  // форматирование ввода
  function formatDateInput(el){
    let v = el.value.replace(/\D/g,'').slice(0,8);
    let out='';
    if(v.length>0) out+=v.slice(0,2);
    if(v.length>=3) out+='.'+v.slice(2,4);
    if(v.length>=5) out+='.'+v.slice(4,8);
    el.value=out;
  }
  birthInput.addEventListener('input',()=>formatDateInput(birthInput));
  deathInput.addEventListener('input',()=>formatDateInput(deathInput));

  // валидация ДД.ММ.ГГГГ
  function parseValidDate(str){
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str);
    if(!m) return null;
    const [_,dd,mm,yyyy]=m;
    const d = new Date(+yyyy, +mm-1, +dd);
    if(d.getFullYear()!=+yyyy || d.getMonth()!=+mm-1 || d.getDate()!=+dd) return null;
    return d;
  }

  // ====== КНОПКА «Старт» ======
  startBtn.addEventListener('click', async ()=>{
    if (typeof Tone === 'undefined'){
      debugInfo.textContent = 'Tone.js не загрузился. Проверьте интернет.';
      return;
    }
    try { await Tone.start(); }
    catch(e){ debugInfo.textContent='Браузер заблокировал аудио. Кликните ещё раз / разрешите звук.'; return; }

    try { 
  debugInfo.textContent = 'Загружаю пианино… (несколько секунд)';
  await Synth.init();                    // ← ВАЖНО: ждём загрузку семплов
  debugInfo.textContent = 'Пианино готово. Подписываюсь на базу…';
} catch(e){
  console.error(e); 
  debugInfo.textContent='Ошибка инициализации синтезатора.';
  return;
}

    // Firebase
    const ok = Data.init();
    if (!ok){
      debugInfo.textContent = 'Ошибка инициализации Firebase (config.js).';
      return;
    }

    startBtn.style.display = 'none';
    formSection.style.display = 'block';
    debugInfo.textContent = 'Подписываюсь на базу…';

    // Подписка: первый снапшот строит и запускает,
    // последующие — только добавляют новые пары в конец таймлайна.
    Data.subscribe((list)=>{
      if (!startedPlayback) {
        if (list.length === 0){
          rightPane.textContent = 'Нет данных для проигрывания. Добавьте дату ниже.';
          Visual.timeline = [];
          return; // ждём следующего снапшота
        }
        Visual.build(list);
        Player.start();
        startedPlayback = true;
        return;
      }
      // дальнейшие обновления: НЕ перезапускаем, только дополняем
      Visual.append(list);
    }, (err)=>{
      console.error('[RTDB on(value) error]', err);
      debugInfo.textContent = `Ошибка чтения из базы: ${err?.code || err?.name || 'unknown'} — ${err?.message || ''}`;
    });
  }); // ←←← ВОТ ЭТОГО ЗАКРЫВАЮЩЕГО "});" НЕ ХВАТАЛО

  // ====== КНОПКА «Добавить» (всегда активна) ======
  addBtn.addEventListener('click', ()=>{
    const bStr = birthInput.value.trim();
    const dStr = deathInput.value.trim();

    const bDate = parseValidDate(bStr);
    const dDate = parseValidDate(dStr);

    if(!bDate || !dDate){
      statusEl.textContent='Ошибка: формат строго ДД.ММ.ГГГГ';
      statusEl.style.color='red';
      return;
    }
    if(dDate.getTime() < bDate.getTime()){
      statusEl.textContent='Ошибка: дата смерти раньше даты рождения.';
      statusEl.style.color='red';
      return;
    }

    const bDigits = bStr.replace(/\D/g,'');
    const dDigits = dStr.replace(/\D/g,'');

    Data.pushDate(bDigits, dDigits);

    statusEl.textContent='Добавлено!';
    statusEl.style.color='green';
    birthInput.value=''; deathInput.value='';
  });

  // ====== КНОПКА «Тестовая запись» (всегда активна) ======
  seedBtn.addEventListener('click', async ()=>{
    if (debugInfo) debugInfo.textContent = 'Пробую добавить тестовую запись…';

    // Инициализируем Firebase, даже если "Старт" ещё не был нажат
    const okInit = Data.init();
    if (!okInit) {
      if (debugInfo) debugInfo.textContent = 'Firebase не инициализируется. Проверь config.js → firebaseConfig/databaseURL.';
      return;
    }

    const birth = '01011990';
    const death = '02022000';

    const okPush = await Data.pushDate(birth, death);
    if (okPush) {
      if (debugInfo) debugInfo.textContent = 'Тестовая запись добавлена в /' + (window.AppConfig?.DB_PATH || 'dates');
    } else {
      if (debugInfo) debugInfo.textContent = 'Ошибка записи (проверьте Rules и ветку DB_PATH).';
    }
  });

})();
