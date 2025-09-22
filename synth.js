// synth.commented.js — версия с MORPH (CrossFade) между двумя корпусами: синус ⇄ пила
// Параллельные FX‑ветки: Reverb→EQ и отдельный Delay, подмешиваются к сухому тону.
//
// Архитектура:
//  (Корпус А: sine) ─┐
//                    ├─► CrossFade(fade=bodyMorph 0..1) ─► bodyGain ─┐
//  (Корпус B: saw) ──┘                                               │
//                                                                   ▼
//  + (FM‑атака, опционально) ─► attackGain ─┐
//                                           ├─► busGain ─► DC‑HPF ─► Comp ─► Lowpass ─►┬─► dryGain ─┬─► master ─► Destination
//                                           │                                           ├─► revSend → Freeverb → EQ3 → revWetGain ─┘
//                                           │                                           └─► delSend → PingPongDelay → delWetGain ──┘
// Примечание: FM‑слой можно выключить полностью (FX.fmEnable=false или attackLevel=0).

(function () {
  const Synth = {};             // Публичный API: init, trigger, setFX, fx
  let ready = false;            // true после инициализации

  // === Узлы ===
  let bodyPolyA, bodyPolyB;     // ДВА корпусных полисинта: A (sine) и B (saw)
  let bodyXFade;                // CrossFade для морфа спектра между A и B
  let bodyGain, attackPoly, attackGain, busGain; // уровни и FM‑слой
  let dcCut, comp, lowpass, dryGain;             // магистраль
  let revSend, reverb, revEQ, revWetGain;        // параллельная ревёрб‑ветка
  let delSend, ping, delWetGain;                 // параллельная дилей‑ветка
  let master;                                    // мастер перед Destination

  // === Все настройки в начале === P  берем из внешнего модуля SYNTH_PARAMS
  const P = (window.SYNTH_PARAMS || {}); 

  const FX = {
    // Баланс и уровни
    bodyLevel:   pick('bodyLevel',   0.50),  // общий уровень корпуса (после CrossFade)
    attackLevel: pick('attackLevel', 0.00),  // уровень FM‑атаки
    busLevel:    pick('busLevel',    0.55),

    // Корпусный MORPH (A ↔ B)
    bodyMorph:   pick('bodyMorph',   0.00),  // 0 = чистый sine (A), 1 = чистая saw (B)
    bodyA_Osc:   pick('bodyA_Osc',  'sine'), // тип волны корпуса A (по умолчанию sine)
    bodyB_Osc:   pick('bodyB_Osc',  'sawtooth'),  // тип волны корпуса B (по умолчанию saw)
    // единая огибающая корпуса (применяется к обоим синтам A и B)
    bodyEnv: merge({ attack:0.060, decay:0.30, sustain:0.20, release:2.0, attackCurve:'sine', releaseCurve:'sine' }, P.bodyEnv),

    // FM‑слой (можно отключить полностью)
    fmEnable:      pick('fmEnable', true),
    fmHarmonicity: pick('fmHarmonicity', 1.7),
    fmModIndex:    pick('fmModIndex',    4.0),
    fmEnv:    merge({ attack:0.015, decay:0.10, sustain:0.05, release:0.12, attackCurve:'sine', releaseCurve:'sine' }, P.fmEnv),
    fmModEnv: merge({ attack:0.015, decay:0.10, sustain:0.05, release:0.12, attackCurve:'sine', releaseCurve:'sine' }, P.fmModEnv),

    // Магистраль
    dcCutHz:     pick('dcCutHz',     80),
    compThresh:  pick('compThresh',  -30),
    compRatio:   pick('compRatio',   2.0),
    compAttack:  pick('compAttack',  0.03),
    compRelease: pick('compRelease', 0.25),
    lowpassFreq: pick('lowpassFreq', 3300),

    // Параллельная ревёрб‑ветка
    reverbRoom: pick('reverbRoom', 0.78),
    reverbDamp: pick('reverbDamp', 1900),
    reverbWet:  pick('reverbWet',  0.18),
    revEqLow:       pick('revEqLow', 0),
    revEqMid:       pick('revEqMid', 0),
    revEqHigh:      pick('revEqHigh',0),
    revEqLowFreq:   pick('revEqLowFreq', 400),
    revEqHighFreq:  pick('revEqHighFreq',2500),

    // Параллельная дилей‑ветка
    delayTime: (P.preDelaySec !== undefined ? P.preDelaySec : (P.delayTime !== undefined ? P.delayTime : '4n')),
    feedback:  pick('feedback',  0.18),
    delayWet:  pick('delayWet',  0.08),

    // Системные
    bodyPolyMax:   pick('bodyPolyMax',   16),
    attackPolyMax: pick('attackPolyMax', 16),
    masterDb:      pick('masterDb',      -4)
  };

  function pick(key, def){ return (P[key] !== undefined ? P[key] : def); }
  function merge(base, extra){ if (!extra) return { ...base }; const out = { ...base }; for (const k in extra){ const v = extra[k]; out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(base[k]||{}), ...v } : v; } return out; }

  // === Инициализация ===
  Synth.init = async function(){
    if (typeof Tone === 'undefined') throw new Error('Tone.js не загрузился');
    try{ const ctx = Tone.getContext(); ctx.latencyHint='playback'; ctx.lookAhead=0.20; ctx.updateInterval=0.03; Tone.Destination.volume.value=FX.masterDb; }catch(_){ }

    // ДВА корпуса: одинаковая огибающая, разные формы
    bodyPolyA = new Tone.PolySynth(Tone.Synth, { oscillator:{ type: FX.bodyA_Osc }, envelope:{ ...FX.bodyEnv } });
    bodyPolyB = new Tone.PolySynth(Tone.Synth, { oscillator:{ type: FX.bodyB_Osc }, envelope:{ ...FX.bodyEnv } });
    bodyPolyA.maxPolyphony = FX.bodyPolyMax | 0;
    bodyPolyB.maxPolyphony = FX.bodyPolyMax | 0;

    // CrossFade для морфа спектра
    bodyXFade = new Tone.CrossFade(FX.bodyMorph); // 0..1, equal‑power crossfade

    // Соединяем корпуса в CrossFade входы
    bodyPolyA.connect(bodyXFade.a);
    bodyPolyB.connect(bodyXFade.b);

    // Гейн корпуса (после морфа)
    bodyGain = new Tone.Gain(FX.bodyLevel);

    // FM‑слой (опционально)
    attackPoly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: FX.fmHarmonicity,
      modulationIndex: FX.fmModIndex,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { ...FX.fmEnv },
      modulationEnvelope: { ...FX.fmModEnv }
    });
    attackPoly.maxPolyphony = FX.attackPolyMax | 0;
    attackGain = new Tone.Gain(FX.attackLevel);

    // Общая шина
    busGain = new Tone.Gain(FX.busLevel);

    // Магистраль
    dcCut   = new Tone.Filter(FX.dcCutHz, 'highpass');
    comp    = new Tone.Compressor({ threshold: FX.compThresh, ratio: FX.compRatio, attack: FX.compAttack, release: FX.compRelease });
    lowpass = new Tone.Filter(FX.lowpassFreq, 'lowpass');
    dryGain = new Tone.Gain(1);

    // Параллельная реверб‑ветка
    revSend    = new Tone.Gain(1);
    reverb     = new Tone.Freeverb({ roomSize: FX.reverbRoom, dampening: FX.reverbDamp, wet: 1 });
    revEQ      = new Tone.EQ3({ low: FX.revEqLow, mid: FX.revEqMid, high: FX.revEqHigh, lowFrequency: FX.revEqLowFreq, highFrequency: FX.revEqHighFreq });
    revWetGain = new Tone.Gain(FX.reverbWet);

    // Параллельная дилей‑ветка
    delSend    = new Tone.Gain(1);
    ping       = new Tone.PingPongDelay({ delayTime: FX.delayTime, feedback: FX.feedback, wet: 1 });
    delWetGain = new Tone.Gain(FX.delayWet);

    // Роутинг: корпуса → XFade → bodyGain → bus; FM → attackGain → bus
    bodyXFade.connect(bodyGain).connect(busGain);
    attackPoly.connect(attackGain).connect(busGain);

    // Шина в магистраль
    busGain.chain(dcCut, comp, lowpass);

    // Разветвление на параллельные FX
    lowpass.connect(dryGain);
    lowpass.connect(revSend);
    lowpass.connect(delSend);

    // Параллельные ветки
    revSend.chain(reverb, revEQ, revWetGain);
    delSend.chain(ping, delWetGain);

    // Сумма путей → мастер → выход
    master = new Tone.Gain(1);
    dryGain.connect(master);
    revWetGain.connect(master);
    delWetGain.connect(master);
    master.connect(Tone.Destination);

    ready = true;
    Synth.fx = JSON.parse(JSON.stringify(FX));
  };

  // === Триггер ноты ===
  Synth.trigger = function(freq, lenSec, vel=0.65, whenAbs=null){
    if (!ready) return;
    const nowTone = Tone.now();
    const when = (whenAbs!=null) ? whenAbs : (nowTone + 0.015);

    // Оба корпуса играют одновременно, а видимая доля определяется CrossFade
    bodyPolyA.triggerAttackRelease(freq, lenSec, when, vel);
    bodyPolyB.triggerAttackRelease(freq, lenSec, when, vel);

    // FM‑слой — по желанию
    if (Synth.fx.fmEnable && Synth.fx.attackLevel > 0.001){
      const atkLen = Math.min(lenSec, 0.10);
      const atkVel = Math.min(1, vel * 0.6);
      attackPoly.triggerAttackRelease(freq, atkLen, when, atkVel);
    }
  };


  // === Экспорт ===
  window.Synth = Synth;
})();
