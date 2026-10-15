/**
 * Non-blocking "rotate to portrait" banner (Req 1.6). Shown only on touch
 * devices held in landscape; the canvas keeps running underneath.
 */
export function installRotateHint(): void {
  if (typeof window === 'undefined') return;
  const el = document.getElementById('rotate-hint');
  if (!el) return;
  // Phones/tablets only: touch as the primary pointer and no hover. Touchscreen
  // laptops report maxTouchPoints > 0 but have a fine, hovering primary pointer.
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: none) and (pointer: coarse)') : null;
  const isHandheld = (): boolean => mq?.matches ?? false;

  const update = (): void => {
    const show = isHandheld() && window.innerWidth > window.innerHeight;
    el.classList.toggle('visible', show);
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
  };

  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
}
