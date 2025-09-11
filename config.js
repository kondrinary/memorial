// config.js — глобальные настройки проекта
window.AppConfig = {

  AUDIO: {
    BUFFER_SEC: 0.12,
    CONTEXT: { latencyHint:"playback", lookAheadSec:0.20, updateIntervalSec:0.03 }
  },


CLOCK: {
  USE_FIREBASE_OFFSET: true,
  USE_HTTP_TIME: false,        
  HTTP_URL: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
  RESYNC_SEC: 60,
  SLEW_MS: 3000,               // было 1500 → делаем мягче
  JITTER_MS: 12                // было 8 → чуть шире 
},


  // РОВНАЯ СЕТКА (индекс только из времени)
  SYNC: {
    GRID_MS: 1000                       // длина шага сетки (подбери при желании)
  },

  // ОКНО АКТИВАЦИИ НОВЫХ ЗАПИСЕЙ 
WINDOW: {
  MS: 1000,          // длина окна
  DELAY_MS: 250,     // анти-скачок внутри окна
  ACTIVATION_HOLDOFF_MS: 2000 // <-- новая строка: задержка включения новых записей
},


  // Скорость (влияет на длительность ноты/FX, НЕ на сетку)
  SPEED: 1,

  // Кнопка тестовой записи
  ENABLE_SEED: true,

  // Синхронизация
  SYNC_ENABLED: true,
  SYNC_EPOCH_MS: Date.UTC(2025,0,1,0,0,0), // опорное UTC-время

  // Длительности/FX
  DUR: {
    noteLen: 0.50, // сек
  },

  // Маппинг 0..9 → частоты
  FREQ_MIN: 90,
  FREQ_MAX: 500,
  PITCH_MODE: 'geometric',

  // Ветка RTDB
  DB_PATH: 'dates',

  // Firebase Console Config (замени на свой)
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
