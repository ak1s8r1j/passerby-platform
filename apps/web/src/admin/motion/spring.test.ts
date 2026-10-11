import { describe, expect, it } from "vitest";
import {
  FLICK,
  isAtRest,
  project,
  releaseVelocity,
  rubberband,
  SMOOTH,
  SNAPPY,
  simulate,
  Spring,
  stepSpring,
} from "./spring.js";

describe("a spring with damping 1", () => {
  it("arrives without ever overshooting", () => {
    const { path } = simulate(0, 100, SMOOTH);
    expect(Math.max(...path)).toBeLessThanOrEqual(100.001);
    for (let i = 1; i < path.length; i++)
      expect(path[i]!).toBeGreaterThanOrEqual(path[i - 1]! - 1e-9);
  });

  it("arrives in a time that follows its response, and a smaller response is quicker", () => {
    const slow = simulate(0, 100, SMOOTH).seconds;
    const quick = simulate(0, 100, SNAPPY).seconds;
    expect(quick).toBeLessThan(slow);
    expect(slow).toBeGreaterThan(0.3);
    expect(slow).toBeLessThan(1.6);
  });

  it("ends exactly on target, at rest", () => {
    const { path } = simulate(0, 100, SMOOTH);
    expect(isAtRest({ value: path.at(-1)!, velocity: 0 }, 100)).toBe(true);
  });

  it("does not move at all if it starts at the target and at rest", () => {
    expect(simulate(50, 50, SMOOTH).path).toHaveLength(1);
  });
});

describe("a spring with damping below 1", () => {
  it("overshoots, then comes back", () => {
    const { path } = simulate(0, 100, FLICK);
    expect(Math.max(...path)).toBeGreaterThan(101);
    expect(path.at(-1)).toBeCloseTo(100, 0);
  });

  it("overshoots more when it is less damped", () => {
    const a = Math.max(...simulate(0, 100, { damping: 0.8, response: 0.35 }).path);
    const b = Math.max(...simulate(0, 100, { damping: 0.5, response: 0.35 }).path);
    expect(b).toBeGreaterThan(a);
  });
});

describe("velocity handoff", () => {
  it("carries on at the speed the gesture had, with no jump at the seam", () => {
    const speed = 600; // px/s, as when a finger lets go
    const dt = 1 / 120;
    const next = stepSpring({ value: 0, velocity: speed }, 100, SMOOTH, dt);
    // after one tiny step the position has moved by about speed*dt, not by a made-up amount
    expect(next.value).toBeGreaterThan(speed * dt * 0.8);
    expect(next.value).toBeLessThan(speed * dt * 1.5);
    expect(next.velocity).toBeGreaterThan(speed * 0.8);
  });

  it("takes a flick towards the target further and faster than one from rest", () => {
    const fromRest = simulate(0, 100, SMOOTH).path;
    const flicked = simulate(0, 100, SMOOTH, 1500).path;
    expect(flicked[5]!).toBeGreaterThan(fromRest[5]!);
  });

  it("slows and turns around smoothly when thrown away from its target", () => {
    const { path } = simulate(0, 100, SMOOTH, -800);
    expect(Math.min(...path)).toBeLessThan(0); // it first keeps going the way it was thrown
    expect(path.at(-1)).toBeCloseTo(100, 0); // then comes back
    // and every frame to frame change is small: no brick wall
    for (let i = 1; i < path.length; i++)
      expect(Math.abs(path[i]! - path[i - 1]!)).toBeLessThan(25);
  });
});

describe("projecting a flick", () => {
  it("is zero for no speed, grows with speed, and keeps the direction", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeGreaterThan(project(500));
    expect(project(-1000)).toBeCloseTo(-project(1000));
  });

  it("matches the exponential-decay formula Apple uses", () => {
    expect(project(1000)).toBeCloseTo((1 * 0.998) / (1 - 0.998), 6); // 499 px
    expect(project(1000, 0.99)).toBeCloseTo((1 * 0.99) / 0.01, 6); // 99 px: a snappier decay
  });
});

describe("rubber-banding", () => {
  it("is zero at the edge and follows the finger less and less beyond it", () => {
    expect(rubberband(0, 400)).toBe(0);
    const near = rubberband(40, 400);
    const far = rubberband(400, 400);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(40);
    expect(far).toBeLessThan(400);
    expect(far).toBeGreaterThan(near);
  });

  it("never reaches the size of the thing, however far it is pulled", () => {
    expect(rubberband(1_000_000, 400)).toBeLessThan(400 / 0.55 + 1);
    expect(rubberband(10_000, 400)).toBeLessThan(rubberband(1_000_000, 400));
  });

  it("is symmetrical for the other direction", () => {
    expect(rubberband(-80, 400)).toBeCloseTo(-rubberband(80, 400));
  });

  it("is safe when the size is nothing", () => {
    expect(rubberband(50, 0)).toBe(0);
  });
});

describe("release velocity", () => {
  it("is the speed over the last tenth of a second", () => {
    const now = 1000;
    const v = releaseVelocity(
      [
        { x: 0, t: 800 }, // too old to count
        { x: 100, t: 920 },
        { x: 150, t: 960 },
        { x: 200, t: 1000 },
      ],
      now,
    );
    expect(v).toBeCloseTo(1250, 0); // 100 px in 80 ms
  });

  it("is zero if the finger paused before letting go, or there is too little to tell", () => {
    expect(
      releaseVelocity(
        [
          { x: 0, t: 0 },
          { x: 300, t: 50 },
        ],
        1000,
      ),
    ).toBe(0);
    expect(releaseVelocity([{ x: 0, t: 990 }], 1000)).toBe(0);
    expect(releaseVelocity([], 1000)).toBe(0);
  });

  it("is negative for a drag the other way", () => {
    expect(
      releaseVelocity(
        [
          { x: 200, t: 950 },
          { x: 100, t: 1000 },
        ],
        1000,
      ),
    ).toBeLessThan(0);
  });
});

/** A hand-turned clock and frame loop, so the Spring class can be tested without a browser. */
function manualLoop() {
  let now = 0;
  let queue: FrameRequestCallback[] = [];
  return {
    frame: (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    },
    cancel: () => {
      queue = [];
    },
    clock: () => now,
    /** Advance by 1/60 s and run what was waiting for the next frame. */
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        now += 1000 / 60;
        const run = queue;
        queue = [];
        run.forEach((cb) => cb(now));
      }
    },
    /** Time passes with no frames, like a tab in the background. */
    skip(ms: number) {
      now += ms;
    },
    get waiting() {
      return queue.length;
    },
  };
}

describe("the Spring object", () => {
  const make = () => {
    const loop = manualLoop();
    const seen: number[] = [];
    const spring = new Spring(0, (v) => seen.push(v), loop.frame, loop.cancel, loop.clock);
    return { loop, seen, spring };
  };

  it("runs to its target, reports every value, tells when it is done, and then stops asking for frames", () => {
    const { loop, seen, spring } = make();
    let done = 0;
    spring.to(100, { onDone: () => done++ });
    loop.tick(120);
    expect(seen.at(-1)).toBe(100);
    expect(spring.value).toBe(100);
    expect(spring.velocity).toBe(0);
    expect(done).toBe(1);
    expect(spring.moving).toBe(false);
    expect(loop.waiting).toBe(0);
  });

  it("can be redirected mid-flight and carries on from where it is, with its speed, never jumping", () => {
    const { loop, seen, spring } = make();
    spring.to(100);
    loop.tick(8);
    const here = spring.value;
    const speed = spring.velocity;
    expect(here).toBeGreaterThan(0);
    expect(here).toBeLessThan(100);
    expect(speed).toBeGreaterThan(0);
    spring.to(0); // changed its mind
    loop.tick(1);
    expect(Math.abs(seen.at(-1)! - here)).toBeLessThan(15); // continuous: no jump
    expect(spring.velocity).toBeLessThan(speed); // it is slowing down to turn around
    loop.tick(200);
    expect(spring.value).toBe(0);
  });

  it("can be grabbed: stops dead and reports the grab point, without running its callback", () => {
    const { loop, seen, spring } = make();
    let done = 0;
    spring.to(100, { onDone: () => done++ });
    loop.tick(6);
    spring.set(42);
    loop.tick(30);
    expect(spring.value).toBe(42);
    expect(seen.at(-1)).toBe(42);
    expect(done).toBe(0);
    expect(spring.moving).toBe(false);
  });

  it("can be released with a speed from a gesture", () => {
    const { loop, spring } = make();
    spring.set(0);
    spring.to(100, { velocity: 2000 });
    loop.tick(1);
    expect(spring.value).toBeGreaterThan(20); // a flick covers real ground in the first frame
  });

  it("never leaps after the tab was in the background", () => {
    const { loop, spring } = make();
    spring.to(100, { config: { damping: 1, response: 5 } }); // slow, so a leap would be obvious
    loop.tick(1);
    const before = spring.value;
    loop.skip(10_000); // ten seconds with no frames
    loop.tick(1);
    // it moved by about a tenth of a second's worth, not ten seconds' worth (which would be all the way)
    expect(spring.value - before).toBeLessThan(5);
  });
});
