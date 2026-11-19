// A ball lost partway to the batter: the speed from a delivery fitted to the part that was seen,
// against the true speed, and against taking the last point seen as the arrival.
import { lookAtCam, project } from '../js/geometry.js';
import { tofSpeed, CONTACT_AHEAD } from '../js/bowling.js';
import { generateDelivery } from '../js/sim.js';
import { fitFlight, LOST_SHORT } from '../js/arrival.js';

export function arrivalChecks(check) {
  // its own random numbers, so the checks after it see the same ones as before
  let seed = 21;
  const rnd = () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const L = 20.12, W = 1080, H = 1920;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const fitErr = [], lastErr = [];
  let ways = 0;
  for (let k = 0; k < 24; k++) {
    const h = 1.5 + 0.2 * rnd(), D = 4 + 2 * rnd();
    const cam = lookAtCam([(rnd() - 0.5) * 2, L + D, h], [0, 3, 0.3], 1.4 * W, W, H);
    const d = generateDelivery(L, rnd, { play: true });
    let ta = null;
    for (let t = 0; t < 2; t += 1 / 1200) if (d.posAt(t)[1] <= CONTACT_AHEAD) { ta = t; break; }
    if (!ta) continue;
    const truth = tofSpeed(0, ta, L);
    const obs = [];
    const keep = 0.45 + 0.35 * rnd();                  // lost after 45-80% of the flight
    for (let t = rnd() / 30; t < ta * keep; t += 1 / 30) {
      const q = project(cam, d.posAt(t));
      obs.push({ t: t + 10, u: q[0] + 0.7 * gauss(), v: q[1] + 0.7 * gauss() });
    }
    if (obs.length < 6) continue;
    const f = fitFlight(obs, cam, L);
    if (f.tArrive - obs[obs.length - 1].t > LOST_SHORT) ways++;
    fitErr.push(Math.abs(tofSpeed(f.tRelease, f.tArrive, L) / truth - 1));
    lastErr.push(Math.abs(tofSpeed(obs[0].t - 1 / 60, obs[obs.length - 1].t + 1 / 60, L) / truth - 1));
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  console.log(`   ball lost partway: speed error median ${(100 * med(fitErr)).toFixed(0)}% from the fitted flight, ${(100 * med(lastErr)).toFixed(0)}% from the last point seen`);
  check('[arrival] a ball lost partway is seen as short of the batter', ways >= 0.9 * fitErr.length, `${ways}/${fitErr.length}`);
  check('[arrival] its speed from the fitted flight is within 10%', med(fitErr) < 0.10, `${(100 * med(fitErr)).toFixed(1)}%`);
}
