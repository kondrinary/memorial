// player.js — синхронный планировщик (единое место старта у всех)
// Использует Visual.timeline (массив {digit,freq,span,pairEnd}) и Synth.trigger(freq,len)

(function(){
  const Player = {};
  let timer = null;
  let pointer = 0;
  let durations = [];   // мс между цифрами (детерминированные)
  let cum = [];         // накопленные суммы (мс) для быстрого поиска
  let cycleTotal = 0;   // общая длительность цикла (мс)
  let running = false;

  // Упрощённый детерминированный PRNG (mulberry32)
  function mulberry32(a){
    return function(i){
      let t = (a + i) | 0;
      t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d);
      t ^= t >>> 12; t = Math.imul(t, 0x297a2d39);
      t ^= t >>> 15;
      // в [0,1)
      return (t >>> 0) / 4294967296;
    };
  }

  function rebuildTiming(){
    const tl = Visual.timeline || [];
    const { SPEED, DUR, RANDOM_MODE, SYNC_SEED } = AppConfig;

    durations = new Array(tl.length);
    const seeded = mulberry32(SYNC_SEED|0);

    for (let i=0;i<tl.length;i++){
      const base = DUR.randMin + (DUR.randMax - DUR.randMin) *
                   (RANDOM_MODE==='seeded' ? seeded(i) : Math.random());
      const extra = tl[i].pairEnd ? DUR.pairGap : 0;
      durations[i] = Math.round((base + extra) * (SPEED || 1));
    }

    // накопленные суммы и длительность цикла
    cum = new Array(durations.length);
    let acc = 0;
    for (let i=0;i<durations.length;i++){
      acc += durations[i];
      cum[i] = acc;
    }
    cycleTotal = acc; // мс
  }

  // Текущая позиция по глобальному времени
  function computePointerFromClock(){
    if (!AppConfig.SYNC_ENABLED || !cycleTotal) {
      pointer = pointer % (durations.length || 1);
      return 0;
    }
    const now = Date.now();
    const epoch = AppConfig.SYNC_EPOCH_MS || 0;
    let phase = (now - epoch) % cycleTotal;
    if (phase < 0) phase += cycleTotal;

    // бинпоиск по cum, чтобы найти index, где cum[index] превышает phase
    let lo = 0, hi = cum.length - 1, idx = 0;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      if (cum[mid] > phase){ idx = mid; hi = mid - 1; }
      else { lo = mid + 1; }
    }
    pointer = idx;

    const startOfIdx = idx === 0 ? 0 : cum[idx-1];
    const timeInside = phase - startOfIdx; // сколько уже прошло в «текущем шаге»
    const remain = Math.max(0, durations[idx] - timeInside);
    return remain;
  }

  function scheduleNext(afterMs){
    clearTimeout(timer);
    timer = setTimeout(playStep, Math.max(0, afterMs|0));
  }

  function playStep(){
    const tl = Visual.timeline || [];
    if (tl.length === 0){
      running = false;
      return;
    }
    if (pointer >= tl.length) pointer = 0;

    const { digit, freq, span, pairEnd } = tl[pointer];

    // визуальная подсветка + отладка, если есть
    if (span) span.classList.add('active');
    const lenSec = (AppConfig.DUR.noteLen || 0.35) * (AppConfig.SPEED || 1);
    Synth.trigger(freq, lenSec, 0.75);
    setTimeout(()=>{ if (span) span.classList.remove('active'); }, Math.max(0, (lenSec*1000 - 10)|0));

    // шаг вперёд
    const d = durations[pointer] || 1000;
    pointer = (pointer + 1) % tl.length;
    scheduleNext(d);
  }

  // Публичные методы
  Player.start = function(){
    if (running) return;
    rebuildTiming();
    if (!Visual.timeline || Visual.timeline.length === 0){
      running = false;
      return;
    }
    running = true;

    // вычисляем текущую позицию от глобального времени
    const wait = computePointerFromClock();
    scheduleNext(wait);
  };

  // Полный пересчёт (например, после пришедшего снапшота)
  Player.rebuildAndResync = function(){
    if (!running) return;
    rebuildTiming();
    const wait = computePointerFromClock();
    scheduleNext(wait);
  };

  // Когда структура таймлайна изменилась (append/build) — зови это
  Player.onTimelineChanged = function(){
    if (!running) return;
    Player.rebuildAndResync();
  };

  Player.stop = function(){
    running = false;
    clearTimeout(timer);
  };

  window.Player = Player;
})();
