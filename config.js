// config.js — глобальные настройки проекта
window.AppConfig = {

  CLOCK: {
    USE_FIREBASE_OFFSET: true,         // .info/serverTimeOffset
    USE_HTTP_TIME: true,               // HTTP-«NTP» как доп. источник
    HTTP_URL: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
    RESYNC_SEC: 60,                    // как часто уточнять HTTP-время
    SLEW_MS: 1500,                     // плавное подтягивание смещения
    JITTER_MS: 8                       // игнорировать микрошум offset’а
  },

  // === РОВНАЯ СЕТКА (индекс по времени, а не по длительностям) ===
  SYNC: {
    GRID_MS: 700   // длина шага сетки (подбери своё значение при желании)
  },

  // === ОКНО АКТИВАЦИИ НОВЫХ ЗАПИСЕЙ ===
  // Новые записи из БД попадают в игру на общей границе окна.
  WINDOW: {
    MS: 1000,      // окно 1 секунда (вместо минуты)
    DELAY_MS: 200  // маленькая защитная задержка на сетевые лаги
  },

  // Скорость воспроизведения (влияет на длину ноты и FX, НЕ на GRID_MS)
  SPEED: 1,

  // Кнопка тестовой записи
  ENABLE_SEED: true,

  // Базовые метки времени (опорная дата)
  SYNC_ENABLED: true,
  SYNC_EPOCH_MS: Date.UTC(2025,0,1,0,0,0),
  SYNC_SEED: 123456789,
  RANDOM_MODE: 'seeded',

  // Длительности/FX
  DUR: {
    noteLen: 0.40, // сек — длительность ноты
    randMin: 600,  // (не влияет на сетку; можно оставить)
    randMax: 800,
    pairGap: 1000
  },

  // Маппинг 0..9 в частоты
  FREQ_MIN: 130.813,
  FREQ_MAX: 523.251,
  PITCH_MODE: 'geometric',

  // Firebase RTDB
  DB_PATH: 'dates',
  firebaseConfig: {
    apiKey: "ВАШ_API_KEY",
    authDomain: "ВАШ_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://memorial-bea3c-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ВАШ_PROJECT_ID",
    storageBucket: "ВАШ_PROJECT_ID.appspot.com",
    messagingSenderId: "ВАШ_MESSAGING_SENDER_ID",
    appId: "ВАШ_APP_ID"
  }
};
