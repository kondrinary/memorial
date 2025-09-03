(function(){
  const { SYNC_EPOCH_MS, SPEED, DUR, RANDOM_MODE, SYNC_SEED } = window.AppConfig;

  let running = false;
  let rafId   = null;

  // ---- АКТИВНОЕ СОСТОЯНИЕ ----
  let TL_active    = [];   // [{digit,freq,span,pairEnd}, ...]
  let dur_active   = [];   // мс на индекс
  let cum_active   = [];   // префиксные суммы мс
  let total_active = 0;    // длина цикла

  // ---- ОЖИДАЕМАЯ ВЕРСИЯ (применяется на границе цикла) ----
  let TL_pending    = null;
  let dur_pending   = null;
  let cum_pending   = null;
  let total_pending = 0;
  let switchAtMs    = null; // абсолютное UTC-время, когда переключаемся

  // Якорь фазы (вычитается из времени при расчёте p)
  let phaseBiasMs   = 0;

  // Подсветка
  let lastIdx  = -1;
  let lastSpan = null;

  // Планировщик
  const LOOKAHEAD_MS   = 300;   // заглядываем вперёд (мобилки любят побольше)
  const SCHED_TICK_MS  = 40;    // частота тиков планировщика
  const BOUNDARY_EPS_MS= 8;     // допуск сравнения моментов границы
  let lastPlannedBoundaryMs = -1; // защита от двойного планирования

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

  // Сколько мс до конца текущего индекса (до его границы)
  function msToIndexBoundary(p, cum) {
    const idx = indexForPhase(cum, p);
    const end = cum[idx];
    return Math.max(0, end - p);
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

  // Любое изменение TL (и append, и rebuild) применяем СТРОГО на границе цикла
  Player.onTimelineChanged = function(){
    const TL_new = (window.Visual && Visual.getTimelineSnapshot)
      ? Visual.getTimelineSnapshot()
      : ((window.Visual && Visual.timeline) ? Visual.timeline.map(x=>({...x})) : []);

    // Если не запущено — принять сразу
    if (!running){
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
      lastPlannedBoundaryMs = -1;
      return;
    }

    // Определяем append (проверим совпадение старой части детально)
    const oldN = TL_active.length;
    let isAppend = TL_new.length >= oldN;
    if (isAppend){
      for (let i=0; i<oldN; i++){
        const a = TL_active[i], b = TL_new[i];
        if (!b || a.digit !== b.digit || (a.pairEnd|0) !== (b.pairEnd|0)) { isAppend = false; break; }
      }
    }

    // Вне зависимости от append/rebuild — готовим ПОЛНЫЙ новый тайминг
    const tNew = buildTimingFromTL(TL_new);
    TL_pending    = TL_new;
    dur_pending   = tNew.dur;
    cum_pending   = tNew.cum;
    total_pending = tNew.total;

    // Применим на БЛИЖАЙШЕЙ ГРАНИЦЕ ЦИКЛА (общая для всех устройств)
    switchAtMs    = nextBoundaryTime(total_active);

    // Чтобы не сыграть на границе «старую» ноту, если она уже была запланирована:
    // сбросим маркер планирования — и перед границей спланируем заново, уже корректно
    lastPlannedBoundaryMs = -1;
  };

  // совместимость
  Player.rebuildAndResync = Player.onTimelineChanged;

  function tick(){
    if (!running){ return; }

    // Переключение строго на границе цикла
    if (switchAtMs && Data.serverNow() >= switchAtMs && TL_pending){
      // Фазу в новом цикле делаем p=0 на switchAtMs
      phaseBiasMs = (switchAtMs - SYNC_EPOCH_MS) % (total_pending || 1);
      if (phaseBiasMs < 0) phaseBiasMs += (total_pending || 1);

      // Смена TL
      TL_active     = TL_pending;
      dur_active    = dur_pending;
      cum_active    = cum_pending;
      total_active  = total_pending;

      TL_pending    = null;
      dur_pending   = null;
      cum_pending   = null;
      total_pending = 0;
      switchAtMs    = null;

      // Обновление визуала/планировщика
      lastIdx = -1;
      lastPlannedBoundaryMs = -1;
    }

    const N = TL_active.length;
    if (!N || !total_active){
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Текущая фаза/индекс СЕЙЧАС по АКТИВНОЙ версии TL
    const pNow   = phaseNow(total_active);
    const idxNow = indexForPhase(cum_active, pNow);

    // === ПЛАНИРОВЩИК: ставим ноту на СЛЕДУЮЩУЮ границу индекса ===
    const dtMs       = msToIndexBoundary(pNow, cum_active); // через сколько мс будет граница
    const nowSrv     = Data.serverNow();
    const boundaryAbs= nowSrv + dtMs;                       // абсолютный момент границы

    if (dtMs <= LOOKAHEAD_MS &&
        Math.abs(boundaryAbs - lastPlannedBoundaryMs) > BOUNDARY_EPS_MS){

      lastPlannedBoundaryMs = boundaryAbs;

      // Если граница совпадает с моментом переключения — надо сыграть ПЕРВУЮ ноту НОВОГО TL
      let node;
      if (switchAtMs && Math.abs(boundaryAbs - switchAtMs) <= BOUNDARY_EPS_MS && TL_pending){
        node = TL_pending[0]; // на новом цикле p=0 → индекс 0
      } else {
        const nextIdx = (idxNow + 1) % N; // обычный случай по старому TL
        node = TL_active[nextIdx];
      }

      const lenSec  = (DUR.noteLen || 0.35) * (SPEED || 1);
      const whenAbs = Tone.now() + Math.max(0, dtMs/1000);
      if (window.Synth && typeof Synth.trigger === 'function' && node){
        Synth.trigger(node.freq, lenSec, 0.8, whenAbs);
      }
    }

    // Подсветка — «по факту» текущего индекса активного TL
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
