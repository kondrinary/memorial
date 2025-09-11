// synth.js — стабильный мягкий синт: параметры из synth.params.js, предзадержка→реверб, полифония 24
(function () {
  // ──────────────────────────────────────────────────────────────────────────────
  // ПУБЛИЧНОЕ API
  //   Synth.init():  инициализация узлов по параметрам из window.SYNTH_PARAMS
  //   Synth.trigger(freq, lenSec, vel=0.65, whenAbs=null): сыграть частоту
  //   Synth.playDigit(d, lenSec=0.35, delaySec=0): удобный вызов из плеера (цифра→частота)
  // ──────────────────────────────────────────────────────────────────────────────
  const Synth = {};
  let ready = false;

  // Узлы
  let bodyPoly, attackPoly;
  let bodyGain, attackGain, busGain;
  let dcCut, comp, lowpass, predelay, reverb, dither, limiter, master;

  // Параметры (берём только из synth.params.js — «идеальная финальная версия»)
  const P = window.SYNTH_PARAMS;

  // Безопасный конструктор с фолбэком (чтобы init не падал из-за узла)
  function safe(fn, fallback){
    try { return fn(); } catch(e){ console.warn('[Synth.init] node fallback:', e); return fallback; }
  }

  Synth.init = async function () {
    if (typeof Tone === 'undefined') throw new Error('Tone.js не загрузился');

    // 1) Контекст и тайминги (помогает от щелчков)
    try {
      const ctx = Tone.getContext();
      const A = (window.AppConfig && AppConfig.AUDIO) || {};
      const C = A.CONTEXT || {};
      ctx.latencyHint    = C.latencyHint || 'playback';
      ctx.lookAhead      = (typeof C.lookAheadSec === 'number') ? C.lookAheadSec : 0.20;
      ctx.updateInterval = (typeof C.updateIntervalSec === 'number') ? C.updateIntervalSec : 0.03;
      if (typeof P.masterDb === 'number') Tone.Destination.volume.value = P.masterDb;
    } catch(_) {}

    // 2) Источники — два слоя полифонии (24 голоса)
    bodyPoly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: P.bodyOsc },
      envelope:   { ...P.bodyEnv, /* хвост даёт реверб */ release: Math.min((P.bodyEnv?.release ?? 0.6), 0.9) }
    });
    bodyPoly.maxPolyphony = 24;

    attackPoly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: P.fmHarmonicity,
      modulationIndex: P.fmModIndex,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope:           { ...P.fmEnv },
      modulationEnvelope: { ...P.fmModEnv }
    });
    attackPoly.maxPolyphony = 24;

    // 3) Гейны и шина
    bodyGain   = new Tone.Gain(P.bodyLevel);
    attackGain = new Tone.Gain(P.attackLevel);
    busGain    = new Tone.Gain(P.busLevel);

    // 4) FX-цепь: DC-cut → Comp → Lowpass → (PreDelay) → Reverb → Limiter
    dcCut  = safe(() => new Tone.Filter(P.dcCutHz ?? 60, "highpass"), new Tone.Gain(1));
    comp   = safe(() => new Tone.Compressor({
      threshold: P.compThresh ?? -30,
      ratio:     P.compRatio  ?? 2.0,
      attack:    P.compAttack ?? 0.03,
      release:   P.compRelease?? 0.25,
      knee: 18
    }), new Tone.Gain(1));
    lowpass = safe(() => new Tone.Filter(P.lowpassFreq ?? 3500, "lowpass"), new Tone.Gain(1));

    // Предзадержка как serial Delay (в Tone.Delay нет .wet)
    const preDelayTime = (typeof P.preDelaySec === 'number') ? P.preDelaySec
                         : (typeof P.delayTime   === 'number') ? P.delayTime : 0.03;
    predelay = safe(() => new Tone.Delay(preDelayTime, 0.5), new Tone.Gain(1));

    // Реверб
    reverb = safe(() => new Tone.Reverb({
      decay:    (typeof P.reverbDecaySec    === 'number') ? P.reverbDecaySec    : 2.6,
      preDelay: (typeof P.reverbPreDelaySec === 'number') ? P.reverbPreDelaySec : 0.03,
      wet:      (typeof P.reverbWet         === 'number') ? P.reverbWet         : 0.22
    }), new Tone.Gain(1));
    try { if (reverb && reverb.ready && typeof reverb.ready.then === 'function') await reverb.ready; } catch(_) {}

    // Микро-дизер (белый шум очень тихо, чтобы «оживить» хвост)
    dither = safe(() => {
      const n = new Tone.Noise("white");
      n.volume.value = (typeof P.ditherDb === 'number') ? P.ditherDb : -85;
      n.start();
      try { n.connect(reverb); } catch(_) { n.connect(busGain); }
      return n;
    }, null);

    limiter = safe(() => (Tone.Limiter ? new Tone.Limiter(-1)
      : new Tone.Compressor({ threshold: -6, ratio: 20, attack: 0.001, release: 0.050 })), new Tone.Gain(1));
    master  = new Tone.Gain(1);

    // Роутинг
    bodyPoly.connect(bodyGain).connect(busGain);
    attackPoly.connect(attackGain).connect(busGain);
    busGain.chain(dcCut, comp, lowpass, predelay, reverb, limiter, master, Tone.Destination);

    ready = true;
  };

  // Проигрывание частоты
  Synth.trigger = function (freq, lenSec, vel = 0.65, whenAbs = null) {
    if (!ready) return;
    const nowTone = Tone.now();
    const MIN_LEAD = 0.020;
    const when = (whenAbs != null) ? whenAbs : (nowTone + MIN_LEAD);

    bodyPoly.triggerAttackRelease(freq, lenSec, when, vel);

    if ((P.attackLevel ?? 0) > 0.001) {
      const atkLen = Math.min(lenSec * 0.35, 0.12);
      const atkVel = Math.min(1, vel * 0.9);
      attackPoly.triggerAttackRelease(freq, atkLen, when, atkVel);
    }
  };

  // Удобный метод: цифра -> частота
  Synth.playDigit = function(digit, lenSec = 0.35, delaySec = 0){
    if (!ready) return;
    const dl = 32.703, dh = 65.406, ratio = dh/dl;
    const d = Math.max(0, Math.min(9, digit|0));
    const freq = dl * Math.pow(ratio, d/9);
    const when = Tone.now() + Math.max(0, +delaySec || 0);
    Synth.trigger(freq, lenSec, 0.8, when);
  };

  window.Synth = Synth;
})();
