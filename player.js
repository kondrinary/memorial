// player.js — ровная сетка + anti-miss + непрерывность при append (deterministic boot offset)
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

  // Индексный поворот (rotation)
  let idxOffset         = 0; // применяется к TL_active
  let pendingIdxOffset  = 0; // будет применён к TL_pending при переключении

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

  // ---------- детерминированный пересчёт offset при старте ----------
  function ceilDiv(a,b){ return Math.floor((a + b - 1)/b); }

  // «Первый beat строго ПОСЛЕ» момента t
  function firstBeatAfter(t){
    return Math.floor((t - SYNC_EPOCH_MS) / GRID_MS) + 1;
  }

  // Сколько цифр добавляет запись
  function digitsCount(item){
    if (Array.isArray(item.digits)) return item.digits.length;
    const s = (item.birth||'') + (item.death||'');
    return s.replace(/\D/g,'').length;
  }

  // На каком окне (k) активируется запись по её ts
  function activationWindowK(ts, WIN_MS){
    // k такое, что ts ∈ (windowStart(k-1), windowStart(k)]  => k = ceil((ts - epoch)/WIN_MS)
    return ceilDiv(ts - SYNC_EPOCH_MS, WIN_MS);
  }

  // Пересчёт idxOffset из истории (списка активных записей) — детерминированно
  function computeBootOffsetFromHistory(activeList){
    const { MS: WIN_MS } = (window.AppConfig?.WINDOW) || { MS: 1000 };

    // Группируем «сколько цифр добавилось» по каждому окну k
    const addByK = new Map();
    for (const it of activeList){
      const ts = +it.ts || 0;
      if (ts <= 0) continue;
      const k = activationWindowK(ts, WIN_MS);
      addByK.set(k, (addByK.get(k)||0) + digitsCount(it));
    }

    // Идём по окнам по возрастанию, эмулируя наши правила «switch на первом грид-пороге после окна»
    let N = 0;
    let off = 0;
    const ks = Array.from(addByK.keys()).sort((a,b)=>a-b);
    for (const k of ks){
      const add = addByK.get(k) || 0;
      if (add <= 0) continue;

      const windowStart = SYNC_EPOCH_MS + k * WIN_MS; // начало окна
      const targetBeat  = firstBeatAfter(windowStart); // наш детерминированный switch beat

      if (N === 0){
        // первая партия — просто появляется; offset остаётся 0
        N = add;
        off = 0;
        continue;
      }

      const N_new = N + add;

      // Формула ротации для непрерывности:
      // (targetBeat + off) mod N  ==  (targetBeat + off_new) mod N_new
      // => off_new = ( (targetBeat + off) mod N - (targetBeat mod N_new) ) mod N_new
      const nextIdxOld = mod(targetBeat + off, N);
      const off_new    = mod(nextIdxOld - mod(targetBeat, N_new), N_new);

      N = N_new;
      off = off_new;
    }

    return { off, Nfinal: N };
  }

  // ---------- rotation при аппенде в рантайме ----------
  function computePendingRotationForContinuity(targetBeat){
    const nextIdxOld = mod(targetBeat + idxOffset, N_active);
    const base       = mod(targetBeat, N_pending);
    return mod(nextIdxOld - base, N_pending);
  }

  // ---------- планирование ноты ----------
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

    // ДЕТЕРМИНИРОВАННО восстановим idxOffset из истории активного списка
    idxOffset = 0;
    try{
      if (Data && typeof Data.getActiveList === 'function'){
        const list = Data.getActiveList(); // уже отфильтровано по текущему окну
        const { off } = computeBootOffsetFromHistory(list);
        if (Number.isFinite(off)) idxOffset = off;
      }
    } catch(e){ /* noop */ }

    TL_pending = null;
    N_pending  = 0;
    switchAtMs = null;

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

  // Любые изменения TL — применяем на границе, привязанной к ОКНУ (детерминированно)
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual?.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : (window.Visual?.timeline ? Visual.timeline.map(x=>({...x})) : []);

    if (!running){
      TL_active = TL_new;
      N_active  = TL_active.length | 0;

      // При «тихом» старте пересчитаем offset заново из истории
      idxOffset = 0;
      try{
        if (Data?.getActiveList){
          const { off } = computeBootOffsetFromHistory(Data.getActiveList());
          if (Number.isFinite(off)) idxOffset = off;
        }
      } catch(_){}

      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;
      pendingIdxOffset = 0;

      lastIdx = -1;
      lastSpan = null;
      lastScheduledBeat = null;
      return;
    }

    TL_pending = TL_new;
    N_pending  = TL_pending.length | 0;

    // Берём границу для переключения из окна (у всех одинакова)
    let targetBeat;
    try{
      const { windowStart } = Data.currentWindowInfo();
      targetBeat = firstBeatAfter(windowStart);
    } catch(_){
      // фолбэк: как раньше (следующая грид-граница от текущего времени)
      const nowSrv = Data.serverNow();
      targetBeat = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS) + 1;
    }
    switchAtMs = SYNC_EPOCH_MS + targetBeat * GRID_MS;

    // Ротация для непрерывности (тоже из targetBeat)
    if (N_active > 0 && N_pending > 0){
      pendingIdxOffset = computePendingRotationForContinuity(targetBeat);
    } else {
      pendingIdxOffset = 0;
    }

    lastScheduledBeat = null; // на всякий
  };

  Player.rebuildAndResync = Player.onTimelineChanged;

  // ---------- главный цикл ----------
  function tick(){
    if (!running){ return; }

    const nowSrv  = Data.serverNow();
    const curBeat = Math.floor((nowSrv - SYNC_EPOCH_MS) / GRID_MS);

    // Переключение TL строго на нашей заранее посчитанной границе
    if (switchAtMs && nowSrv >= switchAtMs && TL_pending){
      TL_active  = TL_pending;
      N_active   = N_pending;
      TL_pending = null;
      N_pending  = 0;
      switchAtMs = null;

      // применяем rotation, чтобы не было «отката»
      idxOffset = pendingIdxOffset;

      lastIdx = -1;
    }

    if (!N_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Индекс по сетке с учётом rotation (для подсветки)
    const idxNow = mod(curBeat + idxOffset, N_active);

    // Планирование звука на следующий beat (или catch-up, если слегка проспали)
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
