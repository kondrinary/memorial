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

  // один элемент (пара дат) -> фрагмент и массив цифр
  function renderPairToFragment(item){
    const bStr = item.birth.slice(0,2)+'.'+item.birth.slice(2,4)+'.'+item.birth.slice(4);
    const dStr = item.death.slice(0,2)+'.'+item.death.slice(2,4)+'.'+item.death.slice(4);
    const text = `${bStr}.${dStr}.`;

    const frag  = document.createDocumentFragment();
    const spans = [];
    for (const ch of text){
      const s = document.createElement('span');
      s.textContent = ch;
      if (/\d/.test(ch)) s.classList.add('digit');
      frag.appendChild(s);
      spans.push(s);
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
