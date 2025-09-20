// overlay.fx.js — прозрачный canvas-оверлей поверх #stream
(function () {
  const OverlayFX = {};
  let root, cvs, ctx, pulses = [], running = false, noiseAlpha = 0.06;

  function ensureCanvas() {
    if (cvs) return;
    cvs = document.createElement('canvas');
    cvs.style.position = 'absolute';
    cvs.style.inset = '0';
    cvs.style.pointerEvents = 'none';
    cvs.style.mixBlendMode = 'screen'; // мягкое смешивание поверх текста
    cvs.style.zIndex = '10';
    root.style.position = root.style.position || 'relative';
    root.appendChild(cvs);
    ctx = cvs.getContext('2d');
  }

  function resize() {
    if (!root) return;
    const r = root.getBoundingClientRect();
    // логический размер = CSS размер * DPR (чёткий рендер)
    const dpr = window.devicePixelRatio || 1;
    cvs.width  = Math.max(1, Math.round(r.width  * dpr));
    cvs.height = Math.max(1, Math.round(r.height * dpr));
    cvs.style.width  = r.width + 'px';
    cvs.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tick(t) {
    if (!running) return;
    requestAnimationFrame(tick);

    // очистка с лёгким затуханием (шлейф)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, cvs.width, cvs.height); // заполняем в device px — ок

    // рисуем пульсы
    const now = performance.now();
    pulses = pulses.filter(p => now - p.start < p.life);
    for (const p of pulses) {
      const k = (now - p.start) / p.life; // 0..1
      const r = p.r0 + (p.r1 - p.r0) * k;
      const a = p.a0 * (1 - k);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0.00, `rgba(180,255,200,${a})`);
      grad.addColorStop(0.35, `rgba(120,220,160,${a*0.6})`);
      grad.addColorStop(1.00, `rgba(0,0,0,0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();
    }

    // лёгкое зерно (равномерное, по кадру)
    const step = 4; // шаг сетки зерна
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = noiseAlpha;
    for (let y = 0; y < cvs.height; y += step) {
      for (let x = 0; x < cvs.width; x += step) {
        const v = 200 + ((Math.random() * 55) | 0); // 200..255
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  OverlayFX.init = function ({ rootEl, enableNoise = true } = {}) {
    root = rootEl || document.getElementById('stream');
    if (!root) return;
    ensureCanvas();
    resize();
    pulses.length = 0;
    running = true;
    noiseAlpha = enableNoise ? 0.06 : 0.0;
    requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
  };

  // Вызвать при подсветке цифры
  OverlayFX.pulseAtSpan = function (span) {
    if (!span || !cvs) return;
    const rRoot = root.getBoundingClientRect();
    const r = span.getBoundingClientRect();
    const x = (r.left + r.right) * 0.5 - rRoot.left;
    const y = (r.top  + r.bottom) * 0.5 - rRoot.top;
    pulses.push({
      x, y,
      start: performance.now(),
      life: 420, // мс жизни пульса
      r0: Math.max(r.width, r.height) * 0.6,
      r1: Math.max(r.width, r.height) * 3.5,
      a0: 0.70
    });
  };

  // Можно тонко подкрутить силу зерна
  OverlayFX.setNoise = function (alpha) {
    noiseAlpha = Math.max(0, Math.min(0.3, alpha));
  };

  window.OverlayFX = OverlayFX;
})();
