(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR, RANDOM_MODE, SYNC_SEED } = window.AppConfig;

  let running = false;
  let rafId   = null;

  // ---- АКТИВНОЕ СОСТОЯНИЕ ----
  let TL_active    = [];   // [{digit,freq,span,pairEnd}, ...]
  let dur_active   = [];   // мс на индекс
  let cum_active   = [];   // префиксные суммы мс
  let total_active = 0;    // длина цикла

  // ---- ОЖИДАЕМАЯ ВЕРСИЯ (для НЕ-append) ----
  let TL_pending    = null;
  let dur_pending   = null;
  let cum_pending   = null;
  let total_pending = 0;
  let switchAtMs    = null;

  // Якорь фазы (вычитается из времени при расчёте p)
  let phaseBiasMs   = 0;

  // Подсветка
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS   = 200;   // заглядываем вперёд ~0.2с
  const SCHED_TICK_MS  = 60;    // шаг планировщика
  let lastPlannedBoundaryMs = -1;

  // ===== УТИЛИТЫ =====
  function mulberry32(a){ return function(i){
    let t = (a + i) >>> 0;
    t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d) >>> 0;
    t ^= t >>> 12; t = Math.imul(t, 0x297a2d39) >>> 0;
    t ^= t >>> 15;
    return (t >>> 0) / 4294967296.0;
  };}

  function buildTimingFromTL(TL){
    if (!TL || !TL.length) return {dur:[], cum:[], total:0};
    const rnd = mulberry32(SYNC_SEED|0);
    const dur = new Array(TL.length);
    for (let i=0;i<TL.length;i++){
      const r     = (RANDOM_MODE === 'seeded') ? rnd(i) : 0.5;
      const base  = DUR.randMin + (DUR.randMax - DUR.randMin) * r;
      const extra = TL[i].pairEnd ? DUR.pairGap : 0;
      dur[i] = Math.round((base + extra) * (SPEED || 1));
    }
    const cum = dur.slice();
    for (let i=1;i<cum.length;i++) cum[i] += cum[i-1];
    const total = cum[cum.length-1] || 0;
    return {dur, cum, total};
  }

  // Текущая фаза с учётом якоря
  function phaseNow(total){
    if (!total) return 0;
    let p = (Data.serverNow() - SYNC_EPOCH_MS - phaseBiasMs) % total;
    return p < 0 ? p + total : p;
  }

  function indexForPhase(cum, p){
    let lo=0, hi=cum.length-1, ans=0;
    while (lo<=hi){
      const mid=(lo+hi)>>1;
      if (cum[mid] > p){ ans=mid; hi=mid-1; } else { lo=mid+1; }
    }
    return ans;
  }

  function nextBoundaryTime(total){
    const now = Data.serverNow();
    if (!total) return now;
    const k   = Math.floor((now - SYNC_EPOCH_MS) / total);
    return SYNC_EPOCH_MS + (k+1)*total;
  }

  function highlight(span){
    if (lastSpan && lastSpan !== span) lastSpan.classList.remove('active');
    if (span) span.classList.add('active');
    lastSpan = span;
  }

  // Сколько мс до конца текущего индекса (до границы)
  function msToIndexBoundary(p, cum) {
    const idx = indexForPhase(cum, p);
    const end = cum[idx];           // время конца текущего индекса (мс с начала цикла)
    return Math.max(0, end - p);    // сколько осталось
  }

  // ===== ПУБЛИЧНОЕ API =====
  const Player = {};

  Player.start = function(){
    if (running) return;

    const TL0 = (window.Visual && Visual.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : ((window.Visual && Visual.timeline) ? Visual.timeline.map(x=>({...x})) : []);
    const t0 = buildTimingFromTL(TL0);

    TL_active     = TL0;
    dur_active    = t0.dur;
    cum_active    = t0.cum;
    total_active  = t0.total;

    TL_pending    = null;
    dur_pending   = null;
    cum_pending   = null;
    total_pending = 0;
    switchAtMs    = null;
    phaseBiasMs   = 0;

    lastIdx  = -1;
    lastSpan = null;

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

  // Ключевая логика обновления
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual && Visual.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : ((window.Visual && Visual.timeline) ? Visual.timeline.map(x=>({...x})) : []);

    // Если не запущено — принять сразу
    if (!running || !total_active){
      const t = buildTimingFromTL(TL_new);
      TL_active    = TL_new;
      dur_active   = t.dur;
      cum_active   = t.cum;
      total_active = t.total;

      TL_pending    = null;
      dur_pending   = null;
      cum_pending   = null;
      total_pending = 0;
      switchAtMs    = null;
      phaseBiasMs   = 0;
      lastIdx       = -1;
      lastSpan      = null;
      return;
    }

    // Проверяем: это чистый APPEND?
    const oldN = TL_active.length;
    let isAppend = TL_new.length >= oldN;
    if (isAppend){
      for (let i=0; i<oldN; i++){
        const a = TL_active[i], b = TL_new[i];
        if (!b || a.digit !== b.digit) { isAppend = false; break; }
      }
    }

    if (isAppend){
      // 1) фиксируем текущую фазу по СТАРОЙ длине
      const pOld = phaseNow(total_active);

      // 2) достраиваем хвост (без трогания старой части)
      const rnd = mulberry32(SYNC_SEED|0);
      for (let i = oldN; i < TL_new.length; i++){
        const node = TL_new[i];
        TL_active.push(node);

        const r     = (RANDOM_MODE === 'seeded') ? rnd(i) : 0.5;
        const base  = DUR.randMin + (DUR.randMax - DUR.randMin) * r;
        const extra = node.pairEnd ? DUR.pairGap : 0;
        const dms   = Math.round((base + extra) * (SPEED || 1));

        dur_active.push(dms);
        const prev = (cum_active.length ? cum_active[cum_active.length-1] : 0);
        cum_active.push(prev + dms);
        total_active += dms;
      }

      // 3) подстроим якорь так, чтобы фаза ПОСЛЕ удлинения осталась pOld
      const now = Data.serverNow();
      phaseBiasMs = (now - SYNC_EPOCH_MS - pOld) % (total_active || 1);
      if (phaseBiasMs < 0) phaseBiasMs += (total_active || 1);

      return;
    }

    // Иначе НЕ-append: переключим на границе цикла (без рывка)
    const tNew = buildTimingFromTL(TL_new);
    TL_pending    = TL_new;
    dur_pending   = tNew.dur;
    cum_pending   = tNew.cum;
    total_pending = tNew.total;
    switchAtMs    = nextBoundaryTime(total_active);
  };

  // совместимость
  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    // Переключение НЕ-append строго на границе цикла
    if (switchAtMs && Data.serverNow() >= switchAtMs && TL_pending){
      phaseBiasMs = (switchAtMs - SYNC_EPOCH_MS) % (total_pending || 1);
      if (phaseBiasMs < 0) phaseBiasMs += (total_pending || 1);

      TL_active     = TL_pending;
      dur_active    = dur_pending;
      cum_active    = cum_pending;
      total_active  = total_pending;

      TL_pending    = null;
      dur_pending   = null;
      cum_pending   = null;
      total_pending = 0;
      switchAtMs    = null;

      lastIdx = -1; // чтобы подсветка обновилась
    }

    const N = TL_active.length;
    if (!N || !total_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Текущая фаза/индекс СЕЙЧАС
    const pNow   = phaseNow(total_active);
    const idxNow = indexForPhase(cum_active, pNow);

    // === ПЛАНИРОВЩИК: ставим ноту на СЛЕДУЮЩУЮ границу индекса ===
    const dtMs = msToIndexBoundary(pNow, cum_active);     // через сколько мс будет граница
    const boundaryAbs = Data.serverNow() + dtMs;          // UTC-мс момента границы

    if (dtMs <= LOOKAHEAD_MS && boundaryAbs !== lastPlannedBoundaryMs){
      lastPlannedBoundaryMs = boundaryAbs;

      // ВАЖНО: на границе начнётся СЛЕДУЮЩИЙ индекс
      const nextIdx = (idxNow + 1) % N;
      const node    = TL_active[nextIdx];
      const lenSec  = (DUR.noteLen || 0.35) * (SPEED || 1);

      const whenAbsTone = Tone.now() + Math.max(0, dtMs/1000);
      if (window.Synth && typeof Synth.trigger === 'function'){
        Synth.trigger(node.freq, lenSec, 0.8, whenAbsTone);
      }
    }

    // Подсветка — «по факту» текущего индекса (может отставать ≤ 1 кадра — это норм)
    if (idxNow !== lastIdx){
      const { digit, freq, span } = TL_active[idxNow];
      highlight(span);
      const debug = document.getElementById('debugInfo');
      if (debug) debug.textContent = `Играет: ${digit} → ${freq.toFixed(2)} Гц (idx ${idxNow})`;
      lastIdx = idxNow;
    }

    // Мягкий цикл планировщика
    setTimeout(()=>{ rafId = requestAnimationFrame(tick); }, SCHED_TICK_MS);
  }

  window.Player = Player;
})();
