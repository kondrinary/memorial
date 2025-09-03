// player.js — индекс по РОВНОЙ сетке + anti-miss + непрерывность при append
(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;
  const GRID_MS = (window.AppConfig?.SYNC?.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // Активный TL (цифры/частоты/ссылки на спаны)
  let TL_active = [];
  let N_active  = 0;

  // Отложенная замена TL (на общей границе сетки)
  let TL_pending = null;
  let N_pending  = 0;
  let switchAtMs = null;

  // Визуал
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS     = Math.min(900, Math.floor(GRID_MS * 0.85));
  const SCHED_TICK_MS    = 30;
  const MISS_TOL_MS      = 150;      // catch-up, если границу чуть проспали
  let   lastScheduledBeat= null;     // защита от двойной постановки одного и того же beat

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
  }

  function scheduleForBeat(targetBeat, boundaryMs, isCatchUp=false){
    lastScheduledBeat = targetBeat;

    // Вычисляем индекс ноты **из целевого beat**, чтобы не было «отката»
    if (switchAtMs && Math.abs(boundaryMs - switchAtMs) <= 8 && TL_pending) {
      // На границе переключения: продолжить по времени на новом TL
      if (!N_pending) return;
      const nextIdxNew = ((targetBeat % N_pending) + N_pending) % N_pending;
      const node = TL_pending[nextIdxNew];
      if (node && window.Synth?.trigger){
        const lenSec  = (DUR.noteLen || 0.35) * (SPEED || 1);
        const delaySec= Math.max(0, (boundaryMs - Data.serverNow()) / 1000);
        const whenAbs = Tone.now() + (isCatchUp ? Math.max(0.01, delaySec) : delaySec);
        Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
      }
    } else {
      // Обычный случай: продолжаем по временнОй сетке на активном TL
      if (!N_active) return;
      const nextIdx = ((targetBeat % N_active) + N_active) % N_active;
      const node    = TL_active[nextIdx];
      if (node && window.Synth?.trigger){
        const lenSec  = (DUR.noteLen || 0.35) * (SPEED || 1);
        const delaySec= Math.max(0, (boundaryMs - Data.serverNow()) / 1000);
        const whenAbs = Tone.now() + (isCatchUp ? Math.max(0.01, delaySec) : delaySec);
        Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
      }
    }
  }

  const Player = {};

  Player.start = function(){
    if (running) return;

    const TL0 = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);

    TL_active = TL0;
    N_active  = TL_active.length | 0;

    TL_pending = null;
    N_pending  = 0;
    switchAtMs = null;

    lastIdx = -1;
    lastSpan = null;
    lastScheduledBeat = null;

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

  // Любые изменения TL — применяем на ближайшей общей границе сетки
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);

    if (!running){
      TL_active = TL_new;
      N_active  = TL_active.length | 0;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;
      lastIdx = -1;
      lastSpan = null;
      lastScheduledBeat = null;
      return;
    }

    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;

    const nowSrv   = Data.serverNow();
    const curBeat  = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);
    const nextMs   = SYNC_EPOCH_MS + (curBeat + 1) * GRID_MS;
    switchAtMs     = nextMs;

    // Сброс, чтобы не осталось старой постановки на эту же границу
    lastScheduledBeat = null;
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    const nowSrv  = Data.serverNow();
    const curBeat = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);

    // Переключение TL строго на общей границе сетки
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      lastIdx = -1;
      // Не трогаем lastScheduledBeat: планирование идёт по targetBeat
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Индекс по сетке (железная синхронизация)
    const idxNow = ((curBeat % N_active) + N_active) % N_active;

    // === Планирование звука на СЛЕДУЮЩИЙ beat (или catch-up, если промахнулись) ===
    const nextBeat    = curBeat + 1;
    const boundaryAbs = SYNC_EPOCH_MS + nextBeat * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;

    // 1) обычный план — если граница впереди и этот beat ещё не ставили
    if (dtMs > 0 && dtMs <= LOOKAHEAD_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, boundaryAbs, /*isCatchUp=*/false);
    }

    // 2) catch-up — если только что проскочили границу, и beat не поставлен
    if (dtMs <= 0 && -dtMs <= MISS_TOL_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, nowSrv + 10, /*isCatchUp=*/true);
    }

    // Подсветка текущего индекса
    if (idxNow !== lastIdx){
      const cur = TL_active[idxNow];
      if (cur){
        highlight(cur.span);
        const debug = document.getElementById('debugInfo');
        if (debug) debug.textContent = `Играет: ${cur.digit} → ${cur.freq.toFixed(2)} Гц (idx ${idxNow})`;
      }
      lastIdx = idxNow;
    }

    setTimeout(()=>{ rafId = requestAnimationFrame(tick); }, SCHED_TICK_MS);
  }

  window.Player = Player;
})();
