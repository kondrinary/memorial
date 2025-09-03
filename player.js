// player.js — ровная сетка + anti-miss + непрерывность при append (index rotation)
(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;
  const GRID_MS = (window.AppConfig?.SYNC?.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // Активный TL и его длина
  let TL_active = [];
  let N_active  = 0;

  // Отложенная замена TL (на общей границе сетки)
  let TL_pending = null;
  let N_pending  = 0;
  let switchAtMs = null;

  // Индексный поворот (rotation), чтобы при append не было «отката»
  let idxOffset         = 0; // применяется к TL_active
  let pendingIdxOffset  = 0; // будет применён к TL_pending при переключении

  // Визуал
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS      = Math.min(900, Math.floor(GRID_MS * 0.85));
  const SCHED_TICK_MS     = 30;
  const MISS_TOL_MS       = 150;             // catch-up, если границу чуть проспали
  let   lastScheduledBeat = null;            // защита от двойной постановки одного и того же beat

  // ---------- helpers ----------
  const mod = (a,n)=> ((a % n) + n) % n;

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
  }

  // Проверка, что TL_new — это append к TL_active (префикс совпадает)
  function isAppendOfActive(TL_new){
    if (!TL_active || !TL_active.length) return true; // если пусто — считаем append
    if (!TL_new || TL_new.length < TL_active.length) return false;
    for (let i=0;i<TL_active.length;i++){
      if (!TL_new[i] || TL_new[i].digit !== TL_active[i].digit) return false;
    }
    return true;
  }

  // Вычисляем rotation для pending так, чтобы на целевом beat
  // следующий индекс в новом TL совпал с тем, что играл бы на старом TL.
  function computePendingRotationForContinuity(targetBeat){
    // Какой индекс заиграл бы «сейчас» на старом TL?
    const nextIdxOld = mod(targetBeat + idxOffset, N_active);
    // На новом TL хотим попасть в ТОТ ЖЕ индекс префикса.
    // Решаем: (targetBeat + pendingIdxOffset) mod N_pending = nextIdxOld
    const base = mod(targetBeat, N_pending);
    const rot  = mod(nextIdxOld - base, N_pending);
    return rot;
  }

  // Планирование ноты для целевого beat (универсально: и для active, и для pending)
  function scheduleForBeat(targetBeat, boundaryMs, usePendingTL, isCatchUp=false){
    lastScheduledBeat = targetBeat;

    const usePending = !!usePendingTL && TL_pending && N_pending > 0;
    const TL   = usePending ? TL_pending : TL_active;
    const N    = usePending ? N_pending  : N_active;
    const off  = usePending ? pendingIdxOffset : idxOffset;
    if (!N || !TL) return;

    const idx  = mod(targetBeat + off, N);
    const node = TL[idx];
    if (!node) return;

    const lenSec   = (DUR.noteLen || 0.35) * (SPEED || 1);
    const delaySec = Math.max(0, (boundaryMs - Data.serverNow()) / 1000);
    const whenAbs  = Tone.now() + (isCatchUp ? Math.max(0.01, delaySec) : delaySec);

    if (window.Synth?.trigger){
      Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
    }
  }

  // ---------- публичное API ----------
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

    idxOffset        = 0;
    pendingIdxOffset = 0;

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

      idxOffset        = 0;
      pendingIdxOffset = 0;

      lastIdx = -1;
      lastSpan = null;
      lastScheduledBeat = null;
      return;
    }

    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;

    const nowSrv   = Data.serverNow();
    const curBeat  = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);
    const nextBeat = curBeat + 1;
    switchAtMs     = SYNC_EPOCH_MS + nextBeat * GRID_MS;

    // rotation для pending:
    if (N_active > 0 && N_pending > 0 && isAppendOfActive(TL_pending)){
      pendingIdxOffset = computePendingRotationForContinuity(nextBeat);
    } else {
      // если это не append (например, полный пересбор) — начинаем «с нуля»
      pendingIdxOffset = 0;
    }

    // чтобы не осталась старая постановка на эту же границу
    lastScheduledBeat = null;
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  // ---------- главный цикл ----------
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

      // применяем новый rotation, чтобы не было «отката»
      idxOffset = pendingIdxOffset;

      lastIdx = -1;
      // lastScheduledBeat НЕ сбрасываем — планирование идёт по targetBeat
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Индекс по сетке с учётом rotation (для подсветки)
    const idxNow = mod(curBeat + idxOffset, N_active);

    // === Планирование звука на СЛЕДУЮЩИЙ beat (или catch-up, если промахнулись) ===
    const nextBeat    = curBeat + 1;
    const boundaryAbs = SYNC_EPOCH_MS + nextBeat * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;

    // 1) обычный план — если граница впереди и этот beat ещё не ставили
    if (dtMs > 0 && dtMs <= LOOKAHEAD_MS && lastScheduledBeat !== nextBeat){
      const usePending = !!(switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= 8 && TL_pending);
      scheduleForBeat(nextBeat, boundaryAbs, usePending, /*isCatchUp=*/false);
    }

    // 2) catch-up — если только что проскочили границу, и beat не поставлен
    if (dtMs <= 0 && -dtMs <= MISS_TOL_MS && lastScheduledBeat !== nextBeat){
      const usePending = !!(switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= 8 && TL_pending);
      scheduleForBeat(nextBeat, nowSrv + 10, usePending, /*isCatchUp=*/true);
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
