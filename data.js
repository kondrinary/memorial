// data.js — Firebase RTDB + единые серверные часы по .info/serverTimeOffset
(function(){
  const Data = {};
  let ready = false;
  let db = null;
  let datesRef = null;

  // ===== ИНИЦИАЛИЗАЦИЯ =====
  Data.init = function(){
    if (ready) return true;
    try {
      // firebaseConfig и AppConfig задаются в config.js
const cfg =
  (window.AppConfig && window.AppConfig.firebaseConfig) ||
  window.firebaseConfig ||                 // запасной вариант, если вдруг задашь глобально
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

  // ===== ЧТЕНИЕ СПИСКА ДАТ (старые → новые) =====
  // handler(list) — list: [{id, birth, death, digits?}, ...]
  Data.subscribe = function(handler, onError){
    if (!ready && !Data.init()) return;

    datesRef.on('value', (snap)=>{
      const val = snap.val();
      if (!val) { handler([]); return; }

      // строго сортируем по ключу (push-id) — старые → новые
      const list = Object.entries(val)
        .sort(([ka],[kb]) => ka.localeCompare(kb))
        .map(([id, obj]) => ({ id, ...obj }));

      handler(list);
    }, (err)=>{
      console.error('[Data.subscribe]', err);
      if (onError) onError(err);
    });
  };

  // ===== ДОБАВЛЕНИЕ ДАТЫ =====
  // bDigits/dDigits: строки вида "ДДММГГГГ" (без точек)
  Data.pushDate = async function(bDigits, dDigits){
    if (!ready && !Data.init()) return false;
    try {
      const digits = (bDigits + dDigits).split('').map(n => +n);
      await datesRef.push({ birth: bDigits, death: dDigits, digits });
      return true;
    } catch (e){
      console.error('[Data.pushDate]', e);
      return false;
    }
  };

  // ===== СЕРВЕРНОЕ ВРЕМЯ ЧЕРЕЗ .info/serverTimeOffset =====
    // ===== СТАБИЛЬНЫЕ «СЕРВЕРНЫЕ» ЧАСЫ: якорь + slew + HTTP-время =====
  let offsetRef = null;

  // якорим serverNow: считаем от монотонных часов, чтобы не было скачков
  let _anchorServerNow = 0;   // миллисекунды UTC на момент старта
  let _anchorPerfNow   = 0;   // performance.now() на момент старта

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

  // 2.1 Firebase offset — слушаем и плавно тянемся
  Data.watchServerOffset = function(){
    if (!ready && !Data.init()) return false;
    if (CLOCK.USE_FIREBASE_OFFSET !== true) return true;

    if (!offsetRef) offsetRef = db.ref('.info/serverTimeOffset');
    offsetRef.on('value', (snap)=>{
      const newOff = Number(snap.val() || 0);

      // первый заход — заякорим «сервер сейчас»
      if (_anchorPerfNow === 0){
        _rawFbOffsetMs   = newOff;
        _httpOffsetMs    = 0;
        _stableOffsetMs  = newOff;           // стартовая оценка
        _anchorServerNow = Date.now() + _stableOffsetMs;
        _anchorPerfNow   = performance.now();
        return;
      }

      // мелкий шум — игнорируем
      const delta = newOff - _rawFbOffsetMs;
      _rawFbOffsetMs = newOff;
      if (Math.abs(delta) <= OFFSET_JITTER) return;

      // плавное «подтягивание» без ступеньки
      const startPerf = performance.now();
      const startVal  = _stableOffsetMs;
      const targetVal = _blendOffsets(_httpOffsetMs, _rawFbOffsetMs);

      function _slew(){
        const t = (performance.now() - startPerf) / OFFSET_SLEW_MS;
        if (t >= 1){
          _stableOffsetMs = targetVal;
          return;
        }
        const k = 1 - Math.pow(1 - t, 3); // ease-out
        _stableOffsetMs = startVal + (targetVal - startVal) * k;
        requestAnimationFrame(_slew);
      }
      _slew();
    });
    return true;
  };

  // 2.2 HTTP-время (браузеру недоступен UDP/NTP — берём точное UTC через HTTP)
  // Берём серверный unixtime, оцениваем сетевую задержку и обновляем _httpOffsetMs.
  (function httpClockSync(){
    if (CLOCK.USE_HTTP_TIME !== true) return;

    async function poll(){
      const t0 = performance.now();
      try{
        const resp = await fetch(HTTP_URL, { cache:'no-store' });
        const t1 = performance.now();
        // worldtimeapi.org даёт JSON с "unixtime" (сек) и "utc_datetime"
        const js = await resp.json();
        const serverUnixMs = (js.unixtime * 1000); // уже UTC

        // Оценка RTT и «вписывание» в середину окна запроса
        const rtt = t1 - t0;
        const mid = (t0 + t1) / 2.0;
        const localAtMidMs = Date.now() + (mid - t1); // приблизим локальное время в момент «середины»
        const newHttpOffset = serverUnixMs - localAtMidMs;

        _httpOffsetMs = newHttpOffset;

        // если мы ещё не якорились (не было Firebase), заякоримся от HTTP
        if (_anchorPerfNow === 0){
          _stableOffsetMs  = _httpOffsetMs;
          _anchorServerNow = Date.now() + _stableOffsetMs;
          _anchorPerfNow   = performance.now();
        } else {
          // мягко сведёмся к смеси HTTP/Firebase
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
      } catch(_){ /* тихо */ }
      setTimeout(poll, RESYNC_MS);
    }
    function _blendOffsets(httpOff, fbOff){
      // если один из источников 0 — берём другой
      if (!CLOCK.USE_FIREBASE_OFFSET) return httpOff;
      if (!CLOCK.USE_HTTP_TIME)       return fbOff;
      // простое усреднение; можно усложнить (вес по rtt), но обычно не нужно
      return (httpOff + fbOff) / 2;
    }
    poll();
  })();

  // 2.3 Текущее «серверное» время без скачков
  Data.serverNow = function(){
    if (_anchorPerfNow === 0){
      // на самом первом кадре до прихода источников — локальные часы
      return Date.now();
    }
    const elapsed = performance.now() - _anchorPerfNow;
    return _anchorServerNow + elapsed + (_stableOffsetMs - _rawFbOffsetMs); // компенсируем смену эталона без ступеньки
  };

  // Экспорт
  window.Data = Data;
})();
