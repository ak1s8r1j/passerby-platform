/**
 * Spring motion, the way Apple describes it: two numbers a designer can think about.
 *  - `damping` is the damping ratio. 1 settles smoothly with no overshoot; below 1 it overshoots and wobbles.
 *  - `response` is how quickly it gets there, in seconds. It is not a duration: a spring has no fixed length.
 *
 * Because a spring is a rule about where to go rather than a script, it can be interrupted at any moment: the
 * next move starts from the value and velocity it has right now, so there is never a jump or a stop.
 */
export interface SpringConfig {
  damping: number;
  response: number;
}

/** Calm and exact. The default: nothing here has momentum, so nothing overshoots. */
export const SMOOTH: SpringConfig = { damping: 1, response: 0.4 };
/** A touch quicker, for small things that should feel instant. */
export const SNAPPY: SpringConfig = { damping: 1, response: 0.28 };
/** Slight overshoot, only for motion that carries a thrown or released gesture. */
export const FLICK: SpringConfig = { damping: 0.8, response: 0.35 };

export interface SpringState {
  value: number;
  velocity: number;
}

/** Stiffness of a unit-mass spring with this response time. */
const stiffness = (response: number) => (2 * Math.PI) ** 2 / (response * response);

const MAX_STEP = 1 / 240;

/** Moves a spring forward by `dt` seconds towards `target`. Small internal steps keep it stable. */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const k = stiffness(config.response);
  const c = 2 * config.damping * Math.sqrt(k);
  let { value, velocity } = state;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(left, MAX_STEP);
    // Semi-implicit Euler: update the velocity first, then the position with the new velocity.
    velocity += (-k * (value - target) - c * velocity) * h;
    value += velocity * h;
    left -= h;
  }
  return { value, velocity };
}

/** Close enough to stop: the picture can't show anything smaller than this. */
export const REST_DISTANCE = 0.05;
export const REST_SPEED = 0.5;
export const isAtRest = (s: SpringState, target: number) =>
  Math.abs(s.value - target) < REST_DISTANCE && Math.abs(s.velocity) < REST_SPEED;

/**
 * Where a spring would be at each frame, for tests and for planning. Returns the path and how long it
 * took to settle.
 */
export function simulate(
  from: number,
  to: number,
  config: SpringConfig,
  velocity = 0,
  fps = 60,
  maxSeconds = 5,
): { path: number[]; seconds: number } {
  let s: SpringState = { value: from, velocity };
  const path = [s.value];
  const dt = 1 / fps;
  let t = 0;
  while (t < maxSeconds && !isAtRest(s, to)) {
    s = stepSpring(s, to, config, dt);
    path.push(s.value);
    t += dt;
  }
  return { path, seconds: t };
}

/**
 * Where a flick would come to rest if it were left to slow down like scrolling does, given its release
 * speed in pixels per second. Pick the destination from this, not from where the finger lifted, and a
 * quick flick throws the thing while a slow drag that stops short lets it fall back.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Resistance at an edge. The further past the limit, the less the thing follows the finger, so it feels
 * like stretching rather than hitting a wall. `dimension` is the size of the thing being dragged.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const sign = Math.sign(overshoot);
  const d = Math.abs(overshoot);
  return (sign * (d * dimension * constant)) / (dimension + constant * d);
}

/**
 * The speed of a drag in pixels per second, from the last few pointer samples. Only recent samples count,
 * so pausing before letting go means letting go at rest.
 */
export function releaseVelocity(
  samples: { x: number; t: number }[],
  now: number,
  windowMs = 100,
): number {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

type Frame = (cb: FrameRequestCallback) => number;

/**
 * One number driven by a spring. `to()` can be called at any time, even while it is moving: it carries on from
 * the current value and speed. `set()` grabs it (for dragging), stopping the motion where it is.
 */
export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private config: SpringConfig = SMOOTH;
  private raf: number | null = null;
  private last = 0;
  private done: (() => void) | null = null;

  constructor(
    initial: number,
    private onUpdate: (value: number) => void,
    private frame: Frame = (cb) => requestAnimationFrame(cb),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
    private clock: () => number = () => performance.now(),
  ) {
    this.value = initial;
    this.target = initial;
  }

  get moving() {
    return this.raf !== null;
  }

  /** Head for `target`. An optional starting speed makes the motion carry on from a gesture. */
  to(
    target: number,
    options: { config?: SpringConfig; velocity?: number; onDone?: () => void } = {},
  ): void {
    this.target = target;
    this.config = options.config ?? SMOOTH;
    if (options.velocity !== undefined) this.velocity = options.velocity;
    this.done = options.onDone ?? null;
    if (this.raf === null) {
      this.last = this.clock();
      this.raf = this.frame(this.tick);
    }
  }

  /** Take hold of it at `value`, wherever it was heading. */
  set(value: number, velocity = 0): void {
    this.stop();
    this.value = value;
    this.velocity = velocity;
    this.target = value;
    this.onUpdate(value);
  }

  /** Stop where it is. Its value and speed stay readable, ready for the next move. */
  stop(): void {
    if (this.raf !== null) this.cancel(this.raf);
    this.raf = null;
    this.done = null;
  }

  private tick = () => {
    const now = this.clock();
    // A tab that was in the background can return after seconds: never leap more than a tenth of one.
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const next = stepSpring(
      { value: this.value, velocity: this.velocity },
      this.target,
      this.config,
      dt,
    );
    if (isAtRest(next, this.target)) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = null;
      this.onUpdate(this.value);
      const done = this.done;
      this.done = null;
      done?.();
      return;
    }
    this.value = next.value;
    this.velocity = next.velocity;
    this.onUpdate(this.value);
    this.raf = this.frame(this.tick);
  };
}

/** Does the visitor want less motion? Without matchMedia (tests, old browsers) the answer is "no". */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
