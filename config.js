/* 
«ёлочки»: «…» или &laquo;…&raquo;
вложенные: „…“ или &bdquo;…&ldquo;
длинное тире: — или &mdash;
среднее тире (интервалы/диапазоны): – или &ndash;
неразрывный пробел: (&nbsp;)
узкий неразрывный пробел: &#8239; (подходит для «—» в русском: &#8239;—&#8239;)
*/

// === UI для дебаг-полосы ===
window.AppConfig = window.AppConfig || {};
AppConfig.UI = Object.assign(AppConfig.UI || {}, {
  DB_COUNT_REFRESH_MS: 4000 // забираем колво дат в базе раз в 4 секунды 
});



// ПРАВИЛА
const ENABLE_SEED = false;   // true = показывать кнопку тестовой записи

// язык по умолчанию
let CURRENT_LANG = "ru";

const TEXTS = {
  ru: {
    addBtn: "добавить",
    startBtn: "подключиться",
    birthInput: "дата рождения (дд.мм.гггг)",
    deathInput: "дата смерти (дд.мм.гггг)",
    projectTitle: "✝ MEMORIAL ✝",
    introDesc: "Это цифровой мемориал. Мы привыкли к облачным формам хранения артефактов своей жизни: храним в метавселенных, на серверах, в цифровой памяти наши данные о прошлом, воспоминания и мысли. Но так же метапространство может стать и местом для хранения вечной памяти потому, что само по себе уже обладает характеристикой вечности - оно не подверженно природным изменениям и разрушениям под действием времени; оно статично, неизменно и условно бесконечно. Соответственно, цифра становится органичным и естественным пространством для хранения вечной памяти. Вечное место для вечной памяти.",
    playDesc: "Цифровой мир - стал полноправным пространством жизни человека, в котором мы можем совершать памятные ритуалы. Цифровой мемориал - дает возможность людям добавлять свои даты, а в ответ слышать их звучание и видеть в общем потоке",
    contacts: "проект создан студией мультимедиа-художников (наименование). сайт студии: (наименование). художники проекта: настасья кондрина, андрей обыденников. ",

// статусные подписи (нейтральные)
waitingStart: "ожидание запуска. нажмите кнопку подключиться",
  statusPreparingSound: "готовлю звук",
  statusSoundReady: "звук готов",
  statusSubscribing: "подписываюсь на базу данных с датами",
  statusNoData: "Нет данных для проигрывания. Добавьте дату ниже.",
  errToneMissing: "Tone.js не загрузился. Проверьте интернет/скрипты.",
  errAudioBlocked: "ваш браузер заблокировал аудио. кликните ещё раз или разрешите звук",
  errSynthInit: "Ошибка инициализации синтезатора.",
  errFirebaseInit: "Ошибка инициализации Firebase (config.js).",

// ошибки валидации формы
  errBadFormat: "попробуйте еще раз ввести даты в верном формате",
  errDeathBeforeBirth: "дпопробуйте еще раз ввести даты в верном формате",
  errWriteFailed: "Ошибка записи. Проверьте соединение/Rules.",
// чтение из базы
  dbReadError: "Ошибка чтения из базы",
// тестовая запись
  seedAdding: "Пробую добавить тестовую запись…",
  seedInitFailed: "Firebase не инициализируется. Проверь config.js.",
  seedAdded: "Тестовая запись добавлена:",
  seedWriteFailed: "Ошибка записи (Rules/сеть).",
// воспроизведение
  nowPlaying: "сейчас звучит ",
  hz: "Гц",
  idxLabel: "индекс ",
  dbCount: "Количество дат в базе: {n}",
  nowPlayingBtn: "что сейчас звучит?",

// «успех-бар» (белый текст)
  okBar: "ваша запись добавлена в память цифрового мемориала"

  },
  en: {
    addBtn: "Add",
    startBtn: "Start",
    birthInput: "Date of birth (DD.MM.YYYY)",
    deathInput: "Date of death (DD.MM.YYYY)",
    projectTitle: "MEMORIAL",
    introDesc: "Short project description on the start page (ENG).",
    playDesc: "Project description during playback (ENG).",
    contacts: "CONTACTS: here will be your text (ENG)",

    // статусные подписи (нейтральные)
  waitingStart: "Waiting to start…",
  statusPreparingSound: "Preparing sound…",
  statusSoundReady: "Sound is ready.",
  statusSubscribing: "Subscribing to database…",
  statusNoData: "No data to play. Please add a date below.",
  errToneMissing: "Tone.js did not load. Check internet/scripts.",
  errAudioBlocked: "Audio was blocked by the browser. Click again or allow sound.",
  errSynthInit: "Synth initialization error.",
  errFirebaseInit: "Firebase initialization error (config.js).",

// ошибки валидации формы
  errBadFormat: "Error: format must be DD.MM.YYYY",
  errDeathBeforeBirth: "Error: death date is earlier than birth date.",
  errWriteFailed: "Write error. Check connection/Rules.",
// чтение из базы 
  dbReadError: "Database read error",
// тестовая запись
  seedAdding: "Trying to add a test record…",
  seedInitFailed: "Firebase fails to initialize. Check config.js.",
  seedAdded: "Test record added:",
  seedWriteFailed: "Write error (Rules/network).",
// воспроизведение

  nowPlaying: "Now playing",
  hz: "Hz",
  idxLabel: "idx",
  dbCount: "Dates in database: {n}",
nowPlayingBtn: "what is playing now?",


// «успех-бар» (белый текст)
  okBar: "Successfully added to the database."

  }
};



window.AppConfig = {



  // Визуальные отступы в правой ленте
  STREAM_SPACING: {
    ENABLED: false,      // включить случайный отступ после цифр и точек
    MIN_CH: 10,        // минимум в ch
    MAX_CH: 10,        // максимум в ch
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







