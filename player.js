// player.js — ровная сетка + anti-miss + rotation + ЖУРНАЛ СМЕН (детерминированный boot)
(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;
  const GRID_MS = (window.AppConfig?.SYNC?.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // Активный TL и длина
  let TL_active = [];
  let N_active  = 0;

  // Отложенная замена TL на границе
  let TL_pending = null;
  let N_pending  = 0;
  let switchAtMs = null;

  // Индексный поворот (rotation)
  let idxOffset         = 0; // для активного TL
  let pendingIdxOffset  = 0; // применится при переключении

  // Визуал
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS      = Math.min(900, Math.floor(GRID_MS * 0.85));
  const SCHED_TICK_MS     = 30;
  const MISS_TOL_MS       = 150;
  let   lastScheduledBeat = null;

  const mod = (a,n)=> ((a % n) + n) % n;

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
  }

  // === утилиты журнала ===
  // первая грид-граница СТРОГО после t
  const firstBeatAfter = (t)=> Math.floor((t - SYNC_EPOCH_MS) / GRID_MS) + 1;

  // восстановление offset из журнала ^ изменений
  function computeOffsetFromChangeLog(changes){
    // changes: [{k, beat, n}, ...] по возрастанию k
    let off = 0;
    let N   = 0;
    for (const ch of (changes || [])){
      const b = +ch.beat|0;
      const n = +ch.n|0;
      if (!n) continue;

      if (N === 0){
        // первая по времени партия — появляется сразу, offset=0
        N = n;
        off = 0;
        continue;
      }
      // (b + off) mod N == (b + offNew) mod n
      // => offNew = ( (b + off) mod N - (b mod n) ) mod n
      const offNew = mod( mod(b + off, N) - mod(b, n), n );
      N = n;
      off = offNew;
    }
    return { off, Nfinal: N };
  }

  // rotation при аппенде «на лету» (как раньше)
  function computePendingRotationForContinuity(targetBeat){
    const nextIdxOld = mod(targetBeat + idxOffset, N_active);
    const base       = mod(targetBeat, N_pending);
    return mod(nextIdxOld - base, N_pending);
  }

  // планировать ноту для целевого beat
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

  // ===== публичное API =====
  const Player = {};

  Player.start = async function(){
    if (running) return;

    const TL0 = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);
    TL_active = TL0;
    N_active  = TL_active.length | 0;

    // 1) Тянем журнал смен и детерминированно рассчитываем offset на старте
    idxOffset = 0;
    try{
      const changes = await Data.getChangeLogOnce();
      const { off } = computeOffsetFromChangeLog(changes);
      if (Number.isFinite(off)) idxOffset = off;
    } catch(_){ /* ок */ }

    // 2) Сброс отложенных состояний
    TL_pending = null; N_pending = 0; switchAtMs = null;
    pendingIdxOffset = 0;

    // 3) Сброс визуала/планировщика
    lastIdx = -1; lastSpan = null; lastScheduledBeat = null;

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

  // Любые изменения TL — применяем на **детерминированной** границе, и логируем её
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);

    if (!running){
      TL_active = TL_new; N_active = TL_active.length | 0;
      // при «тихом» старте offset уже восстановлен из журнала
      TL_pending = null; N_pending = 0; switchAtMs = null; pendingIdxOffset = 0;
      lastIdx = -1; lastSpan = null; lastScheduledBeat = null;
      return;
    }

    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;
    if (N_pending === N_active){
      // ничего по сути не изменилось
      TL_pending = null; N_pending = 0; switchAtMs = null;
      return;
    }

    // Привязываем переключение к началу ТЕКУЩЕГО окна (у всех одинаково)
    const { windowStart, k } = Data.currentWindowInfo();
    const targetBeat = firstBeatAfter(windowStart);
    switchAtMs = SYNC_EPOCH_MS + targetBeat * GRID_MS;

    // rotation для непрерывности на границе
    if (N_active > 0 && N_pending > 0){
      pendingIdxOffset = computePendingRotationForContinuity(targetBeat);
    } else {
      pendingIdxOffset = 0;
    }

    // ЛОГИРУЕМ смену (одна запись на окно k)
    Data.announceChange(k, targetBeat, N_pending).catch(()=>{});

    // чтобы не осталось старых постановок в эту же границу
    lastScheduledBeat = null;
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  // ===== главный цикл =====
  function tick(){
    if (!running){ return; }

    const nowSrv  = Data.serverNow();
    const curBeat = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);

    // Переключение TL строго на заранее посчитанной границе
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      idxOffset = pendingIdxOffset; // применяем rotation
      lastIdx = -1;
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Подсветка: индекс по сетке с учётом rotation
    const idxNow = mod(curBeat + idxOffset, N_active);
    if (idxNow !== lastIdx){
      const cur = TL_active[idxNow];
      if (cur){
        highlight(cur.span);
        const debug = document.getElementById('debugInfo');
        if (debug) debug.textContent = `Играет: ${cur.digit} → ${cur.freq.toFixed(2)} Гц (idx ${idxNow})`;
      }
      lastIdx = idxNow;
    }

    // Планирование на следующий beat (или catch-up)
    const nextBeat    = curBeat + 1;
    const boundaryAbs = SYNC_EPOCH_MS + nextBeat * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;

    const switchIsNow = !!(switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= 8 && TL_pending);

    if (dtMs > 0 && dtMs <= LOOKAHEAD_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, boundaryAbs, switchIsNow, /*catch-up*/false);
    }
    if (dtMs <= 0 && -dtMs <= MISS_TOL_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, nowSrv + 10, switchIsNow, /*catch-up*/true);
    }

    setTimeout(()=>{ rafId = requestAnimationFrame(tick); }, SCHED_TICK_MS);
  }

  window.Player = Player;
})();
