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

  // === ОКНО АКТИВАЦИИ НОВЫХ ЗАПИСЕЙ ===
  // Новые записи из БД попадают в игру только на границе окна.
  WINDOW: {
    MS: 60000,       // длительность окна, мс (например, 60 c)
    DELAY_MS: 3000   // защитная задержка, мс (на сетевые лаги)
  },

  // Скорость: 2 = медленнее; 0.5 = быстрее
  SPEED: 1,

  // вкл/выкл кнопку тестовой записи в базу
  ENABLE_SEED: true,

  // === СИНХРОНИЗАЦИЯ ВОСПРОИЗВЕДЕНИЯ ===
  SYNC_ENABLED: true,
  SYNC_EPOCH_MS: Date.UTC(2025,0,1,0,0,0),   // опорная дата (UTC)
  SYNC_SEED: 123456789,                      // seed для детерминированного «рандома»
  RANDOM_MODE: 'seeded',                     // 'seeded' или 'none'

  // Длительности (зависят от SPEED)
  DUR: {
    noteLen: 0.40,   // сек — длительность ноты
    randMin: 600,    // мс — мин. пауза между цифрами
    randMax: 800,    // мс — макс. пауза
    pairGap: 1000    // мс — пауза между парами дат
  },

  // Микротональность 0–9
  FREQ_MIN: 130.813,  // C3
  FREQ_MAX: 523.251,  // C5
  PITCH_MODE: 'geometric',

  // Ветка в RTDB 
  DB_PATH: 'dates',

  // Firebase Console Config
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
