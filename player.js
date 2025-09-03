// player.js — синхронное проигрывание от SYNC_EPOCH_MS.
// • При ДОБАВЛЕНИИ дат (append) динамически наращиваем активный таймлайн
//   и СХРАНЯЕМ текущую фазу (без скачка).
// • При НЕ-append изменениях (удаление/перестановка) — переключаемся
//   на границе цикла с якорем фазы.

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
      //    pNew = (now - epoch - bias) % total_active == pOld
      // => bias = (now - epoch - pOld) % total_active
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

    // Переключение НЕ-append на границе
    if (switchAtMs && Data.serverNow() >= switchAtMs && TL_pending){
      // Якорь: новый цикл начнётся строго с 0
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

      lastIdx = -1;
    }

    const N = TL_active.length;
    if (!N || !total_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    const p   = phaseNow(total_active);
    const idx = indexForPhase(cum_active, p);
    if (idx !== lastIdx){
      const { digit, freq, span } = TL_active[idx];
      const lenSec = (DUR.noteLen || 0.35) * (SPEED || 1);
      if (window.Synth && typeof Synth.trigger === 'function'){
        Synth.trigger(freq, lenSec, 0.8);
      }
      highlight(span);
      const debug = document.getElementById('debugInfo');
      if (debug) debug.textContent = `Играет: ${digit} → ${freq.toFixed(2)} Гц (idx ${idx})`;
      lastIdx = idx;
    }

    rafId = requestAnimationFrame(tick);
  }

  window.Player = Player;
})();
