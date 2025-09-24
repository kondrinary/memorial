// overlay.fx.js — ТОЛЬКО вспышка над активной цифрой (без шума/виньетки/backdrop-blur).
// Шлейф реализован через destination-out (прозрачное «выцветание»), поэтому слой не чернит фон.
//
// API:
//   OverlayFX.init({ rootEl?, blurPx?, blendMode?, trailAlpha? })
//   OverlayFX.pulseAtSpan(span)
//   OverlayFX.setPulseBlur(px)
//   OverlayFX.setBlend(mode)      // 'screen'|'lighter' обычно best
//   OverlayFX.setTrail(alpha)     // 0..1; 0 = без шлейфа

(function () {
  const CFG = {
    BLUR_PX: 6,          // размытие ТОЛЬКО у вспышки (px)
    TRAIL_ALPHA: 0.10,   // сила выцветания (0..1); 0 = чистый clearRect
    LIFE_MS: 480,        // длительность вспышки (мс)
    R0_FACTOR: 0.7,      // стартовый радиус (в долях от размера символа)
    R1_FACTOR: 3.6,      // конечный радиус
    BLEND_MODE: 'screen',// как смешивать канвас с фоном ('screen'/'lighter' — не темнят)
    COLORS: {
      inner: 'rgba(255,255,255,0.90)',
      mid:   'rgba(80,200,255,0.60)',
      outer: 'rgba(0,0,0,0.00)'
    }
  };

  const OverlayFX = {};
  let root, wrap, cvs, ctx;
  let pulses = [];
  let running = false;

  function ensureNodes() {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '10';
    // НИЧЕГО лишнего: нет background-активаторов, backdrop-filter и т.п.

    cvs = document.createElement('canvas');
    cvs.style.position = 'absolute';
    cvs.style.inset = '0';
    cvs.style.pointerEvents = 'none';
    cvs.style.mixBlendMode = CFG.BLEND_MODE; // влияет на то, как вспышка ляжет на цифры

    wrap.appendChild(cvs);
    // гарантируем контекст позиционирования
    root.style.position = root.style.position || 'relative';
    root.appendChild(wrap);

    ctx = cvs.getContext('2d');
  }

  function resize() {
    if (!root || !cvs) return;
    const r = root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.max(1, Math.round(r.width * dpr));
    cvs.height = Math.max(1, Math.round(r.height * dpr));
    cvs.style.width = r.width + 'px';
    cvs.style.height = r.height + 'px';
    // Рисуем в CSS-пикселях
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);

    const w = cvs.clientWidth, h = cvs.clientHeight;

    if (CFG.TRAIL_ALPHA <= 0) {
      // Полное очищение — без шлейфа.
      ctx.clearRect(0, 0, w, h);
    } else {
      // Правильный шлейф: делаем контент полупрозрачнее, а НЕ красим чёрным.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      // Альфа определяет, насколько быстро «выцветают» предыдущие пиксели.
      ctx.fillStyle = `rgba(0,0,0,${CFG.TRAIL_ALPHA})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    drawPulses();
  }

  function drawPulses() {
    const now = performance.now();
    pulses = pulses.filter(p => now - p.start < p.life);

    for (const p of pulses) {
      const k = (now - p.start) / p.life;   // 0..1
      const r = p.r0 + (p.r1 - p.r0) * k;
      const a = p.a0 * (1 - k);

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0.00, rgbaWithAlpha(CFG.COLORS.inner, a));
      grad.addColorStop(0.35, rgbaWithAlpha(CFG.COLORS.mid, a * 0.7));
      grad.addColorStop(1.00, CFG.COLORS.outer);

      ctx.save();
      ctx.filter = CFG.BLUR_PX > 0 ? `blur(${CFG.BLUR_PX}px)` : 'none'; // размытие ТОЛЬКО у вспышки
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Возвращаем стандартную композицию для следующих операций
    ctx.globalCompositeOperation = 'source-over';
  }

  function rgbaWithAlpha(col, alpha) {
    if (/rgba\(/i.test(col)) {
      return col.replace(/rgba\(([^)]+)\)/i, (_, inside) => {
        const parts = inside.split(',').map(s => s.trim());
        parts[3] = String(alpha);
        return `rgba(${parts.join(',')})`;
      });
    }
    if (/rgb\(/i.test(col)) {
      return col.replace(/rgb\(([^)]+)\)/i, (_, inside) => `rgba(${inside},${alpha})`);
    }
    return col;
  }

  // === Публичный API ===
  OverlayFX.init = function (opts = {}) {
    root = opts.rootEl || document.getElementById('stream');
    if (!root) return;

    if (typeof opts.blurPx === 'number')     CFG.BLUR_PX = Math.max(0, opts.blurPx|0);
    if (typeof opts.trailAlpha === 'number') CFG.TRAIL_ALPHA = Math.max(0, Math.min(1, opts.trailAlpha));
    if (typeof opts.blendMode === 'string')  CFG.BLEND_MODE = opts.blendMode;

    ensureNodes();
    cvs.style.mixBlendMode = CFG.BLEND_MODE;
    resize();

    pulses.length = 0;
    running = true;
    requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
  };

  OverlayFX.pulseAtSpan = function (span) {
    if (!span || !wrap) return;
    const rRoot = root.getBoundingClientRect();
    const r = span.getBoundingClientRect();
    const x = (r.left + r.right) * 0.5 - rRoot.left;
    const y = (r.top + r.bottom) * 0.5 - rRoot.top;
    const size = Math.max(r.width, r.height) || 12;

    pulses.push({
      x, y,
      start: performance.now(),
      life: CFG.LIFE_MS,
      r0: size * CFG.R0_FACTOR,
      r1: size * CFG.R1_FACTOR,
      a0: 1.0
    });
  };

  OverlayFX.setPulseBlur = (px)=> { CFG.BLUR_PX = Math.max(0, px|0); };
  OverlayFX.setBlend     = (m)=> { CFG.BLEND_MODE = m || 'screen'; if (cvs) cvs.style.mixBlendMode = CFG.BLEND_MODE; };
  OverlayFX.setTrail     = (a)=> { CFG.TRAIL_ALPHA = Math.max(0, Math.min(1, a)); };

  window.OverlayFX = OverlayFX;
})();
