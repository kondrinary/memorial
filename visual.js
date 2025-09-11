// visual.js — ДЕЛАЕМ ОДИНАКОВЫЙ ПОРЯДОК У ВСЕХ КЛИЕНТОВ
// 1) Всегда строим таймлайн ЦЕЛИКОМ из активного списка (без append)
// 2) Жёстко сортируем: (ts ASC, id ASC)
// 3) Рендерим заново, чтобы Player получил одинаковую последовательность

(function () {
  const Visual = {};
  const $root = document.getElementById('timeline') || document.body;
  const DEBUG = false;

  // Текущий плоский TL: [{id, digit, freq, ts, span}]
  Visual.timeline = [];

  // Простая мапа цифры в частоту (стабильно и детерминированно)
  function toFreq(d) {
    const base = 110;            // A2
    const step = Math.pow(2, 1/12);
    return base * Math.pow(step, (d|0));
  }

  // Жёсткая стабсортировка: (ts ASC, id ASC)
  function sortStable(list) {
    return list.slice().sort((a, b) => {
      const ta = (a.ts || 0), tb = (b.ts || 0);
      if (ta !== tb) return ta - tb;
      const ia = String(a.id || ''), ib = String(b.id || '');
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
  }

  // Полная перерисовка DOM — один источник истины
  function renderTimeline(list) {
    while ($root.firstChild) $root.removeChild($root.firstChild);
    const frag = document.createDocumentFragment();
    for (const item of list) {
      const span = document.createElement('span');
      span.className = 'digit';
      span.textContent = String(item.digit);
      item.span = span;                 // привязываем DOM-узел к элементу TL
      frag.appendChild(span);
    }
    $root.appendChild(frag);
  }

  // Главная точка: строим плоский TL из активных записей Data
  Visual.build = function (activeList) {
    // activeList: [{id, digits:[...], ts}, ...]
    const flat = [];
    for (const rec of activeList) {
      const digits = rec.digits || [];
      for (let i = 0; i < digits.length; i++) {
        const d = digits[i];
        flat.push({
          // Делаем уникальный и детерминированный локальный id
          id: rec.id + ':' + i,
          digit: d,
          freq: toFreq(d),
          ts: rec.ts
        });
      }
    }

    const ordered = sortStable(flat);
    Visual.timeline = ordered;
    renderTimeline(ordered);

    if (DEBUG) console.log('[Visual.build] size=', ordered.length, ordered.slice(0, 5));
  };

  // Снимок без мутации (Player читает отсюда)
  Visual.getTimelineSnapshot = function () {
    return Visual.timeline.map(x => ({
      id: x.id, digit: x.digit, freq: x.freq, ts: x.ts, span: x.span
    }));
  };

  window.Visual = Visual;
})();
