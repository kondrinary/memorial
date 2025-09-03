(function(){
  // Настройки из конфига
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;

  // === ВАЖНО ===
  // Ровная сетка: один общий шаг для всех устройств.
  // Можно задать в AppConfig.SYNC.GRID_MS, иначе возьмём 700 мс по умолчанию.
  const GRID_MS = (window.AppConfig && AppConfig.SYNC && AppConfig.SYNC.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // ---- АКТИВНОЕ СОСТОЯНИЕ ----
  let TL_active = [];  // [{digit,freq,span,pairEnd}, ...]
  let N_active  = 0;

  // ---- ОЖИДАЕМАЯ ВЕРСИЯ (применяется на общей границе сетки) ----
  let TL_pending = null;
  let N_pending  = 0;
  let switchAtMs = null;  // абсолютное UTC-время, когда переключаем TL

  // Подсветка
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS    = 300;   // заглядываем вперёд (мобилки любят побольше)
  const SCHED_TICK_MS   = 40;    // частота тиков планировщика
  const BOUNDARY_EPS_MS = 8;     // допуск сравнения моментов границы
  let lastPlannedBoundaryMs = -1; // защита от двойного планирования

  // ===== УТИЛИТЫ =====

  // Следующая общая граница РОВНОЙ сетки
  function nextGridBoundaryMs(nowMs, epochMs, gridMs){
    const beat = Math.floor((nowMs - epochMs) / gridMs);
    return epochMs + (beat + 1) * gridMs;
  }

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
  }

  // ===== ПУБЛИЧНОЕ API =====
  const Player = {};

  Player.start = function(){
    if (running) return;

    // Берём «снимок» таймлайна от Visual
    const TL0 = (window.Visual && Visual.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : ((window.Visual && Visual.timeline) ? Visual.timeline.map(x=>({...x})) : []);

    TL_active = TL0;
    N_active  = TL_active.length | 0;

    TL_pending = null;
    N_pending  = 0;
    switchAtMs = null;

    lastIdx = -1;
    lastSpan = null;
    lastPlannedBoundaryMs = -1;

    running = true;
    rafId = requestAnimationFrame(tick);
  };

  Player.stop = function(){
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (lastSpan) lastSpan.classList.remove('active');
    lastSpan = null;
    lastIdx = -1;
  };

  // Любое изменение TL (append/rebuild) применяем СТРОГО на ближайшей границе сетки
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual && Visual.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : ((window.Visual && Visual.timeline) ? Visual.timeline.map(x=>({...x})) : []);

    // Если не запущено — принять сразу
    if (!running){
      TL_active = TL_new;
      N_active  = TL_active.length | 0;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;
      lastIdx    = -1;
      lastSpan   = null;
      lastPlannedBoundaryMs = -1;
      return;
    }

    // Подготовим отложенное переключение на ближайшей общей границе сетки
    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;

    const nowSrv = Data.serverNow();
    switchAtMs   = nextGridBoundaryMs(nowSrv, SYNC_EPOCH_MS, GRID_MS);

    // Чтобы не сыграть «старую» ноту на этой же границе — сбросим маркер планирования
    lastPlannedBoundaryMs = -1;
  };

  // совместимость
  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    const nowSrv = Data.serverNow();

    // Переключение строго на общей границе сетки
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;

      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      lastIdx = -1;
      lastPlannedBoundaryMs = -1;
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // === ИНДЕКС ПО РОВНОЙ СЕТКЕ (железная синхронизация)
    const beat   = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);
    const idxNow = ((beat % N_active) + N_active) % N_active;

    // === ПЛАНИРОВЩИК: ставим ноту на СЛЕДУЮЩУЮ общую границу сетки ===
    const boundaryAbs = SYNC_EPOCH_MS + (beat + 1) * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;

    if (dtMs <= LOOKAHEAD_MS &&
        Math.abs(boundaryAbs - lastPlannedBoundaryMs) > BOUNDARY_EPS_MS){

      lastPlannedBoundaryMs = boundaryAbs;

      // Если на этой границе назначено переключение TL — играем ПЕРВЫЙ элемент НОВОГО TL
      let node;
      if (switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= BOUNDARY_EPS_MS && TL_pending){
        node = TL_pending[0];
      } else {
        const nextIdx = (idxNow + 1) % N_active;
        node = TL_active[nextIdx];
      }

      const lenSec = (DUR.noteLen || 0.35) * (SPEED || 1);
      const whenAbs = Tone.now() + Math.max(0, dtMs / 1000);
      if (window.Synth && typeof Synth.trigger === 'function' && node){
        Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
      }
    }

    // Подсветка текущего индекса (по факту «сейчас»)
    if (idxNow !== lastIdx){
      const cur = TL_active[idxNow];
      if (cur) {
        highlight(cur.span);
        const debug = document.getElementById('debugInfo');
        if (debug) debug.textContent = `Играет: ${cur.digit} → ${cur.freq.toFixed(2)} Гц (idx ${idxNow})`;
      }
      lastIdx = idxNow;
    }

    // Мягкий цикл планировщика
    setTimeout(()=>{ rafId = requestAnimationFrame(tick); }, SCHED_TICK_MS);
  }

  window.Player = Player;
})();
