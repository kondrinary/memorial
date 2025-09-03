(function(){
  const Data = {};
  let ready = false, db=null, ref=null;

  Data.init = function(){
    const info = document.getElementById('debugInfo');
    try{
      if (typeof firebase === 'undefined') throw new Error('Firebase не загрузился');
      // Идемпотентная инициализация (без "duplicate-app")
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(AppConfig.firebaseConfig);
      } else {
        firebase.app();
      }
      db = firebase.database();
      ref = db.ref(AppConfig.DB_PATH || 'dates');
      ready = true;
      return true;
    }catch(e){
      console.error(e);
      if (info) info.textContent = 'Ошибка инициализации Firebase.';
      return false;
    }
  };

  Data.isReady = ()=> ready;

  Data.subscribe = function(handler, onError){
  if (!ready && !Data.init()) return;
  ref.on('value', (snap)=>{
    const list = [];
    snap.forEach(child=>{
      const val = child.val();
      // включаем уникальный ключ Firebase в элемент списка
      list.push({ id: child.key, ...val });
    });
    handler(list);
  }, (err)=>{
    console.error(err);
    if (onError) onError(err);
  });
};


  // Возвращает Promise<boolean>
  Data.pushDate = function(bDigits, dDigits){
    if (!ready && !Data.init()) return Promise.resolve(false);
    const digits = (bDigits + dDigits).split('').map(Number);
    return new Promise((resolve)=>{
      ref.push({ birth: bDigits, death: dDigits, digits }, (err)=>{
        if (err) { console.error('push error', err); resolve(false); }
        else resolve(true);
      });
    });
  };

  window.Data = Data;
})();
