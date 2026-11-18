// Virtual clock for the cinema: pause, speed and cancellation in one place.
// Everything the script awaits (wait, tween) runs on this clock, so pausing
// freezes the whole show mid-frame and a replay cleanly aborts the old run.

export class Cancelled extends Error {
  constructor() { super("cancelled"); this.name = "Cancelled"; }
}

export function createPlayer({ onTick } = {}) {
  let vt = 0;            // virtual ms
  let last = performance.now();
  let speed = 1;
  let paused = false;
  let run = 0;           // bumps on cancel; stale awaits reject
  const jobs = new Set(); // { run, step(vt) → done? , reject }

  function frame(now) {
    // Slow frames still advance at real speed (the film keeps its length);
    // only a long gap — a tab coming back from the background — is clipped.
    const dt = Math.min(250, now - last);
    last = now;
    if (!paused) vt += dt * speed;
    for (const job of [...jobs]) {
      if (job.run !== run) { jobs.delete(job); job.reject(new Cancelled()); continue; }
      if (!paused && job.step(vt)) jobs.delete(job);
    }
    onTick?.(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function schedule(step) {
    const mine = run;
    return new Promise((resolve, reject) => {
      jobs.add({ run: mine, reject, step: (t) => { const r = step(t); if (r) resolve(); return r; } });
    });
  }

  return {
    get speed() { return speed; },
    set speed(v) { speed = Math.max(0.25, Number(v) || 1); },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
    get now() { return vt; },

    /** Abort everything the current script is awaiting. */
    cancel() { run++; paused = false; },
    /** Throw if a newer run started — for sync checkpoints between awaits. */
    check(token) { if (token !== run) throw new Cancelled(); },
    get token() { return run; },

    wait(ms) {
      const end = vt + ms;
      return schedule((t) => t >= end);
    },

    /** onUpdate(p ∈ [0,1]) every frame for `ms` virtual milliseconds. */
    tween(ms, onUpdate) {
      const start = vt;
      onUpdate(0);
      if (ms <= 0) { onUpdate(1); return Promise.resolve(); }
      return schedule((t) => {
        const p = Math.min(1, (t - start) / ms);
        onUpdate(p);
        return p >= 1;
      });
    },
  };
}
