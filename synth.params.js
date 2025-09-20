
window.SYNTH_PARAMS = {
  // Баланс слоёв / шина
  bodyLevel: 0.50,   // уровень «корпуса» (основной тон)
  attackLevel: 0.00, // уровень FM-атаки (щелчок/яркость старта)
  busLevel: 0.55,    // общий уровень на FX-шину (влияет на «склейку»)

  // Корпус (основной тон)
  bodyOsc: "sine",   // форма осциллятора: sine/triangle/saw/square…
  bodyEnv: {         
    attack: 0.060,   
    decay: 0.30,     
    sustain: 0.20,   
    release: 2.0,    // длина хвоста
    attackCurve: "sine",
    releaseCurve: "sine"
  },

  // FM-слой (атака)
  fmHarmonicity: 1.7,  // отношение частот модулятор/носитель (яркость металла)
  fmModIndex: 4.0,     // индекс модуляции (агрессивность атаки)
  fmEnv: {             // огибающая амплитуды носителя (атака)
    attack: 0.015, decay: 0.10, sustain: 0.05, release: 0.12,
    attackCurve: "sine", releaseCurve: "sine"
  },
  fmModEnv: {          // огибающая модулятора (форма «щелчка»)
    attack: 0.015, decay: 0.10, sustain: 0.05, release: 0.12,
    attackCurve: "sine", releaseCurve: "sine"
  },

  // Тональный баланс / фильтры
  lowpassFreq: 3300,   // LPF: ниже — темнее, выше — «воздух»

  // Delay
  delayTime: "4n",     // время задержки: число (сек) или муз. длительность ("4n","8n"…)
  feedback: 0.18,      // количество повторов
  delayWet: 0.08,      // доля задержки в миксе

  // Реверберация (Freeverb)
  reverbRoom: 0.78,    // «размер комнаты» (0..1)
  reverbDamp: 1900,    // затухание верхов хвоста (Гц): ниже — темнее
  reverbWet: 0.18,     // доля реверба в миксе

  // Компрессор на шине
  compThresh: -30,     // порог срабатывания (дБ)
  compRatio: 2.0,      // степень сжатия
  compAttack: 0.03,    // скорость атаки компрессора (сек)
  compRelease: 0.25    // скорость восстановления (сек)
};
