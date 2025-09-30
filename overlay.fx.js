// overlay.fx.js — инвертирующая подсветка активной строки (mix-blend-mode:difference)
// Минимализм: 1 div, без канваса/фильтров. Слой ВСЕГДА поверх цифр.
// API: 
//   OverlayFX.init({ rootEl?, heightFactor? })
//   OverlayFX.pulseAtSpan(span)
//   OverlayFX.setHeightFactor(k)
//
// Примечание: инверсия работает внутри контейнера, поэтому задаём isolation:isolate.

(function () {
  const CFG = {
    H_FACTOR: 1.22,   // высота бара в долях высоты строки
    SNAP_EPS: 0.45    // не двигаем бар, если смещение меньше этой доли высоты строки
  };

  let root, wrap, bar;
  let lastTop = null, lastH = null;

  function ensureNodes() {
    if (wrap) return;

    wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '10'
    });

    bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      height: '0px',
      transform: 'translateY(0)',
      transition: 'transform 140ms ease-out, height 140ms ease-out',
      willChange: 'transform,height',
      background: '#ffffff3b',
      mixBlendMode: 'difference'
    });

    wrap.appendChild(bar);

    // гарантируем контекст позиционирования и ограничим область смешения
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    root.style.isolation = 'isolate';

    root.appendChild(wrap);
    window.addEventListener('resize', () => reposition());
  }

  function relTop(rect, rootRect) {
    return rect.top - rootRect.top;
  }

  function reposition(top = lastTop, h = lastH) {
    if (top == null || h == null) return;
    const pad = (h * (CFG.H_FACTOR - 1)) / 2;
    const y = Math.round(top - pad);
    const HH = Math.round(h * CFG.H_FACTOR);
    bar.style.height = HH + 'px';
    bar.style.transform = `translateY(${y}px)`;
  }

  const OverlayFX = {};

  OverlayFX.init = function (opts = {}) {
    root = opts.rootEl || document.getElementById('stream');
    if (!root) return;
    if (typeof opts.heightFactor === 'number') {
      CFG.H_FACTOR = Math.max(1, opts.heightFactor);
    }
    ensureNodes();
    lastTop = lastH = null;
  };

  OverlayFX.pulseAtSpan = function (span) {
    if (!span || !root) return;
    const rr = root.getBoundingClientRect();
    const r  = span.getBoundingClientRect();
    const top = relTop(r, rr);
    const h   = r.height || 12;

    // двигаем только при смене строки
    if (lastTop != null && Math.abs(top - lastTop) < h * CFG.SNAP_EPS) return;

    lastTop = top;
    lastH   = h;
    reposition(top, h);
  };

  OverlayFX.setHeightFactor = (k) => {
    CFG.H_FACTOR = Math.max(1, k || CFG.H_FACTOR);
    reposition();
  };

  window.OverlayFX = OverlayFX;
})();
