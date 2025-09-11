// player.js — сетка + anti-miss + rotation + журнал смен (deterministic boot)
(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR } = window.AppConfig;
  const GRID_MS = (window.AppConfig?.SYNC?.GRID_MS) || 700;

  let running = false;
  let rafId   = null;

  // Активный TL
  let TL_active = [];
  let N_active  = 0;

  // Отложенная замена на границе
  let TL_pending = null;
  let N_pending  = 0;
  let switchAtMs = null;

  // Индексный поворот
  let idxOffset        = 0;   // для активного TL
  let pendingIdxOffset = 0;   // прим. при переключении

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

  // журнал: первая «грид-граница СТРОГО после t»
  const firstBeatAfter = (t)=> Math.floor((t - SYNC_EPOCH_MS) / GRID_MS) + 1;

  // offset из журнала [{k,beat,n}, ...] (по возрастанию k)
  function computeOffsetFromChangeLog(changes){
    let off = 0, N = 0;
    for (const ch of (changes || [])){
      const b = +ch.beat|0, n = +ch.n|0;
      if (!n) continue;
      if (N === 0){ N = n; off = 0; continue; }
      const offNew = mod( mod(b + off, N) - mod(b, n), n );
      N = n; off = offNew;
    }
    return { off, Nfinal: N };
  }

  // rotation при аппенде «вживую»
  function computePendingRotationForContinuity(targetBeat){
    const nextIdxOld = mod(targetBeat + idxOffset, N_active);
    const base       = mod(targetBeat, N_pending);
    return mod(nextIdxOld - base, N_pending);
  }

  // планирование ноты на целевой beat
  function scheduleForBeat(targetBeat, whenMs, usePendingTL, isCatchUp=false){
    lastScheduledBeat = targetBeat;
    const usePending = !!usePendingTL && TL_pending && N_pending > 0;
    const TL  = usePending ? TL_pending : TL_active;
    const N   = usePending ? N_pending  : N_active;
    const off = usePending ? pendingIdxOffset : idxOffset;
    if (!N || !TL) return;

    const idx  = mod(targetBeat + off, N);
    const node = TL[idx];
    if (!node) return;

    const lenSec   = (DUR.noteLen || 0.35) * (SPEED || 1);
    
    const bufferSec = (AppConfig?.AUDIO?.BUFFER_SEC ?? 0);
    const delaySec  = Math.max(0, (whenMs - Data.serverNow()) / 1000) + bufferSec;

    const whenAbs  = Tone.now() + (isCatchUp ? Math.max(0.01, delaySec) : delaySec);
    if (window.Synth?.trigger){
      Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
    }
  }

  const Player = {};

  Player.start = async function(){
    if (running) return;

    const TL0 = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);
    TL_active = TL0;
    N_active  = TL_active.length | 0;

    // детерминированно восстановим offset из журнала
    idxOffset = 0;
    try{
      const changes = await Data.getChangeLogOnce();
      const { off } = computeOffsetFromChangeLog(changes);
      if (Number.isFinite(off)) idxOffset = off;
    } catch(_){}

    TL_pending = null; N_pending = 0; switchAtMs = null;
    pendingIdxOffset = 0;
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

  // изменение TL (append/rebuild) — на детерминированной границе, и логируем её
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);

    if (!running){
      TL_active = TL_new; N_active = TL_active.length | 0;
      idxOffset = 0;
      try{
        Data.getChangeLogOnce().then(ch=>{
          const { off } = computeOffsetFromChangeLog(ch);
          if (Number.isFinite(off)) idxOffset = off;
        });
      }catch(_){}
      TL_pending = null; N_pending = 0; switchAtMs = null; pendingIdxOffset = 0;
      lastIdx = -1; lastSpan = null; lastScheduledBeat = null;
      return;
    }

    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;
    if (N_pending === N_active){ // реально ничего не поменялось
      TL_pending = null; N_pending = 0; switchAtMs = null;
      return;
    }

    // привяжем переключение к НАЧАЛУ текущего окна (одинаково у всех)
    const { windowStart, k } = Data.currentWindowInfo();
    const targetBeat = firstBeatAfter(windowStart);
    switchAtMs = SYNC_EPOCH_MS + targetBeat * GRID_MS;

    // ротация, чтобы не было «отката»
    if (N_active > 0 && N_pending > 0){
      pendingIdxOffset = computePendingRotationForContinuity(targetBeat);
    } else {
      pendingIdxOffset = 0;
    }

    // логируем смену (один раз на окно k)
    Data.announceChange(k, targetBeat, N_pending).catch(()=>{});

    lastScheduledBeat = null;
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    const nowSrv  = Data.serverNow();
    const curBeat = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);

    // переключение на заранее вычисленной границе
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      idxOffset = pendingIdxOffset;  // применяем rotation
      lastIdx = -1;
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // подсветка
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

    // планирование на следующий beat (или catch-up)
    const nextBeat    = curBeat + 1;
    const boundaryAbs = SYNC_EPOCH_MS + nextBeat * GRID_MS;
    const dtMs        = boundaryAbs - nowSrv;
    const switchIsNow = !!(switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= 8 && TL_pending);

    if (dtMs > 0 && dtMs <= LOOKAHEAD_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, boundaryAbs, switchIsNow, false);
    }
    if (dtMs <= 0 && -dtMs <= MISS_TOL_MS && lastScheduledBeat !== nextBeat){
      scheduleForBeat(nextBeat, nowSrv + 10, switchIsNow, true);
    }

    setTimeout(()=>{ rafId = requestAnimationFrame(tick); }, SCHED_TICK_MS);
  }

  window.Player = Player;
})();
