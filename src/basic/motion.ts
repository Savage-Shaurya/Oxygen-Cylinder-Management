// Motion explains what happened; it never carries meaning alone. With reduced motion,
// in tests (no matchMedia) or on browsers without animation frames, nothing moves and
// every element simply shows its final state. Anime.js loads only when motion is allowed.
type Anime = typeof import('animejs');
let loading: Promise<Anime> | undefined;
const anime = () => (loading ??= import('animejs'));

export function preloadMotion() {
  if (motionAllowed()) void anime().catch(() => undefined);
}

/** Runs an animation once the library is ready; pause() also cancels one not started yet. */
function later(start: (lib: Anime) => { pause: () => unknown } | void): Stoppable {
  let stopped = false;
  let handle: { pause: () => unknown } | void;
  anime()
    .then((lib) => {
      if (!stopped) handle = start(lib);
    })
    .catch(() => undefined);
  return {
    pause() {
      stopped = true;
      handle?.pause();
    },
  };
}

type Stoppable = { pause: () => void };
const none: Stoppable = { pause() {} };

export function motionAllowed(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      typeof window.requestAnimationFrame === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** Big home tiles rise in one after another. */
export function tilesIn(targets: Element[]) {
  if (!motionAllowed() || !targets.length) return;
  later(({ animate, stagger }) =>
    animate(targets, {
      opacity: [0, 1],
      y: [28, 0],
      scale: [0.94, 1],
      duration: 420,
      delay: stagger(70),
      ease: 'out(3)',
    }),
  );
}

/** The success tick draws itself while its circle pops. */
export function drawTick(circle: Element | null, path: SVGPathElement | null) {
  if (!motionAllowed() || !path) return;
  later(({ animate, createDrawable, spring }) => {
    const [drawable] = createDrawable(path);
    animate(drawable, { draw: ['0 0', '0 1'], duration: 520, delay: 120, ease: 'out(3)' });
    if (circle)
      animate(circle, {
        scale: [0.4, 1],
        opacity: [0, 1],
        duration: 620,
        ease: spring({ bounce: 0.45, duration: 620 }),
      });
  });
}

/** A "no" shake for the red cross card. */
export function shake(target: Element | null) {
  if (!motionAllowed() || !target) return;
  later(({ animate }) =>
    animate(target, { x: [0, -14, 14, -9, 9, -4, 0], duration: 460, ease: 'inOut(2)' }),
  );
}

/** A counted dot fills with a little bounce. */
export function popDot(target: Element | null) {
  if (!motionAllowed() || !target) return;
  later(({ animate }) => animate(target, { scale: [0.3, 1.25, 1], duration: 420, ease: 'out(3)' }));
}

/** The undo ring empties over the waiting time. */
export function emptyRing(ring: SVGCircleElement | null, ms: number): Stoppable {
  if (!motionAllowed() || !ring) return none;
  return later(({ animate, createDrawable }) => {
    const [drawable] = createDrawable(ring);
    return animate(drawable, { draw: ['0 1', '0 0'], duration: ms, ease: 'linear' });
  });
}

/** The scan frame corners breathe to say "point here". */
export function breathe(targets: Element[]): Stoppable {
  if (!motionAllowed() || !targets.length) return none;
  return later(({ animate }) =>
    animate(targets, {
      scale: [1, 1.06],
      opacity: [1, 0.65],
      duration: 1100,
      ease: 'inOutSine',
      loop: true,
      alternate: true,
    }),
  );
}

/** A number rolls up to its value. */
export function countUp(target: HTMLElement | null, to: number) {
  if (!target) return;
  if (!motionAllowed() || to <= 0) {
    target.textContent = String(to);
    return;
  }
  const value = { n: 0 };
  target.textContent = '0';
  later(({ animate, utils }) =>
    animate(value, {
      n: to,
      duration: 700,
      ease: 'out(3)',
      modifier: utils.round(0),
      onUpdate: () => {
        target.textContent = String(value.n);
      },
      onComplete: () => {
        target.textContent = String(to);
      },
    }),
  );
}

/** A pointing hand taps a tile twice to teach the first move. */
export function pointAt(hand: Element | null): Stoppable {
  if (!motionAllowed() || !hand) return none;
  return later(({ animate }) =>
    animate(hand, {
      keyframes: [
        { opacity: 1, duration: 200 },
        { y: -14, scale: 1, duration: 300 },
        { y: 0, scale: 0.86, duration: 200 },
        { y: -14, scale: 1, duration: 250 },
        { y: 0, scale: 0.86, duration: 200 },
        { y: -8, scale: 1, duration: 250 },
      ],
      ease: 'inOut(2)',
      loop: 2,
    }),
  );
}

/** A short press bounce on big buttons. */
export function press(target: Element | null) {
  if (!motionAllowed() || !target) return;
  later(({ animate }) => animate(target, { scale: [1, 0.94, 1], duration: 260, ease: 'out(2)' }));
}
