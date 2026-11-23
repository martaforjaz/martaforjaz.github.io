(() => {
  const canvas = document.querySelector('.hero-particles');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width, height, points, frame;
  let pointer = null;

  window.addEventListener('pointermove', (event) => {
    if (motion.matches || event.pointerType === 'touch') return;
    const bounds = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; });
  window.addEventListener('blur', () => { pointer = null; });

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    points = Array.from({ length: Math.min(125, Math.max(32, Math.round(width * height / 8500))) }, (_, index) => ({
      x: Math.random() * width, y: Math.random() * height,
      dx: (Math.random() - .5) * 1.1, dy: (Math.random() - .5) * 1.1,
      color: index % 5 ? '#448e8b' : '#687fa5',
    }));
    restart();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    points.forEach((point, index) => {
      context.globalAlpha = .5;
      context.fillStyle = point.color;
      context.beginPath();
      context.arc(point.x, point.y, 2, 0, Math.PI * 2);
      context.fill();
      for (let next = index + 1; next < points.length; next++) {
        const other = points[next];
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (distance > 110) continue;
        context.globalAlpha = .25 * (1 - distance / 110);
        context.strokeStyle = point.color;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(other.x, other.y);
        context.stroke();
      }
      if (!motion.matches && !document.hidden) {
        let pushX = 0;
        let pushY = 0;
        if (pointer) {
          const x = point.x - pointer.x;
          const y = point.y - pointer.y;
          const distance = Math.hypot(x, y);
          if (distance > 0 && distance < 125) {
            const push = (1 - distance / 125) * 4;
            pushX = x / distance * push;
            pushY = y / distance * push;
          }
        }
        point.x = (point.x + point.dx + pushX + width) % width;
        point.y = (point.y + point.dy + pushY + height) % height;
      }
    });
    if (!motion.matches && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function restart() {
    cancelAnimationFrame(frame);
    if (width && height) draw();
  }

  new ResizeObserver(resize).observe(canvas);
  motion.addEventListener('change', restart);
  document.addEventListener('visibilitychange', restart);
})();
