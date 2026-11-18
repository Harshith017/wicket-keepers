// Flight timing: release and bat-contact moments between frames.
// Real deliveries (true physics) are sampled at 60 fps and 240 fps (slow motion) with a random
// frame phase; the flight time from the frames is compared with the true one.
import { measureDelivery, contactTime, frameInterval } from '../js/bowling.js';
import { generateDelivery } from '../js/sim.js';

export function timingChecks(check, rnd) {
  const L = 20.12;
  const stats = (a) => { const s = a.slice().sort((x, y) => x - y); return { mean: a.reduce((x, y) => x + y, 0) / a.length, med: s[s.length >> 1] }; };
  for (const fps of [60, 240]) {
    const oldErr = [], newErr = [], oldAbs = [], newAbs = [];
    for (let i = 0; i < 300; i++) {
      const d = generateDelivery(L, rnd, { play: true });
      const tHit = d.truth.shot.t;                 // true contact; release is at t = 0
      const obs = [];
      // seen clear from the first frame after release until the last frame before contact
      for (let t = rnd() / fps; t < tHit; t += 1 / fps) obs.push({ t, u: 0, v: 0 });
      if (obs.length < 6) continue;
      const m = measureDelivery(obs, null, L, 'R');
      const oldT = (obs[obs.length - 1].t) - (obs[0].t - 1 / 120);
      oldErr.push((oldT - tHit) * 1000); oldAbs.push(Math.abs(oldT - tHit) * 1000);
      newErr.push((m.tArrive - m.tRelease - tHit) * 1000); newAbs.push(Math.abs(m.tArrive - m.tRelease - tHit) * 1000);
    }
    const o = stats(oldErr), n = stats(newErr), oa = stats(oldAbs), na = stats(newAbs);
    console.log(`   [${fps} fps] flight-time bias ms: before ${o.mean.toFixed(1)}, now ${n.mean.toFixed(1)} | median abs error ms: before ${oa.med.toFixed(1)}, now ${na.med.toFixed(1)}`);
    check(`[${fps} fps] flight time has no bias`, Math.abs(n.mean) < 0.15 * 1000 / fps, `${n.mean.toFixed(2)} ms`);
    check(`[${fps} fps] flight time no worse than before`, na.med <= oa.med + 0.05);
  }
  check('frame interval ignores a missed frame', Math.abs(frameInterval([0, 1, 2, 4, 5, 6].map((k) => ({ t: k / 240 }))) - 1 / 240) < 1e-9);

  // Contact between frames, from the paths in and out in the picture.
  const errMid = [], errFit = [];
  for (let i = 0; i < 500; i++) {
    const dt = 1 / 60, tc = 0.2 + rnd() * dt;                   // contact somewhere inside a frame gap
    const a = [(rnd() - 0.5) * 200, 300 + rnd() * 600];          // px/s on the way in
    const ang = (60 + rnd() * 240) * Math.PI / 180, sp = 200 + rnd() * 800;
    const w = [sp * Math.sin(ang), -sp * Math.cos(ang)];          // on the way out, in a new direction
    const c = [500, 300];
    const at = (t) => (t <= tc ? [c[0] + a[0] * (t - tc), c[1] + a[1] * (t - tc)] : [c[0] + w[0] * (t - tc), c[1] + w[1] * (t - tc)]);
    const tFrames = [0, 1, 2, 3, 4, 5].map((k) => 0.2 - 2 * dt + k * dt);
    const before = tFrames.filter((t) => t <= tc).slice(-3).map((t) => { const p = at(t); return { t, u: p[0] + (rnd() - 0.5), v: p[1] + (rnd() - 0.5) }; });
    const after = tFrames.filter((t) => t > tc).slice(0, 2).map((t) => { const p = at(t); return { t, u: p[0] + (rnd() - 0.5), v: p[1] + (rnd() - 0.5) }; });
    if (before.length < 2 || after.length < 2) continue;
    errMid.push(Math.abs((before[before.length - 1].t + after[0].t) / 2 - tc) * 1000);
    errFit.push(Math.abs(contactTime(before, after) - tc) * 1000);
  }
  const em = stats(errMid), ef = stats(errFit);
  console.log(`   contact from the paths in and out: median error ${ef.med.toFixed(2)} ms vs ${em.med.toFixed(2)} ms for halfway`);
  check('contact from paths beats halfway', ef.med < 0.5 * em.med);
  check('contact with one point after is halfway', contactTime([{ t: 0, u: 0, v: 0 }, { t: 1, u: 1, v: 0 }], [{ t: 2, u: 1, v: 1 }]) === 1.5);
}
