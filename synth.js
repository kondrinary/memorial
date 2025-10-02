// synth.js — корпус A/B с MORPH, FM-атака, параллельные реверб и дилей.
// ВЕРСИЯ: голосовой пул для пер-нотного релиза + дилей/фидбек от индекса с плавными рампами.
// Публичный API: Synth.init(), Synth.trigger(freq, lenSec, vel?, whenAbs?, digit?), Synth.fx (чтение).

(function(){
  const Synth = {};
  let ready = false;

  // ===== Утилиты =====
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const has   = (o,k) => Object.prototype.hasOwnProperty.call(o||{}, k);
  const P     = (typeof window !== 'undefined' && window.SYNTH_PARAMS) ? window.SYNTH_PARAMS : {};
  const pick  = (k, def) => has(P,k) ? P[k] : def;
  const merge = (base, extra) => Object.assign({}, base||{}, extra||{});

  // ===== FX/параметры (снимаются единожды на старте) =====
  const FX = {
    // Баланс
    bodyLevel:   pick('bodyLevel', 0.5),
    attackLevel: pick('attackLevel', 0.0),
    busLevel:    pick('busLevel', 0.6),

    // Корпус MORPH
    bodyMorph:   clamp(pick('bodyMorph', 0.0), 0, 1),
    bodyA_Osc:   pick('bodyA_Osc','sine'),
    bodyB_Osc:   pick('bodyB_Osc','sawtooth'),   // важно: валидное имя осциллятора
    bodyEnv:     merge({ attack:0.06, decay:0.30, sustain:0.20, release:0.40, attackCurve:'sine', releaseCurve:'sine' }, pick('bodyEnv', {})),

    // FM-атака
    fmEnable:    pick('fmEnable', true),
    fmModIndex:  pick('fmModIndex', 15),
    fmHarm:      pick('fmHarm', 1.0),
    fmEnv:       merge({ attack:0.015, decay:0.08, sustain:0.00, release:0.10, attackCurve:'sine', releaseCurve:'sine' }, pick('fmEnv', {})),
    fmModEnv:    merge({ attack:0.010, decay:0.06, sustain:0.00, release:0.10, attackCurve:'sine', releaseCurve:'sine' }, pick('fmModEnv', {})),

    // Магистраль
    dcCutHz:     pick('dcCutHz', 80),
    compThresh:  pick('compThresh', -30),
    compRatio:   pick('compRatio', 2.0),
    compAttack:  pick('compAttack', 0.03),
    compRelease: pick('compRelease', 0.25),
    lowpassFreq: pick('lowpassFreq', 3300),

    // Реверб-ветка
    reverbRoom:  clamp(pick('reverbRoom', 0.78), 0, 1),
    reverbDamp:  pick('reverbDamp', 1900),
    reverbWet:   clamp(pick('reverbWet', 0.18), 0, 1),
    revEqLow:    pick('revEqLow', 0),
    revEqMid:    pick('revEqMid', 0),
    revEqHigh:   pick('revEqHigh', 0),
    revEqLowFreq:  pick('revEqLowFreq', 400),
    revEqHighFreq: pick('revEqHighFreq', 2500),
    revEqQ:        pick('revEqQ', 1.0),

    // Дилей-ветка (стартовые значения; дальше — от индекса)
    delayTime:   pick('delayTime', '4n'),
    feedback:    clamp(pick('feedback', 0.18), 0, 0.95),
    delayWet:    clamp(pick('delayWet', 0.08), 0, 1),
    echoWet:  clamp(pick('echoWet',  0.70), 0, 1),
    echoRoom: clamp(pick('echoRoom', 0.65), 0, 1),
    echoDamp:       pick('echoDamp', 2200),

    // Индекс-зависимые кривые
    indexRelMin:       pick('indexRelMin', 0.30),
    indexRelMax:       pick('indexRelMax', 6.00),
    indexRelCurveK:    pick('indexRelCurveK', 1.0),
    indexDelayMinSec:  pick('indexDelayMinSec', 0.08),
    indexDelayMaxSec:  pick('indexDelayMaxSec', 0.60),
    indexFeedbackMin:  clamp(pick('indexFeedbackMin', 0.20), 0, 0.95),
    indexFeedbackMax:  clamp(pick('indexFeedbackMax', 0.65), 0, 0.95),
    indexDelayCurveK:     pick('indexDelayCurveK', 1.2),
    indexFeedbackCurveK:  pick('indexFeedbackCurveK', 1.3),

    // Полифония/мастер
    bodyPolyMax:   pick('bodyPolyMax', 16),
    attackPolyMax: pick('attackPolyMax', 16),
    masterDb:      pick('masterDb', -4),

    // --- Мастер-EQ (после masterGain) ---
    masterEqEnable: pick('masterEqEnable', true),
    masterEqLow:    pick('masterEqLow',   0),
    masterEqMid:    pick('masterEqMid',   0),
    masterEqHigh:   pick('masterEqHigh',  0),
    masterEqLowFreq:  pick('masterEqLowFreq',  400),
    masterEqHighFreq: pick('masterEqHighFreq', 2500),
    masterEqQ:        pick('masterEqQ',    1.0),





  };

  // ===== Узлы звука =====
  // Корпус: пул голосов (каждый голос = Synth A + Synth B + CrossFade + Gain)
  let voices = [];
  class Voice {
    constructor(opts){
      const { bodyEnv, bodyA_Osc, bodyB_Osc, bodyMorph, bodyLevel } = opts;
      this.a  = new Tone.Synth({ oscillator:{ type: bodyA_Osc }, envelope:{ ...bodyEnv } });
      this.b  = new Tone.Synth({ oscillator:{ type: bodyB_Osc }, envelope:{ ...bodyEnv } });
      this.xf = new Tone.CrossFade(clamp(bodyMorph,0,1));
      this.nominal = clamp(bodyLevel,0,1);
      this.g  = new Tone.Gain(this.nominal);
      this.a.connect(this.xf.a);
      this.b.connect(this.xf.b);
      this.xf.connect(this.g);
      this.freeAt = 0;
    }
    connect(dest){ this.g.connect(dest); }
    play(freq, lenSec, vel, when, rel){
      // Если голос ещё занят к моменту новой ноты — мягко приглушим его перед атакой
      if (this.freeAt > when) {
        const now = Tone.now();
        const pre = Math.max(now, when - 0.012); // 12 мс до старта
        const post = when + 0.008;               // 8 мс после старта
        if (this.g.gain.cancelAndHoldAtTime && this.g.gain.linearRampToValueAtTime) {
          this.g.gain.cancelAndHoldAtTime(pre);
          this.g.gain.linearRampToValueAtTime(0, when);
          this.g.gain.linearRampToValueAtTime(this.nominal, post);
        }
      }
      // Релиз пер-нотно, не затрагивая другие голоса
      this.a.set({ envelope:{ release: rel }});
      this.b.set({ envelope:{ release: rel }});
      // Запуск ноты
      this.a.triggerAttackRelease(freq, lenSec, when, vel);
      this.b.triggerAttackRelease(freq, lenSec, when, vel);
      this.freeAt = when + lenSec + rel + 0.03;
    }
  }
  function pickVoice(atTime){
    let best = voices[0];
    for (const v of voices){
      if (v.freeAt <= atTime) return v;
      if (!best || v.freeAt < best.freeAt) best = v;
    }
    return best;
  }

  // FM-атака (общий PolySynth ок, т.к. короткие вспышки)
  let attackPoly, attackGain;

  // Сумма и FX
  let bodyBusGain, dcHPF, comp, lowpass;
  let dryGain, revSend, reverb, revEQ, revWetGain;
  let delSend, ping, delWetGain;
  let echoVerb; // реверб для ПОВТОРОВ, стоит ПОСЛЕ дилея
  let masterGain, masterEQ; // мастер-EQ (EQ3) между masterGain и Destination

  // ===== Инициализация =====
  Synth.init = function(){
    if (ready) return Synth.fx;

    // Пул голосов корпуса
    const N = Math.max(1, FX.bodyPolyMax|0);
    voices = new Array(N);
    for (let i=0;i<N;i++){
      const v = new Voice({
        bodyEnv: FX.bodyEnv,
        bodyA_Osc: FX.bodyA_Osc,
        bodyB_Osc: FX.bodyB_Osc,
        bodyMorph: FX.bodyMorph,
        bodyLevel: FX.bodyLevel
      });
      voices[i] = v;
    }

    // FM-атака
    attackPoly = new Tone.PolySynth(Tone.FMSynth, {
      maxPolyphony: FX.attackPolyMax|0,
      volume: -6
    });
    attackPoly.set({
      harmonicity: FX.fmHarm,
      modulationIndex: FX.fmModIndex,
      envelope: FX.fmEnv,
      modulationEnvelope: FX.fmModEnv
    });
    attackGain = new Tone.Gain(clamp(FX.attackLevel,0,1));

    // Шина корпуса
    bodyBusGain = new Tone.Gain(clamp(FX.busLevel,0,1));

    // Подключаем голоса к шине
    for (const v of voices) v.connect(bodyBusGain);
    attackPoly.connect(attackGain);
    attackGain.connect(bodyBusGain);

    // Последовательная магистраль
    dcHPF   = new Tone.Filter({ type:'highpass', frequency: FX.dcCutHz, Q: 0.300 });
    comp    = new Tone.Compressor({ threshold: FX.compThresh, ratio: FX.compRatio, attack: FX.compAttack, release: FX.compRelease });
    lowpass = new Tone.Filter({ type:'lowpass', frequency: FX.lowpassFreq, Q: 0.300 });

    bodyBusGain.connect(dcHPF);
    dcHPF.connect(comp);
    comp.connect(lowpass);

    // Разветвление на параллельные ветки
    dryGain   = new Tone.Gain(1);
    revSend   = new Tone.Gain(1);
    delSend   = new Tone.Gain(1);
    lowpass.fan(dryGain, revSend, delSend);

    // Реверб-ветка: Freeverb → EQ3 → revWetGain
    reverb    = new Tone.Freeverb({ roomSize: FX.reverbRoom, dampening: FX.reverbDamp, wet: 1 });
    revEQ     = new Tone.EQ3({ low: FX.revEqLow, mid: FX.revEqMid, high: FX.revEqHigh, lowFrequency: FX.revEqLowFreq, highFrequency: FX.revEqHighFreq,   Q: FX.revEqQ     });
    revWetGain= new Tone.Gain(clamp(FX.reverbWet,0,1));
    revSend.chain(reverb, revEQ, revWetGain);

// Дилей-ветка: PingPongDelay → (ЭХО-реверб) → delWetGain
const maxDT = Math.max(FX.indexDelayMaxSec || 1.0, 1.0);
ping     = new Tone.PingPongDelay({ delayTime: FX.delayTime, feedback: FX.feedback, wet: 1, maxDelayTime: maxDT });
echoVerb = new Tone.Freeverb({ roomSize: FX.echoRoom, dampening: FX.echoDamp, wet: FX.echoWet });
delWetGain = new Tone.Gain(clamp(FX.delayWet,0,1));

// если у тебя уже стоят «сглаживающие» узлы (например, delPreComp, delTone) — оставь их ПЕРЕД ping:
// delSend.chain(delPreComp, delTone, ping, echoVerb, delWetGain);
delSend.chain(ping, echoVerb, delWetGain);


    // Мастер
    masterGain = new Tone.Gain(1);
    dryGain.connect(masterGain);
    revWetGain.connect(masterGain);
    delWetGain.connect(masterGain);

    // [ADD] Аккуратно вставляем мастер-EQ после мастера (не изменяя остальную архитектуру)
    if (FX.masterEqEnable) {
      masterEQ = new Tone.EQ3({
        low:  FX.masterEqLow,
        mid:  FX.masterEqMid,
        high: FX.masterEqHigh,
        lowFrequency:  FX.masterEqLowFreq,
        highFrequency: FX.masterEqHighFreq,
        Q: FX.masterEqQ
      });
      masterGain.chain(masterEQ, Tone.Destination);
    } else {
      masterGain.connect(Tone.Destination);
    }

    Tone.Destination.volume.value = FX.masterDb;


    ready = true;
    Synth.fx = FX;
    return Synth.fx;
  };

  // ===== Триггер ноты =====
  // digit: 0..9 — цифра текущей ноты (высота), влияет на релиз и дилей
  Synth.trigger = function(freq, lenSec, vel=0.65, whenAbs=null, digit=null){
    if (!ready) return;
    const now = Tone.now();
    const when = (whenAbs!=null) ? whenAbs : (now + 0.015);

    // Нормированное значение индекса
    const d = (digit==null ? 0 : clamp(digit|0, 0, 9));
    const t = d / 9; // 0..1

    // --- Релиз по индексу (экспонента k): низ длинный, верх короткий ---
    const k   = FX.indexRelCurveK;
    const rel = FX.indexRelMin + (FX.indexRelMax - FX.indexRelMin) * Math.pow(1 - t, k);

    // --- Дилей/фидбек по индексу ---
    // ВРЕМЯ: низ (t=0) = длиннее, верх (t=1) = короче
    const dtSec = FX.indexDelayMaxSec - (FX.indexDelayMaxSec - FX.indexDelayMinSec) * Math.pow(t, FX.indexDelayCurveK || 1);
    // ФИДБЕК: растёт к верху
    const fb    = FX.indexFeedbackMin + (FX.indexFeedbackMax - FX.indexFeedbackMin) * Math.pow(t, FX.indexFeedbackCurveK || 1);
    const fbSafe= clamp(fb, 0, 0.90);

    // Плавные рампы для избежания щелчков при смене параметров
    const ramp = 0.02; // 20 мс
    const now2  = Tone.now();
    const r0    = Math.max(now2, when - ramp); // подводим значение ЧУТЬ до атаки

    if (ping?.delayTime?.cancelAndHoldAtTime && ping?.delayTime?.linearRampToValueAtTime){
      ping.delayTime.cancelAndHoldAtTime(r0);
      ping.delayTime.linearRampToValueAtTime(dtSec, when);
    } else if (ping?.delayTime?.setValueAtTime){
      ping.delayTime.setValueAtTime(dtSec, when);
    } else {
      ping.delayTime.value = dtSec;
    }
    if (ping?.feedback?.cancelAndHoldAtTime && ping?.feedback?.linearRampToValueAtTime){
      ping.feedback.cancelAndHoldAtTime(r0);
      ping.feedback.linearRampToValueAtTime(fbSafe, when);
    } else if (ping?.feedback?.setValueAtTime){
      ping.feedback.setValueAtTime(fbSafe, when);
    } else if (ping?.feedback?.rampTo){
      ping.feedback.rampTo(fbSafe, ramp);
    } else {
      ping.feedback.value = fbSafe;
    }

    // --- Запускаем корпус через голос с пер-нотным релизом ---
    const v = pickVoice(when);
    v.play(freq, lenSec, vel, when, rel);

    // --- FM-атака (опционально) ---
    if (FX.fmEnable && FX.attackLevel > 0.001){
      const atkLen = Math.min(lenSec, 0.10);
      const atkVel = Math.min(1, vel * 0.6);
      attackPoly.triggerAttackRelease(freq, atkLen, when, atkVel);
    }
  };

  
  window.Synth = Synth;
})();
