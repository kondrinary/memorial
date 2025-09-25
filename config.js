// config.js — глобальные настройки проекта

const ENABLE_SEED = false;   // true = показывать кнопку тестовой записи

// язык по умолчанию
let CURRENT_LANG = "ru";

const TEXTS = {
  ru: {
    startBtn: "Старт",
    birthInput: "Дата рождения (ДД.ММ.ГГГГ)",
    deathInput: "Дата смерти (ДД.ММ.ГГГГ)",
    projectTitle: "Название проекта",
    introDesc: "Короткое описание проекта на стартовой странице (РУС).",
    playDesc: "Описание проекта во время проигрывания дат (РУС).",
    contacts: "КОНТАКТЫ: здесь будет твой текст (РУС)"
  },
  en: {
    startBtn: "Start",
    birthInput: "Date of birth (DD.MM.YYYY)",
    deathInput: "Date of death (DD.MM.YYYY)",
    projectTitle: "Project Title",
    introDesc: "Short project description on the start page (ENG).",
    playDesc: "Project description during playback (ENG).",
    contacts: "CONTACTS: here will be your text (ENG)"
  }
};



window.AppConfig = {

  // Визуальные отступы в правой ленте
  STREAM_SPACING: {
    ENABLED: true,      // включить случайный отступ после цифр и точек
    MIN_CH: 0,        // минимум в ch
    MAX_CH: 6,        // максимум в ch
    APPLY_TO: 'digits_and_dots', // 'digits_and_dots' | 'all'
    NEWLINE_AFTER_PAIR: true      // перенос строки после каждой пары дат
  },

  CLOCK: {
    USE_FIREBASE_OFFSET: true,         // .info/serverTimeOffset
    USE_HTTP_TIME: true,               // HTTP-UTC (worldtimeapi) как второй источник
    HTTP_URL: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
    RESYNC_SEC: 60,                    // переоценка HTTP-UTC раз в минуту
    SLEW_MS: 1500,                     // плавная подстройка offset без скачка
    JITTER_MS: 8                       // игнорировать шум до ±8 мс
  },

  // РОВНАЯ СЕТКА (индекс только из времени)
  SYNC: {
    GRID_MS: 1000                       // длина шага сетки 
  },

  // ОКНО АКТИВАЦИИ НОВЫХ ЗАПИСЕЙ (чтобы append был синхронный)
  WINDOW: {
    MS: 1000,      // окно 1 секунда
    DELAY_MS: 200  // защитная задержка на сеть
  },

  // Скорость (влияет на длительность ноты/FX, НЕ на сетку)
  SPEED: 1,

  // Кнопка тестовой записи
  ENABLE_SEED: true,

  // Синхронизация
  SYNC_ENABLED: true,
  SYNC_EPOCH_MS: Date.UTC(2025,0,1,0,0,0), // опорное UTC-время
  SYNC_SEED: 123456789,
  RANDOM_MODE: 'seeded',

  // Длительности/FX
  DUR: {
    noteLen: 0.50, // сек
    pairGap: 1000
  },

  // Маппинг 0..9 → частоты
  FREQ_MIN: 90,
  FREQ_MAX: 500,
  PITCH_MODE: 'linear',

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
