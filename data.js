// data.js — RTDB + «серверные» часы + окно 1с + журнал смен TL
// Добавлен 2s лаг активации новых записей (ACTIVATION_HOLDOFF_MS).
(function(){
  const Data = {};
  let ready = false;
  let db = null;
  let datesRef = null;
  let changesRef = null;

  // ----- init -----
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
      datesRef   = db.ref(path);
      changesRef = db.ref('control/changes'); // журнал смен (ключ — окно k)

      ready = true;
      return true;
    } catch (e){
      console.error('[Data.init] Firebase init error:', e);
      return false;
    }
  };

  // ----- push date -----
  Data.pushDate = async function(bDigits, dDigits){
    if (!ready && !Data.init()) return false;
    try {
      const digits = (bDigits + dDigits).split('').map(n => +n);
      await datesRef.push({
        birth:  bDigits,
        death:  dDigits,
        digits,
        ts: firebase.database.ServerValue.TIMESTAMP  // сервер проставит число
      });
      return true;
    } catch (e){
      console.error('[Data.pushDate]', e);
      return false;
    }
  };

  // ----- subscribe with activation window (1s windows + 2s holdoff) -----
  let _rawList = [];
  let _lastEmitIds = '';
  let _lastWindowId = null;
  let _lastFilteredList = [];
  Data.getActiveList = function(){ return _lastFilteredList.slice(); };

  Data.subscribe = function(handler, onError){
    if (!ready && !Data.init()) return;

    datesRef.on('value', (snap)=>{
      const val = snap.val();
      if (!val) { _rawList = []; _emitIfChanged(handler); return; }

      _rawList = Object.entries(val)
        .sort(([ka],[kb]) => ka.localeCompare(kb))
        .map(([id, obj]) => {
          const rawTs = obj.ts;
          // ВАЖНО: пока сервер не проставил числовой ts, запись НЕ активируется
          const ts = (typeof rawTs === 'number') ? rawTs : Number.MAX_SAFE_INTEGER;
          return {
            id,
            birth: obj.birth,
            death: obj.death,
            digits: obj.digits,
            ts
          };
        });

      _emitIfChanged(handler);
    }, (err)=>{
      console.error('[Data.subscribe]', err);
      if (onError) onError(err);
    });

    _setupWindowTicker(handler);
  };

  function _windowInfo(nowMs){
    const { SYNC_EPOCH_MS } = AppConfig;
    const { MS:WIN_MS, DELAY_MS, ACTIVATION_HOLDOFF_MS } = AppConfig.WINDOW || { MS:1000, DELAY_MS:250, ACTIVATION_HOLDOFF_MS:2000 };
    const t = nowMs - (DELAY_MS || 0);
    const k = Math.floor((t - SYNC_EPOCH_MS) / WIN_MS);
    const windowStart = SYNC_EPOCH_MS + k * WIN_MS;
    const holdoff = (typeof ACTIVATION_HOLDOFF_MS === 'number') ? ACTIVATION_HOLDOFF_MS : 2000;
    return { k, windowStart, WIN_MS, holdoff };
  }
  Data.currentWindowInfo = function(){ return _windowInfo(Data.serverNow()); };

  function _filteredByWindow(raw){
    const { windowStart, holdoff } = _windowInfo(Data.serverNow());
    // Ключ: даём дополнительный лаг в 2s перед включением новой записи
    const cutoff = windowStart - holdoff;
    return raw.filter(x => (x.ts || 0) <= cutoff);
  }

  function _emitIfChanged(handler){
    const list = _filteredByWindow(_rawList);
    _lastFilteredList = list;

    const ids = list.map(x=>x.id).join(',');
    if (ids !== _lastEmitIds){
      _lastEmitIds = ids;
      handler(list);
    }
  }

  function _setupWindowTicker(handler){
    if (_setupWindowTicker._started) return;
    _setupWindowTicker._started = true;

    const { MS:WIN_MS } = AppConfig.WINDOW || { MS:1000 };
    const tick = ()=>{
      const { k } = _windowInfo(Data.serverNow());
      if (_lastWindowId === null) _lastWindowId = k;
      if (k !== _lastWindowId){
        _lastWindowId = k;
        _emitIfChanged(handler);
      }
      setTimeout(tick, Math.max(100, Math.min(300, WIN_MS/5)));
    };
    tick();
  }

  // ----- change log (идемпотентно, ключ — окно k) -----
  Data.announceChange = async function(k, beat, n){
    if (!ready && !Data.init()) return;
    try {
      const ref = changesRef.child(String(k));
      await ref.transaction(cur => cur || { k, beat, n, ts: firebase.database.ServerValue.TIMESTAMP });
    } catch(e){
      /* ignore */
    }
  };

  Data.getChangeLogOnce = async function(){
    if (!ready && !Data.init()) return [];
    try{
      const snap = await changesRef.once('value');
      const val = snap.val() || {};
      return Object.values(val).sort((a,b)=> (a.k - b.k));
    }catch(e){
      console.warn('[Data.getChangeLogOnce]', e);
      return [];
    }
  };

  // ----- «серверные» часы: .info + (опц.) HTTP-UTC с плавной подстройкой -----
  let offsetRef = null;
  let _anchorPerfNow = 0, _anchorLocalMs = 0, _anchorOffset0 = 0;
  let _rawFbOffsetMs = 0, _httpOffsetMs = 0, _stableOffsetMs = 0;

  const CLOCK = (window.AppConfig && AppConfig.CLOCK) || {};
  const OFFSET_SLEW_MS = CLOCK.SLEW_MS  ?? 1500;
  const OFFSET_JITTER  = CLOCK.JITTER_MS?? 8;
  const HTTP_URL       = CLOCK.HTTP_URL || 'https://worldtimeapi.org/api/timezone/Etc/UTC';
  const RESYNC_MS      = (CLOCK.RESYNC_SEC ?? 60) * 1000;

  function _blend(httpOff, fbOff){
    if (CLOCK.USE_FIREBASE_OFFSET !== true) return httpOff;
    if (CLOCK.USE_HTTP_TIME !== true)       return fbOff;
    return (httpOff + fbOff) / 2;
  }

  Data.watchServerOffset = function(){
    if (!ready && !Data.init()) return false;
    if (CLOCK.USE_FIREBASE_OFFSET !== true) return true;

    if (!offsetRef) offsetRef = db.ref('.info/serverTimeOffset');
    offsetRef.on('value', (snap)=>{
      const newOff = Number(snap.val() || 0);

      if (_anchorPerfNow === 0){
        _rawFbOffsetMs  = newOff;
        _httpOffsetMs   = 0;
        _stableOffsetMs = newOff;

        _anchorLocalMs  = Date.now();
        _anchorOffset0  = _stableOffsetMs;
        _anchorPerfNow  = performance.now();
        return;
      }

      const delta = newOff - _rawFbOffsetMs;
      _rawFbOffsetMs = newOff;
      if (Math.abs(delta) <= OFFSET_JITTER) return;

      const startPerf = performance.now();
      const startVal  = _stableOffsetMs;
      const targetVal = _blend(_httpOffsetMs, _rawFbOffsetMs);

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
        } else {
          const targetVal = _blend(_httpOffsetMs, _rawFbOffsetMs);
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

  Data.serverNow = function(){
    if (_anchorPerfNow === 0) return Date.now();
    const elapsed = performance.now() - _anchorPerfNow;
    return _anchorLocalMs + elapsed + (_stableOffsetMs - _anchorOffset0);
  };

  window.Data = Data;
})();
