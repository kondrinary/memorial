// data.js — Firebase RTDB + единые «серверные» часы + ОКНА АКТИВАЦИИ
(function(){
  const Data = {};
  let ready = false;
  let db = null;
  let datesRef = null;

  // ===== ИНИЦ =====
  Data.init = function(){
    if (ready) return true;
    try {
      const cfg =
        (window.AppConfig && window.AppConfig.firebaseConfig) ||
        window.firebaseConfig ||
        (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);
      if (!cfg) { console.error('[Data.init] firebaseConfig not found'); return false; }

      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      }
      db = firebase.database();

      const path = (window.AppConfig && AppConfig.DB_PATH) ? AppConfig.DB_PATH : 'dates';
      datesRef = db.ref(path);

      ready = true;
      return true;
    } catch (e){
      console.error('[Data.init] Firebase init error:', e);
      return false;
    }
  };

  // ===== ДОБАВЛЕНИЕ ДАТЫ (с серверным таймстампом!) =====
  Data.pushDate = async function(bDigits, dDigits){
    if (!ready && !Data.init()) return false;
    try {
      const digits = (bDigits + dDigits).split('').map(n => +n);
      await datesRef.push({
        birth: bDigits,
        death: dDigits,
        digits,
        ts: firebase.database.ServerValue.TIMESTAMP   // <-- ключевое
      });
      return true;
    } catch (e){
      console.error('[Data.pushDate]', e);
      return false;
    }
  };

  // ===== ПОДПИСКА С ОКНОМ АКТИВАЦИИ =====
  // Новые записи попадают только на границе окна, синхронно на всех клиентах.
  let _rawList = [];          // последняя сырая выборка из БД (всех записей)
  let _lastEmitIds = '';      // чтобы не дергать рендер без изменений
  let _lastWindowId = null;   // отслеживаем смену окна

  Data.subscribe = function(handler, onError){
    if (!ready && !Data.init()) return;

    datesRef.on('value', (snap)=>{
      const val = snap.val();
      if (!val) { _rawList = []; _emitIfChanged(handler); return; }

      _rawList = Object.entries(val)
        .sort(([ka],[kb]) => ka.localeCompare(kb))     // стабильный порядок
        .map(([id, obj]) => ({
          id,
          birth: obj.birth,
          death: obj.death,
          digits: obj.digits,
          ts: typeof obj.ts === 'number' ? obj.ts : 0   // старые записи без ts считаем «старыми»
        }));

      _emitIfChanged(handler); // возможно, уже попали в текущее окно
    }, (err)=>{
      console.error('[Data.subscribe]', err);
      if (onError) onError(err);
    });

    // «Тик» по границе окна — чтобы включить записи, которые уже пришли,
    // но ждали ближайшую границу.
    _setupWindowTicker(handler);
  };

  // === ФИЛЬТР ПО ОКНУ ===
  function _windowInfo(nowMs){
    const { SYNC_EPOCH_MS } = AppConfig;
    const { MS:WIN_MS, DELAY_MS } = AppConfig.WINDOW || { MS:60000, DELAY_MS:3000 };
    const t = nowMs - (DELAY_MS || 0);
    const k = Math.floor((t - SYNC_EPOCH_MS) / WIN_MS);
    const windowStart = SYNC_EPOCH_MS + k * WIN_MS; // абсолютное UTC-время начала ОКНА
    return { k, windowStart, WIN_MS };
  }

  function _filteredByWindow(raw){
    const now = Data.serverNow();
    const { windowStart } = _windowInfo(now);
    // Берём только записи, которые «успели» в текущее окно:
    // ts <= windowStart  (ts — серверный timestamp Firebase)
    const list = raw.filter(x => (x.ts || 0) <= windowStart);
    return list;
  }

  function _emitIfChanged(handler){
    const list = _filteredByWindow(_rawList);
    const ids = list.map(x=>x.id).join(',');
    if (ids !== _lastEmitIds){
      _lastEmitIds = ids;
      handler(list);
    }
  }

  function _setupWindowTicker(handler){
    if (_setupWindowTicker._started) return;
    _setupWindowTicker._started = true;

    const { MS:WIN_MS } = AppConfig.WINDOW || { MS:60000 };
    const tick = ()=>{
      const { k } = _windowInfo(Data.serverNow());
      if (_lastWindowId === null) _lastWindowId = k;
      if (k !== _lastWindowId){
        _lastWindowId = k;
        _emitIfChanged(handler); // граница окна → пересобрать выдачу синхронно
      }
      setTimeout(tick, Math.max(250, Math.min(1000, WIN_MS/10))); // лёгкий цикл
    };
    tick();
  }

  // ===== СТАБИЛЬНЫЕ «СЕРВЕРНЫЕ» ЧАСЫ: якорь + slew + HTTP-время =====
  let offsetRef = null;

  // якорим serverNow
  let _anchorServerNow = 0;   // UTC-мс на момент старта (для справки)
  let _anchorPerfNow   = 0;   // performance.now() на момент старта
  let _anchorLocalMs   = 0;   // локальное Date.now() в момент якоря
  let _anchorOffset0   = 0;   // offset (stable) в момент якоря

  // текущие оценки смещения (локальные→серверные), мс
  let _rawFbOffsetMs   = 0;   // что пришло от Firebase .info
  let _stableOffsetMs  = 0;   // сглаженная итоговая оценка
  let _httpOffsetMs    = 0;   // оценка от HTTP-времени

  // параметры из конфига
  const CLOCK = (window.AppConfig && AppConfig.CLOCK) || {};
  const OFFSET_SLEW_MS = CLOCK.SLEW_MS  ?? 1500;
  const OFFSET_JITTER  = CLOCK.JITTER_MS?? 8;
  const HTTP_URL       = CLOCK.HTTP_URL || 'https://worldtimeapi.org/api/timezone/Etc/UTC';
  const RESYNC_MS      = (CLOCK.RESYNC_SEC ?? 60) * 1000;

  function _blendOffsets(httpOff, fbOff){
    if (CLOCK.USE_FIREBASE_OFFSET !== true) return httpOff;
    if (CLOCK.USE_HTTP_TIME !== true)       return fbOff;
    return (httpOff + fbOff) / 2;
  }

  // 1) Firebase offset
  Data.watchServerOffset = function(){
    if (!ready && !Data.init()) return false;
    if (CLOCK.USE_FIREBASE_OFFSET !== true) return true;

    if (!offsetRef) offsetRef = db.ref('.info/serverTimeOffset');
    offsetRef.on('value', (snap)=>{
      const newOff = Number(snap.val() || 0);

      if (_anchorPerfNow === 0){
        _rawFbOffsetMs   = newOff;
        _httpOffsetMs    = 0;
        _stableOffsetMs  = newOff;

        _anchorLocalMs   = Date.now();
        _anchorOffset0   = _stableOffsetMs;
        _anchorPerfNow   = performance.now();

        _anchorServerNow = _anchorLocalMs + _anchorOffset0;
        return;
      }

      const delta = newOff - _rawFbOffsetMs;
      _rawFbOffsetMs = newOff;
      if (Math.abs(delta) <= OFFSET_JITTER) return;

      const startPerf = performance.now();
      const startVal  = _stableOffsetMs;
      const targetVal = _blendOffsets(_httpOffsetMs, _rawFbOffsetMs);

      function _slew(){
        const t = (performance.now() - startPerf) / OFFSET_SLEW_MS;
        if (t >= 1){ _stableOffsetMs = targetVal; return; }
        const k = 1 - Math.pow(1 - t, 3);
        _stableOffsetMs = startVal + (targetVal - startVal) * k;
        requestAnimationFrame(_slew);
      }
      _slew();
    });
    return true;
  };

  // 2) HTTP-время (UTC)
  (function httpClockSync(){
    if (CLOCK.USE_HTTP_TIME !== true) return;

    async function poll(){
      const t0 = performance.now();
      try{
        const resp = await fetch(HTTP_URL, { cache:'no-store' });
        const t1 = performance.now();
        const js = await resp.json();
        const serverUnixMs = (js.unixtime * 1000);

        const mid = (t0 + t1) / 2.0;
        const localAtMidMs = Date.now() + (mid - t1);
        const newHttpOffset = serverUnixMs - localAtMidMs;

        _httpOffsetMs = newHttpOffset;

        if (_anchorPerfNow === 0){
          _stableOffsetMs  = _httpOffsetMs;

          _anchorLocalMs   = Date.now();
          _anchorOffset0   = _stableOffsetMs;
          _anchorPerfNow   = performance.now();

          _anchorServerNow = _anchorLocalMs + _anchorOffset0;
        } else {
          const targetVal = _blendOffsets(_httpOffsetMs, _rawFbOffsetMs);
          const startVal  = _stableOffsetMs;
          const startPerf = performance.now();
          function _slew(){
            const t = (performance.now() - startPerf) / OFFSET_SLEW_MS;
            if (t >= 1){ _stableOffsetMs = targetVal; return; }
            const k = 1 - Math.pow(1 - t, 3);
            _stableOffsetMs = startVal + (targetVal - startVal) * k;
            requestAnimationFrame(_slew);
          }
          _slew();
        }
      } catch(_){}
      setTimeout(poll, RESYNC_MS);
    }
    poll();
  })();

  // 3) Текущее «серверное» время
  Data.serverNow = function(){
    if (_anchorPerfNow === 0){
      return Date.now(); // пока нет эталона
    }
    const elapsed = performance.now() - _anchorPerfNow;
    return _anchorLocalMs + elapsed + (_stableOffsetMs - _anchorOffset0);
  };

  // Экспорт
  window.Data = Data;
})();
