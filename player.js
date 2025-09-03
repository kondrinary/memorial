// player.js — индекс по РОВНОЙ сетке + анти-пропуск границы (catch-up)
(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;
  const GRID_MS = (window.AppConfig?.SYNC?.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // Активный TL (только цифры/частоты/ссылки на спаны)
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
  const LOOKAHEAD_MS    = Math.min(900, Math.floor(GRID_MS * 0.85)); // большой lookahead, чтобы не промахнуться
  const SCHED_TICK_MS   = 30;   // чаще тикаем
  const MISS_TOL_MS     = 150;  // если границу чуть ПРОСПАЛИ — всё равно сыграть (catch-up)
  let   lastScheduledBeat = null; // защита от двойной постановки в один и тот же beat

  function nextGridBoundaryMs(nowMs, epochMs, gridMs){
    const beat = Math.floor((nowMs - epochMs) / gridMs);
    return { nextMs: epochMs + (beat + 1) * gridMs, beat };
  }

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
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

    const nowSrv = Data.serverNow();
    const { nextMs } = nextGridBoundaryMs(nowSrv, SYNC_EPOCH_MS, GRID_MS);
    switchAtMs = nextMs;

    // чтобы не осталась старая постановка на эту же границу
    lastScheduledBeat = null;
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    const nowSrv = Data.serverNow();

    // Переключение TL строго на общей границе сетки
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      lastIdx = -1;
      lastScheduledBeat = null;
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Индекс по сетке (железная синхронизация)
    const curBeat   = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);
    const idxNow    = ((curBeat % N_active) + N_active) % N_active;

    // === Планирование звука на СЛЕДУЮЩУЮ границу (или catch-up, если промахнулись) ===
    const boundaryAbs = SYNC_EPOCH_MS + (curBeat + 1) * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;

    // 1) обычный план — если граница впереди и мы ещё не ставили этот beat
    if (dtMs > 0 && dtMs <= LOOKAHEAD_MS && lastScheduledBeat !== (curBeat + 1)){
      scheduleForBeat(curBeat + 1, boundaryAbs, idxNow);
    }

    // 2) catch-up — если граница только что прошла, а мы её не поставили (мобилки могут «уснуть»)
    if (dtMs <= 0 && -dtMs <= MISS_TOL_MS && lastScheduledBeat !== (curBeat + 1)){
      // ставим «прямо сейчас + 10мс», чтобы не пропустить ноту текущего шага
      scheduleForBeat(curBeat + 1, nowSrv + 10, idxNow, /*isCatchUp=*/true);
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

  function scheduleForBeat(targetBeat, boundaryMs, idxNow, isCatchUp=false){
    lastScheduledBeat = targetBeat;

    // Если на этой границе назначено переключение TL — играем первый элемент нового TL
    let node;
    if (switchAtMs && Math.abs(boundaryMs - switchAtMs) <= 8 && TL_pending){
      node = TL_pending[0];
    } else {
      const nextIdx = (idxNow + 1) % N_active;
      node = TL_active[nextIdx];
    }

    if (!node) return;

    const lenSec  = (DUR.noteLen || 0.35) * (SPEED || 1);
    const delaySec= Math.max(0, (boundaryMs - Data.serverNow()) / 1000);
    const whenAbs = Tone.now() + (isCatchUp ? Math.max(0.01, delaySec) : delaySec);

    if (window.Synth?.trigger){
      Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
    }
  }

  window.Player = Player;
})();
