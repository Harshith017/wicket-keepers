// This pitch or the next net: a phone held upright about 1 m up, a few metres behind the bowler,
// in a hall with nets side by side. A delivery on this pitch must pass the lane checks; a ball in
// the next net, movement down at the batter's end, and a path hopping between things must not.
import { lookAtCam, project, calibrateFromTaps } from '../js/geometry.js';
import { generateDelivery } from '../js/sim.js';
import { releaseInLane, smoothFlight, reachesBatter, deliveryStart, deliveryCheck, trimAtBatter, overThisPitch } from '../js/bowling.js';

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

// A phone 150-170 cm up, 4-6 m behind the stumps and up to 1 m to the side, the height typed in
// as 160 cm whatever it really is, markers tapped a few pixels off: this pitch's balls still count
// and the next net's do not.
export function heightChecks(check, rnd) {
  const L = 20.12, W = 1080, H = 1920;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let cals = 0, n = 0, own = 0, ownN = 0, side = 0, sideN = 0;
  for (const h of [1.5, 1.6, 1.7]) for (const D of [4, 5, 6]) for (const xc of [-1, 0, 1]) {
    const truth = lookAtCam([xc, L + D, h], [0, 3, 0.3], 1.4 * W, W, H);
    const tap = (X) => { const q = project(truth, X); return [q[0] + 3 * gauss(), q[1] + 3 * gauss()]; };
    const cal = calibrateFromTaps(tap([0, 0, 0]), tap([0, L, 0]), tap([0, 0, 0.711]), 1.6, null, W, H, L);
    n++; if (!cal) continue; cals++;
    const cam = cal.cam;
    for (const off of [0, -3, 3]) {
      const d = generateDelivery(L, rnd, { play: true, x0: off + 0.5, line: off });
      const obs = [];
      for (let t = rnd() / 30; t < d.truth.shot.t; t += 1 / 30) {
        const q = project(truth, d.posAt(t));
        if (q[2] > 0.1 && q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < H) obs.push({ t, u: q[0] + 0.7 * gauss(), v: q[1] + 0.7 * gauss() });
      }
      let ok = obs.length >= 6;
      if (ok) {
        const i0 = deliveryStart(obs, cam, L, 0), o = i0 >= 0 ? trimAtBatter(obs.slice(i0), cam) : obs;
        ok = i0 >= 0 && deliveryCheck(o, cam, L, 0).ok && !releaseInLane(o, cam, L) && !smoothFlight(o, W, cam) && reachesBatter(o[o.length - 1], cam);
      }
      if (off === 0) { ownN++; if (ok) own++; } else { sideN++; if (!ok) side++; }
    }
  }
  check('[height] the markers fit from 150-170 cm with taps a few pixels off', cals === n, `${cals}/${n}`);
  check('[height] this pitch\'s deliveries count from 150-170 cm, 4-6 m back', own >= 0.95 * ownN, `${own}/${ownN}`);
  check('[height] the next net\'s balls do not', side === sideN, `${side}/${sideN}`);
}

// A ball in the next net, seen only for a short stretch far down the pitch (it came into the picture
// late and was lost early): where it started can look like this bowler's hand, so the whole path must
// show it was not over this pitch. This pitch's balls seen for the same short stretch still count.
export function sideNetChecks(check) {
  const L = 20.12, W = 720, H = 1280;
  const cam = lookAtCam([0.1, L + 4.7, 1.5], [0, 3, 0.3], 1.4 * W, W, H);
  const seen = (x0, x1, t0, t1) => {
    const out = [], T = 0.95;            // about 75 km/h from the hand to the batter
    for (let t = t0; t <= t1; t += 1 / 60) {
      const f = t / T, y = L - 1 - (L - 2.5) * f, x = x0 + (x1 - x0) * f, z = Math.max(0.05, 2.1 - 2.4 * f * f);
      const q = project(cam, [x, y, z]); out.push({ t, u: q[0], v: q[1] });
    }
    return out;
  };
  let side = 0, own = 0;
  for (const x of [-4.3, -3.5, 3.5, 4.3]) if (overThisPitch(seen(x, x, 0.45, 0.88), cam, L, 0.8 * 75)) side++;   // its speed, estimated, about 75 km/h
  for (const [a, b, t0, t1] of [[0.3, 0, 0.05, 0.5], [-0.4, 0.5, 0.1, 0.6], [0.5, -0.3, 0.05, 0.85]]) if (!overThisPitch(seen(a, b, t0, t1), cam, L, 0.8 * 75)) own++;
  check('[side net] a next-net ball seen only partway is turned down', side === 4, `${side}/4`);
  check('[side net] this pitch\'s balls seen partway still count', own === 3, `${own}/3`);
}

// Real balls sent from the nets (test/fixtures): the next net's ball must be turned down and this
// pitch's deliveries kept, whichever way their arrival was found.
export async function realSessionChecks(check) {
  const { makeCam } = await import('../js/geometry.js');
  const fs = await import('node:fs');
  const f = JSON.parse(fs.readFileSync(new URL('./fixtures/session-2026-11-19.json', import.meta.url)));
  const c = f.cam, cam = makeCam(c.f, c.cx, c.cy, c.R, c.t);
  let right = 0;
  for (const b of f.balls) {
    const obs = b.obs.map(([t, u, v]) => ({ t, u, v })), end = obs[obs.length - 1];
    const why = releaseInLane(obs, cam, f.L) || overThisPitch(obs, cam, f.L) || smoothFlight(obs, c.W, cam)
      || (b.arriveBy === 'estimated' ? overThisPitch(obs, cam, f.L, 0.8 * b.kmh) : reachesBatter(end, cam) ? '' : 'did not reach the batter');
    if ((b.net === 'next') === !!why) right++;
  }
  check('[real session 19 Nov] the next net\'s ball is turned down and this pitch\'s balls kept', right === f.balls.length, `${right}/${f.balls.length}`);
}
