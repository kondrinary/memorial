// synth.js — максимально мягкий синт без семплов (анти-щёлчки).
// Один «корпусной» слой + (опционально) очень тихий FM-слой атаки, сведённые в BUS.
// BUS → HPF 80Гц → Comp → LPF → Delay (сухо) → Reverb (сухо) → Out.

(function () {
  const Synth = {};
  let ready = false;

  // Узлы
  let bodyPoly, attackPoly;
  let bodyGain, attackGain, busGain;
  let dcCut, comp, lowpass, ping, reverb, master;

  // ================== ПАРАМЕТРЫ (крутить здесь) ==================
  const FX = {
    // Баланс слоёв
    bodyLevel:   0.50,   // основной слой
    attackLevel: 0.00,   // FM-атака ВЫКЛ по умолчанию (0.00). Если щелчков нет — пробуй 0.06–0.10.

    // Корпус (Tone.Synth)
    bodyOsc: "sine",     // "sine" | "triangle"
    bodyEnv: {
      attack: 0.060,     // длиннее атака = меньше щелчков
      decay:  0.30,
      sustain:0.20,
      release:2.0,       // умеренный хвост, чтобы не наслаивалось
      attackCurve:  "sine",
      releaseCurve: "sine"
    },

    // Атака (Tone.FMSynth) — отключена уровнем, но настроена мягко
    fmHarmonicity:  1.7,
    fmModIndex:     4.0,
    fmEnv: {
      attack: 0.015,
      decay:  0.10,
      sustain: 0.05,
      release: 0.12,
      attackCurve:  "sine",
      releaseCurve: "sine"
    },
    fmModEnv: {
      attack: 0.015,
      decay:  0.10,
      sustain: 0.05,
      release: 0.12,
      attackCurve:  "sine",
      releaseCurve: "sine"
    },

    // Общий BUS
    busLevel: 0.55,

    // Тон/мягкость
    lowpassFreq: 3300,   // 3000–5200 Гц: ниже = мягче

    // Эффекты — СУХО (минимум артефактов)
    delayTime: "4n",
    feedback:  0.18,
    delayWet:  0.08,     // «мокрота» эха
    reverbRoom: 0.78,
    reverbDamp: 1900,
    reverbWet:  0.18,    // «мокрота» реверба

    // Мягкая компрессия на BUS (сглаживает пики)
    compThresh:  -30,
    compRatio:   2.0,
    compAttack:  0.03,
    compRelease: 0.25
  };
  // ================================================================

  Synth.init = async function () {
    if (typeof Tone === 'undefined') throw new Error('Tone.js не загрузился');

    // Стабилизация планировщика
    try {
      const ctx = Tone.getContext();
      ctx.latencyHint   = 'playback';
      ctx.lookAhead     = 0.20;     // ↑ запас на планирование
      ctx.updateInterval= 0.03;
      Tone.Destination.volume.value = -4; // тише мастер
    } catch (_) {}

    // PolySynth (корпус)
    bodyPoly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: FX.bodyOsc },
      envelope:   { ...FX.bodyEnv }
    });
    bodyPoly.maxPolyphony = 16; // достаточно, но без лишних голосов

    // PolySynth (FM-атака)
    attackPoly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: FX.fmHarmonicity,
      modulationIndex: FX.fmModIndex,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope:           { ...FX.fmEnv },
      modulationEnvelope: { ...FX.fmModEnv }
    });
    attackPoly.maxPolyphony = 16;

    // Гейны слоёв + BUS
    bodyGain   = new Tone.Gain(FX.bodyLevel);
    attackGain = new Tone.Gain(FX.attackLevel); // 0.00 по умолчанию
    busGain    = new Tone.Gain(FX.busLevel);

    // FX на BUS
    dcCut  = new Tone.Filter(80, "highpass"); // подняли до 80 Гц — меньше «низового» треска
    comp   = new Tone.Compressor({
      threshold: FX.compThresh, ratio: FX.compRatio,
      attack: FX.compAttack, release: FX.compRelease
    });
    lowpass= new Tone.Filter(FX.lowpassFreq, "lowpass");
    ping   = new Tone.PingPongDelay({
      delayTime: FX.delayTime, feedback: FX.feedback, wet: FX.delayWet
    });
    reverb = new Tone.Freeverb({
      roomSize: FX.reverbRoom, dampening: FX.reverbDamp, wet: FX.reverbWet
    });
    master = new Tone.Gain(1);

    // Роутинг
    bodyPoly.connect(bodyGain).connect(busGain);
    attackPoly.connect(attackGain).connect(busGain);
    busGain.chain(dcCut, comp, lowpass, ping, reverb, master, Tone.Destination);

    ready = true;
    Synth.fx = { ...FX };
  };

  // Воспроизведение ноты
Synth.trigger = function (freq, lenSec, vel = 0.65, whenAbs = null) {
    if (!ready) return;
    const nowTone = Tone.now();
    const when = (whenAbs != null) ? whenAbs : (nowTone + 0.015); // 15 мс на разлёт

    bodyPoly.triggerAttackRelease(freq, lenSec, when, vel);

    if (Synth.fx.attackLevel > 0.001) {
      const atkLen = Math.min(lenSec, 0.10);
      const atkVel = Math.min(1, vel * 0.6);
      attackPoly.triggerAttackRelease(freq, atkLen, when, atkVel);
    }
  };

  // Живая правка (опционально)
  Synth.setFX = function (partial) {
    if (!partial) return Synth.fx;
    Object.assign(Synth.fx, partial);

    if (partial.bodyLevel   != null) bodyGain.gain.rampTo(partial.bodyLevel, 0.03);
    if (partial.attackLevel != null) attackGain.gain.rampTo(partial.attackLevel, 0.03);
    if (partial.busLevel    != null) busGain.gain.rampTo(partial.busLevel, 0.04);

    if (partial.bodyOsc) bodyPoly.set({ oscillator: { type: partial.bodyOsc } });
    if (partial.bodyEnv) bodyPoly.set({ envelope: { ...Synth.fx.bodyEnv, ...partial.bodyEnv } });

    if (partial.fmHarmonicity != null || partial.fmModIndex != null ||
        partial.fmEnv || partial.fmModEnv) {
      attackPoly.set({
        harmonicity: partial.fmHarmonicity ?? Synth.fx.fmHarmonicity,
        modulationIndex: partial.fmModIndex ?? Synth.fx.fmModIndex,
        envelope:           partial.fmEnv    ? { ...Synth.fx.fmEnv,    ...partial.fmEnv }    : Synth.fx.fmEnv,
        modulationEnvelope: partial.fmModEnv ? { ...Synth.fx.fmModEnv, ...partial.fmModEnv } : Synth.fx.fmModEnv
      });
    }

    if (partial.lowpassFreq != null) lowpass.frequency.rampTo(partial.lowpassFreq, 0.06);
    if (partial.delayTime  != null) ping.delayTime.value = partial.delayTime;
    if (partial.feedback   != null) ping.feedback.rampTo(partial.feedback, 0.06);
    if (partial.delayWet   != null) ping.wet.rampTo(partial.delayWet, 0.06);
    if (partial.reverbWet  != null) reverb.wet.rampTo(partial.reverbWet, 0.06);
    if (partial.reverbRoom != null) reverb.roomSize.value = partial.reverbRoom;
    if (partial.reverbDamp != null) reverb.dampening.value= partial.reverbDamp;

    return Synth.fx;
  };

  window.Synth = Synth;
})();
