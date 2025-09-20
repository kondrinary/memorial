// overlay.fx.js — canvas + backdrop-blur поверх #stream
(function () {
  const OverlayFX = {};
  let root, wrap, cvs, ctx, pulses = [], running = false;

  let opts = { noiseAlpha: 0.10, scanlines: false, blurPx: 3, blend: 'overlay', vignette: 0.12 };

  function ensureNodes() {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '10';
    wrap.style.background = 'rgba(0,0,0,0.001)'; // активирует backdrop-filter
    wrap.style.backdropFilter = `blur(${opts.blurPx}px)`;
    wrap.style.webkitBackdropFilter = `blur(${opts.blurPx}px)`;

    cvs = document.createElement('canvas');
    cvs.style.position = 'absolute';
    cvs.style.inset = '0';
    cvs.style.pointerEvents = 'none';
    cvs.style.mixBlendMode = opts.blend;

    wrap.appendChild(cvs);
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawNoise() {
    if (opts.noiseAlpha <= 0) return;
    const step = 3;
    ctx.globalAlpha = opts.noiseAlpha;
    for (let y = 0; y < cvs.clientHeight; y += step) {
      for (let x = 0; x < cvs.clientWidth; x += step) {
        const v = 200 + ((Math.random() * 55) | 0);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    if (opts.vignette <= 0) return;
    const w = cvs.clientWidth, h = cvs.clientHeight;
    const g = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.35, w/2, h/2, Math.max(w,h)*0.75);
    const a = 0.45 * opts.vignette;
    g.addColorStop(0.0, `rgba(0,0,0,0)`);
    g.addColorStop(1.0, `rgba(0,0,0,${a})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPulses() {
    const now = performance.now();
    pulses = pulses.filter(p => now - p.start < p.life);
    for (const p of pulses) {
      const k = (now - p.start) / p.life;
      const r = p.r0 + (p.r1 - p.r0) * k;
      const a = p.a0 * (1 - k);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0.00, `rgba(180,255,200,${a})`);
      grad.addColorStop(0.35, `rgba(120,220,255,${a*0.6})`);
      grad.addColorStop(1.00, `rgba(0,0,0,0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; // шлейф
    ctx.fillRect(0, 0, cvs.clientWidth, cvs.clientHeight);
    drawPulses();
    drawNoise();
    drawVignette();
  }

  OverlayFX.init = function ({ rootEl, enableNoise = true, blurPx = 3, blend = 'overlay', scanlines = false, vignette = 0.12 } = {}) {
    root = rootEl || document.getElementById('stream');
    if (!root) return;
    Object.assign(opts, { noiseAlpha: enableNoise ? 0.10 : 0.0, blurPx, blend, scanlines, vignette });
    ensureNodes();
    wrap.style.backdropFilter = `blur(${opts.blurPx}px)`;
    wrap.style.webkitBackdropFilter = `blur(${opts.blurPx}px)`;
    cvs.style.mixBlendMode = opts.blend;
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
    const size = Math.max(r.width, r.height);
    pulses.push({ x, y, start: performance.now(), life: 480, r0: size * 0.6, r1: size * 3.8, a0: 0.75 });
  };

  OverlayFX.setBlur  = (px)=> { opts.blurPx = Math.max(0, px|0); wrap && (wrap.style.backdropFilter = wrap.style.webkitBackdropFilter = `blur(${opts.blurPx}px)`); };
  OverlayFX.setNoise = (a)=> { opts.noiseAlpha = Math.max(0, Math.min(0.3, a)); };
  OverlayFX.setBlend = (m)=> { opts.blend = m || 'overlay'; if (cvs) cvs.style.mixBlendMode = opts.blend; };
  OverlayFX.setVignette = (v)=> { opts.vignette = Math.max(0, Math.min(1, v)); };

  window.OverlayFX = OverlayFX;
})();
