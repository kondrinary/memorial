// main.js — ОДИН ПУТЬ ОБНОВЛЕНИЙ ДЛЯ ВСЕХ КЛИЕНТОВ
// 1) Любое изменение списка => полный Visual.build(...) (детерминированный порядок)
// 2) Первый снапшот => Player.start(); дальше всегда Player.onTimelineChanged()

(function () {
  let started = false;
  const DEBUG = false;

  function onListUpdated(activeList) {
    // Всегда полный детерминированный ребилд
    Visual.build(activeList);

    if (!started) {
      // Первый запуск: поднимаем часы и плеер
      Data.watchServerOffset();
      if (DEBUG) console.log('[main] first start; len=', Visual.timeline.length);
      Player.start().catch(() => {});
      started = true;
    } else {
      // Любой апдейт данных -> мягкая перестройка на границе окна
      if (DEBUG) console.log('[main] change; len=', Visual.timeline.length);
      Player.onTimelineChanged();
    }
  }

  function onError(err) {
    console.error('[subscribe]', err);
  }

  // Инициализация
  Data.init();
  Data.subscribe(onListUpdated, onError);
})();
