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
  let offsetRef = null;
  let serverOffsetMs = 0;

  Data.watchServerOffset = function(){
    if (!ready && !Data.init()) return false;
    if (!offsetRef) offsetRef = db.ref('.info/serverTimeOffset');
    offsetRef.on('value', (snap)=>{
      const off = Number(snap.val() || 0);
      serverOffsetMs = off;
    });
    return true;
  };

  // server "now" = local now + offset
  Data.serverNow = function(){
    return Date.now() + (serverOffsetMs || 0);
  };

  // Экспорт
  window.Data = Data;
})();
