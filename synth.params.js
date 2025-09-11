// synth.params.js — профиль: «ПЕДАЛЬНЫЕ КОЛОКОЛА / STABLE+AIR»
window.SYNTH_PARAMS = {
  // Глобально
  masterDb: -10,            // больше запаса по уровню → меньше “дребезга”
  bodyPolyMax:   32,        // длинный хвост не ворует голоса
  attackPolyMax: 16,

  // Баланс
  bodyLevel: 0.50,
  attackLevel: 0.00,        // мягкий старт: удар выключен
  busLevel: 0.54,

  // Корпус (мягкий вход + колокольный спад)
  bodyOsc: "sine",
  bodyEnv: {
    attack:  0.024,         // ещё мягче старт
    decay:   1.50,          // колокольный спад
    sustain: 0.00,
    release: 0.80,          // умеренный релиз (основной шлейф даст реверб)
    attackCurve:  "sine",
    releaseCurve: "exponential"
  },

  // FM-слой (намёк держим «в нуле» уровнем выше)
  fmHarmonicity: 1.5,
  fmModIndex:    8,
  fmEnv:    { attack: 0.004, decay: 0.080, sustain: 0.0, release: 0.070, attackCurve:"sine", releaseCurve:"exponential" },
  fmModEnv: { attack: 0.004, decay: 0.080, sustain: 0.0, release: 0.070, attackCurve:"sine", releaseCurve:"exponential" },

  // Тональный баланс
  dcCutHz:     68,          // меньше инфраниза → меньше гула
  lowpassFreq: 3600,        // добавим чуть воздуха, но без «стекла»

  // Delay как короткий pre-delay (без повторов)
  delayTime: 0.028,         // ≈28 мс
  feedback:  0.00,          // выключены повторы
  delayWet:  0.015,         // только ширит реверб

  // Реверб — атмосфера/окутывание
  reverbWet:  0.24,         // объём
  reverbRoom: 0.90,         // большой зал
  reverbDamp: 2500,         // мягкий верх хвоста

  // Компрессор (мягкая склейка)
  compThresh:  -36,
  compRatio:     1.6,
  compAttack:   0.03,
  compRelease:  0.28,

// РЕВЕРБ
reverbDecaySec:    2.6,    // 2.2–3.0: длина свертки (вместо roomSize)
reverbPreDelaySec: 0.030,  // предзадержка реверба
preDelaySec:       0.028,  // для Tone.Delay (если нет — возьмёт delayTime как раньше)
ditherDb:          -85     // уровень микрошумa, держит реверб «в живом» состоянии


};
