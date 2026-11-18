// This pitch or the next net: a phone held upright about 1 m up, a few metres behind the bowler,
// in a hall with nets side by side. A delivery on this pitch must pass the lane checks; a ball in
// the next net, movement down at the batter's end, and a path hopping between things must not.
import { lookAtCam, project } from '../js/geometry.js';
import { releaseInLane, smoothFlight, reachesBatter } from '../js/bowling.js';

export function laneChecks(check, rnd) {
  const L = 20.12, W = 720, H = 1280;
  const cam = lookAtCam([0.1, L + 4.5, 1.0], [0, 2, 0.3], 1020, W, H);
  const inView = (q) => q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < H;
  // a ball from (x0, L - 1, 2.1) to the batter, bouncing on the way, seen 30 times a second
  const flight = (x0, x1, speed) => {
    const out = [], len = L - 1 - 1.5, T = len / speed;
    for (let t = 0; t <= T; t += 1 / 30) {
      const f = t / T, y = L - 1 - len * f, x = x0 + (x1 - x0) * f;
      const z = f < 0.6 ? 2.1 * (1 - f / 0.6) ** 1.3 : 0.9 * Math.sin(Math.PI * (f - 0.6) / 0.8);
      const q = project(cam, [x, y, Math.max(0, z)]);
      if (inView(q)) out.push({ t, u: q[0] + (rnd() - 0.5), v: q[1] + (rnd() - 0.5) });
    }
    return out;
  };
  let ok = 0, n = 0;
  for (const [x0, x1, kmh] of [[0.3, 0.1, 80], [-0.5, 0.4, 120], [0.8, -0.3, 60], [0, 0.9, 100]]) {
    const o = flight(x0, x1, kmh / 3.6); n++;
    const why = releaseInLane(o, cam, L) || smoothFlight(o, W, cam) || (reachesBatter(o[o.length - 1], cam) ? '' : 'end');
    if (!why) ok++; else console.log('   ', x0, x1, kmh, why, o.length);
  }
  check('[lane] deliveries on this pitch pass the lane checks', ok === n, `${ok}/${n}`);

  let side = 0;
  for (const x of [-3.2, 3.2, -2.6]) {
    const o = flight(x, x, 90 / 3.6);
    if (o.length >= 6 && (releaseInLane(o, cam, L) || !reachesBatter(o[o.length - 1], cam))) side++;
  }
  check('[lane] balls in the next nets are turned down', side === 3, `${side}/3`);

  const far = [];
  for (let k = 0; k < 12; k++) { const q = project(cam, [-0.5 + 0.1 * k, 2 + 0.2 * k, 0.4]); far.push({ t: k / 30, u: q[0], v: q[1] }); }
  check('[lane] movement first seen down at the batter\'s end is not a release', !!releaseInLane(far, cam, L));

  const good = flight(0.2, 0.2, 90 / 3.6);
  const hop = good.map((p, i) => (i % 4 === 2 ? { ...p, u: p.u + 0.12 * W, v: p.v - 0.05 * H } : p));
  check('[lane] a path hopping between things is not one ball in flight', !!smoothFlight(hop, W, cam));
}
