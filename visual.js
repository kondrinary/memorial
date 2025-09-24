// visual.js — поток дат, синхронизированный с Player (без автопрокрутки)
(function(){
  const Visual = {};
  Visual.timeline = [];
  Visual.knownIds = new Set();

  let stream = null; // контейнер для текста справа (#stream)

  // === перевод цифры 0..9 -> частота ===
  function digitToFreq(d){
    const { FREQ_MIN, FREQ_MAX, PITCH_MODE } = AppConfig;
    if (PITCH_MODE === 'geometric') {
      const ratio = FREQ_MAX / FREQ_MIN;
      return FREQ_MIN * Math.pow(ratio, d / 9);
    }
    const step = (FREQ_MAX - FREQ_MIN) / 9;
    return FREQ_MIN + d * step;
  }

// === хелперы для детерминированного «случая» по id записи и индексу символа
function hash32(str){
  let h = 2166136261 >>> 0;
  for (let i=0; i<str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rand01(seed){
  // xorshift32
  let x = seed >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return (x >>> 0) / 4294967295;
}
function applyRandomGap(span, ch, itemId, charIndex){
  const S = (window.AppConfig && AppConfig.STREAM_SPACING) || {};
  if (!S.ENABLED) return;
  const apply = (S.APPLY_TO === 'all') || (/\d|\./.test(ch));
  if (!apply) return;

  const min = Number(S.MIN_CH ?? 0), max = Number(S.MAX_CH ?? 0);
  if (!(max > min)) return;

  const seed = hash32(itemId + ':' + charIndex);
  const rnd = rand01(seed);
  const gap = min + (max - min) * rnd;
  span.style.marginRight = gap.toFixed(3) + 'ch';
}

// === перевод цифры 0..9 -> частота (без изменений)
function digitToFreq(d){
  const { FREQ_MIN, FREQ_MAX, PITCH_MODE } = AppConfig;
  if (PITCH_MODE === 'geometric') {
    const ratio = FREQ_MAX / FREQ_MIN;
    return FREQ_MIN * Math.pow(ratio, d / 9);
  }
  const step = (FREQ_MAX - FREQ_MIN) / 9;
  return FREQ_MIN + d * step;
}

// === ОДИН ЭЛЕМЕНТ (пара дат) -> фрагмент и массив цифр (обновлено)
function renderPairToFragment(item){
  const bStr = item.birth.slice(0,2)+'.'+item.birth.slice(2,4)+'.'+item.birth.slice(4);
  const dStr = item.death.slice(0,2)+'.'+item.death.slice(2,4)+'.'+item.death.slice(4);
  const text = `${bStr}.${dStr}.`;

  const frag  = document.createDocumentFragment();
  const spans = [];
  let i = 0;
  for (const ch of text){
    const s = document.createElement('span');
    s.textContent = ch;
    if (/\d/.test(ch)) s.classList.add('digit');
    applyRandomGap(s, ch, item.id, i++);  // ← случайный CSS-отступ в ch
    frag.appendChild(s);
    spans.push(s);
  }

  // Перенос строки после пары, если включено
  const SP = (window.AppConfig && AppConfig.STREAM_SPACING) || {};
  if (SP.NEWLINE_AFTER_PAIR) {
    frag.appendChild(document.createElement('br'));
  }

  const digitsOnly = (item.birth + item.death).split('').map(Number);
  return { frag, spans, text, digitsOnly };
}


  // Полная отстройка (первый снимок базы)
  Visual.build = function(list){
    if (!stream) stream = document.getElementById('stream');
    if (!stream) return;

    stream.innerHTML = '';
    Visual.timeline = [];
    Visual.knownIds.clear();

    // прямой порядок: старые → новые
    list.forEach(item=>{
      Visual.knownIds.add(item.id);

      const { frag, spans, text, digitsOnly } = renderPairToFragment(item);
      stream.appendChild(frag); // визуально — в конец

      // в таймлайн — только цифры в том же порядке
      let di = 0;
      for (let i=0;i<text.length;i++){
        const ch = text[i];
        if (/\d/.test(ch)){
          const d = digitsOnly[di];
          const isLast = (di === digitsOnly.length - 1); // конец пары
          Visual.timeline.push({
            digit: d,
            freq: digitToFreq(d),
            span: spans[i],
            pairEnd: isLast
          });
          di++;
        }
      }
    });

    if (window.Player && typeof Player.onTimelineChanged === 'function') {
      Player.onTimelineChanged();
    }
  };

  // Дозагрузка новых записей (последующие снапшоты)
  Visual.append = function(list){
    if (!stream) stream = document.getElementById('stream');
    if (!stream) return;

    let changed = false;

    list.forEach(item=>{
      if (Visual.knownIds.has(item.id)) return;
      Visual.knownIds.add(item.id);
      changed = true;

      const { frag, spans, text, digitsOnly } = renderPairToFragment(item);
      stream.appendChild(frag);

      let di = 0;
      for (let i=0;i<text.length;i++){
        const ch = text[i];
        if (/\d/.test(ch)){
          const d = digitsOnly[di];
          const isLast = (di === digitsOnly.length - 1);
          Visual.timeline.push({
            digit: d,
            freq: digitToFreq(d),
            span: spans[i],
            pairEnd: isLast
          });
          di++;
        }
      }
    });

    if (changed && window.Player && typeof Player.onTimelineChanged === 'function') {
      Player.onTimelineChanged();
    }
  };

  let _lastActiveIndex = -1;
  Visual.setActiveIndex = function(idx){
    if (!Visual.timeline || !Visual.timeline.length) return;
    if (_lastActiveIndex === idx) return;

    if (_lastActiveIndex >= 0){
      const prev = Visual.timeline[_lastActiveIndex];
      if (prev && prev.span) prev.span.classList.remove('active');
    }
    const cur = Visual.timeline[idx];
    if (cur && cur.span) cur.span.classList.add('active');

    _lastActiveIndex = idx;
  };

  // Вернёт «снимок» текущего таймлайна (чтобы Player держал активную копию)
  Visual.getTimelineSnapshot = function(){
    const tl = Visual.timeline || [];
    return tl.map(x => ({ digit:x.digit, freq:x.freq, span:x.span, pairEnd:x.pairEnd }));
  };

  window.Visual = Visual;
})();
