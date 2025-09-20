// synth.js — мягкий синт без семплов (анти-щёлчки) + загрузка параметров из synth.params.js
(function () {
  const Synth = {};
  let ready = false;

  // Узлы
  let bodyPoly, attackPoly;
  let bodyGain, attackGain, busGain;
  let dcCut, comp, lowpass, ping, reverb, master;

  // === Параметры из внешнего профиля ===
  // Берём window.SYNTH_PARAMS, а где нет — используем прежние дефолты (сохранён звук и механика)
  const P = (window.SYNTH_PARAMS || {});
  const FX = {
    // Баланс слоёв/шины
    bodyLevel:   pick('bodyLevel',   0.50),
    attackLevel: pick('attackLevel', 0.00),
    busLevel:    pick('busLevel',    0.55),

    // Корпус
    bodyOsc: pick('bodyOsc', 'sine'),
    bodyEnv: merge(
      {
        attack: 0.060, decay: 0.30, sustain: 0.20, release: 2.0,
        attackCurve: 'sine', releaseCurve: 'sine'
      },
      P.bodyEnv
    ),

    // FM-слой (атака)
    fmHarmonicity: pick('fmHarmonicity', 1.7),
    fmModIndex:    pick('fmModIndex',    4.0),
    fmEnv: merge(
      { attack:0.015, decay:0.10, sustain:0.05, release:0.12, attackCurve:'sine', releaseCurve:'sine' },
      P.fmEnv
    ),
    fmModEnv: merge(
      { attack:0.015, decay:0.10, sustain:0.05, release:0.12, attackCurve:'sine', releaseCurve:'sine' },
      P.fmModEnv
    ),

    // Тональный баланс и FX
    dcCutHz:     pick('dcCutHz',     80),
    lowpassFreq: pick('lowpassFreq', 3300),

    delayTime: pick('preDelaySec', P.delayTime !== undefined ? P.delayTime : '4n'), // поддержка и секунд, и музыкальных значений
    feedback:  pick('feedback',  0.18),
    delayWet:  pick('delayWet',  0.08),

    reverbRoom: pick('reverbRoom', 0.78),
    reverbDamp: pick('reverbDamp', 1900),
    reverbWet:  pick('reverbWet',  0.18),

    compThresh:  pick('compThresh',  -30),
    compRatio:   pick('compRatio',   2.0),
    compAttack:  pick('compAttack',  0.03),
    compRelease: pick('compRelease', 0.25),

    // Системные/прочее
    bodyPolyMax:   pick('bodyPolyMax',   16),
    attackPolyMax: pick('attackPolyMax', 16),
    masterDb:      pick('masterDb',      -4)
  };

  // Вспомогательные
  function pick(key, def){ return (P[key] !== undefined ? P[key] : def); }
  function merge(base, extra){
    if (!extra) return { ...base };
    const out = { ...base };
    for (const k in extra){
      const v = extra[k];
      // глубже только для простых вложенных объектов
      out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(base[k]||{}), ...v } : v;
    }
    return out;
  }

  Synth.init = async function () {
    if (typeof Tone === 'undefined') throw new Error('Tone.js не загрузился');

    // Аудиоконтекст/планировщик
    try {
      const ctx = Tone.getContext();
      ctx.latencyHint    = 'playback';
      ctx.lookAhead      = 0.20;
      ctx.updateInterval = 0.03;
      Tone.Destination.volume.value = FX.masterDb; // из внешних параметров
    } catch (_) {}

    // PolySynth (корпус)
    bodyPoly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: FX.bodyOsc },
      envelope:   { ...FX.bodyEnv }
    });
    bodyPoly.maxPolyphony = FX.bodyPolyMax | 0;

    // PolySynth (FM-атака)
    attackPoly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: FX.fmHarmonicity,
      modulationIndex: FX.fmModIndex,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope:           { ...FX.fmEnv },
      modulationEnvelope: { ...FX.fmModEnv }
    });
    attackPoly.maxPolyphony = FX.attackPolyMax | 0;

    // Гейны + шина
    bodyGain   = new Tone.Gain(FX.bodyLevel);
    attackGain = new Tone.Gain(FX.attackLevel);
    busGain    = new Tone.Gain(FX.busLevel);

    // FX на BUS
    dcCut  = new Tone.Filter(FX.dcCutHz, 'highpass');
    comp   = new Tone.Compressor({
      threshold: FX.compThresh, ratio: FX.compRatio,
      attack: FX.compAttack, release: FX.compRelease
    });
    lowpass= new Tone.Filter(FX.lowpassFreq, 'lowpass');

    // Delay: поддержка секундного значения и музыкального (например "4n")
    const delayNodeOpts = {};
    if (typeof FX.delayTime === 'number'){
      delayNodeOpts.delayTime = FX.delayTime;
    } else {
      delayNodeOpts.delayTime = FX.delayTime; // строка типа "4n"
    }
    delayNodeOpts.feedback = FX.feedback;
    delayNodeOpts.wet      = FX.delayWet;
    ping   = new Tone.PingPongDelay(delayNodeOpts);

    reverb = new Tone.Freeverb({
      roomSize:   FX.reverbRoom,
      dampening:  FX.reverbDamp,
      wet:        FX.reverbWet
    });

    master = new Tone.Gain(1);

    // Роутинг
    bodyPoly.connect(bodyGain).connect(busGain);
    attackPoly.connect(attackGain).connect(busGain);
    busGain.chain(dcCut, comp, lowpass, ping, reverb, master, Tone.Destination);

    ready = true;
    // Экспорт актуального среза параметров (для live-правки через setFX)
    Synth.fx = JSON.parse(JSON.stringify(FX));
  };

  // Воспроизведение ноты (поддержка whenAbs)
  // Synth.trigger(freq, lenSec, vel=0.65, whenAbs=null)
  Synth.trigger = function (freq, lenSec, vel = 0.65, whenAbs = null) {
    if (!ready) return;
    const nowTone = Tone.now();
    const when = (whenAbs != null) ? whenAbs : (nowTone + 0.015);

    bodyPoly.triggerAttackRelease(freq, lenSec, when, vel);

    if (Synth.fx.attackLevel > 0.001) {
      const atkLen = Math.min(lenSec, 0.10);
      const atkVel = Math.min(1, vel * 0.6);
      attackPoly.triggerAttackRelease(freq, atkLen, when, atkVel);
    }
  };

  // Живая правка (опционально, API как раньше)
  Synth.setFX = function (partial) {
    if (!partial) return Synth.fx;
    Object.assign(Synth.fx, partial);

    // Баланс
    if (partial.bodyLevel   != null) bodyGain.gain.rampTo(partial.bodyLevel, 0.03);
    if (partial.attackLevel != null) attackGain.gain.rampTo(partial.attackLevel, 0.03);
    if (partial.busLevel    != null) busGain.gain.rampTo(partial.busLevel, 0.04);

    // Корпус
    if (partial.bodyOsc) bodyPoly.set({ oscillator: { type: partial.bodyOsc } });
    if (partial.bodyEnv) bodyPoly.set({ envelope: { ...Synth.fx.bodyEnv, ...partial.bodyEnv } });

    // FM-слой
    if (partial.fmHarmonicity != null || partial.fmModIndex != null || partial.fmEnv || partial.fmModEnv) {
      attackPoly.set({
        harmonicity: partial.fmHarmonicity ?? Synth.fx.fmHarmonicity,
        modulationIndex: partial.fmModIndex ?? Synth.fx.fmModIndex,
        envelope:           partial.fmEnv    ? { ...Synth.fx.fmEnv,    ...partial.fmEnv }    : Synth.fx.fmEnv,
        modulationEnvelope: partial.fmModEnv ? { ...Synth.fx.fmModEnv, ...partial.fmModEnv } : Synth.fx.fmModEnv
      });
    }

    // Фильтры/FX
    if (partial.dcCutHz     != null) dcCut.frequency.rampTo(partial.dcCutHz, 0.06);
    if (partial.lowpassFreq != null) lowpass.frequency.rampTo(partial.lowpassFreq, 0.06);

    if (partial.delayTime  != null) ping.delayTime.value = partial.delayTime;
    if (partial.feedback   != null) ping.feedback.rampTo(partial.feedback, 0.06);
    if (partial.delayWet   != null) ping.wet.rampTo(partial.delayWet, 0.06);

    if (partial.reverbWet  != null) reverb.wet.rampTo(partial.reverbWet, 0.06);
    if (partial.reverbRoom != null) reverb.roomSize.value = partial.reverbRoom;
    if (partial.reverbDamp != null) reverb.dampening.value= partial.reverbDamp;

    if (partial.masterDb   != null) Tone.Destination.volume.rampTo(partial.masterDb, 0.06);

    // Полифония (если нужно менять на лету)
    if (partial.bodyPolyMax   != null) bodyPoly.maxPolyphony   = partial.bodyPolyMax | 0;
    if (partial.attackPolyMax != null) attackPoly.maxPolyphony = partial.attackPolyMax | 0;

    return Synth.fx;
  };

  window.Synth = Synth;
})();
