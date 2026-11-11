// node tracker/test/run.mjs  — checks calibration + trajectory reconstruction on
// synthetic deliveries seen through a virtual camera with pixel noise.
import { lookAtCam, project, calibrate, calibrateStumps } from '../js/geometry.js';
import { analyseDelivery, simulateShot } from '../js/physics.js';
import { generateDelivery } from '../js/sim.js';

let seed = 7;
const rnd = () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
let fails = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!cond) fails++; };

const L = 20.12, RW = 3.05, W = 1280, H = 720;
const setups = {
  'behind bowler': lookAtCam([1.7, L + 7.5, 2.9], [0, 5, 0.6], 1150, W, H),
  'behind batter': lookAtCam([-1.2, -6, 2.4], [0, 12, 0.5], 1000, W, H),
};

for (const [name, truthCam] of Object.entries(setups)) {
  // --- calibration from 4 tapped corners (with 1px tap noise) ---
  const hw = RW / 2;
  const w = [[hw, 0, 0], [-hw, 0, 0], [-hw, L, 0], [hw, L, 0]].map((X) => project(truthCam, X));
  const s = [w[0], w[1]].sort((a, b) => a[0] - b[0]), b = [w[2], w[3]].sort((a, b) => a[0] - b[0]);
  const img = [s[0], s[1], b[1], b[0]].map((q) => [q[0] + gauss(), q[1] + gauss()]);
  const cal = calibrate(img, RW, L, W, H);
  check(`[${name}] calibration succeeds`, !!cal);
  if (!cal) continue;
  const cam = cal.cam;
  // --- calibration from the stumps alone (1px tap noise) ---
  const sImg = [[0, 0, 0], [0, 0, 0.711], [0, L, 0.711], [0, L, 0]].map((X) => { const q = project(truthCam, X); return [q[0] + gauss(), q[1] + gauss()]; });
  const sCal = calibrateStumps(sImg, L, W, H);
  const dS = sCal ? Math.hypot(...sCal.cam.C.map((v, i) => v - truthCam.C[i])) : Infinity;
  check(`[${name}] stump calibration finds the camera`, dS < 2.5, `err ${dS.toFixed(2)} m`);
  const dC = Math.hypot(...cam.C.map((v, i) => v - truthCam.C[i]));
  check(`[${name}] camera position`, dC < 1.0, `err ${dC.toFixed(2)} m, f ${cam.f.toFixed(0)} vs ${truthCam.f}`);

  for (const fps of [60, 30]) {
    const errs = { speed: [], swing: [], turn: [], shotSpeed: [], shotAz: [], shotEl: [] };
    let n = 0, okN = 0, shotsTrue = 0, shotsFound = 0, falseShots = 0;
    for (let i = 0; i < 60; i++) {
      const d = generateDelivery(L, rnd);
      const obs = [];
      const phase = rnd() / fps;
      for (let t = phase; t < d.tEnd; t += 1 / fps) {
        const p = project(truthCam, d.posAt(t));
        if (p[2] < 0.5 || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue;
        obs.push({ t: 100 + t, u: p[0] + gauss() * 0.7, v: p[1] + gauss() * 0.7 });
      }
      n++;
      const r = analyseDelivery(obs, cam, { L, hand: 'R' });
      if (!r.ok) continue;
      okN++;
      const T = d.truth;
      errs.speed.push(Math.abs(r.release.speed - T.speed) / T.speed * 100);
      if (T.bounce && r.bounce) errs.swing.push(Math.abs(r.swingCm - T.swingCm));
      if (T.bounce && r.turnDeg !== null) errs.turn.push(Math.abs(r.turnDeg - T.turnDeg));
      if (T.shot) shotsTrue++;
      if (T.shot && r.shot) {
        shotsFound++;
        errs.shotSpeed.push(Math.abs(r.shot.speed - T.shot.speed) / T.shot.speed * 100);
        let da = Math.abs(r.shot.azimDeg - T.shot.azimDeg); if (da > 180) da = 360 - da;
        errs.shotAz.push(da);
        errs.shotEl.push(Math.abs(r.shot.elevDeg - T.shot.elevDeg));
      }
      if (!T.shot && r.shot) falseShots++;
    }
    const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN;
    const p90 = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.9)] : NaN;
    const tag = `[${name} @${fps}fps]`;
    console.log(`${tag} analysed ${okN}/${n}; shots found ${shotsFound}/${shotsTrue}, false shots ${falseShots}`);
    console.log(`   speed err % med ${med(errs.speed).toFixed(1)} p90 ${p90(errs.speed).toFixed(1)} | swing cm med ${med(errs.swing).toFixed(1)} p90 ${p90(errs.swing).toFixed(1)} | turn deg med ${med(errs.turn).toFixed(1)} p90 ${p90(errs.turn).toFixed(1)}`);
    console.log(`   shot speed % med ${med(errs.shotSpeed).toFixed(1)} p90 ${p90(errs.shotSpeed).toFixed(1)} | az deg med ${med(errs.shotAz).toFixed(1)} p90 ${p90(errs.shotAz).toFixed(1)} | elev deg med ${med(errs.shotEl).toFixed(1)} p90 ${p90(errs.shotEl).toFixed(1)}`);
    check(`${tag} most deliveries reconstructed`, okN >= n * 0.85);
    check(`${tag} median ball-speed error < 6%`, med(errs.speed) < 6);
    check(`${tag} shots detected`, shotsFound >= shotsTrue * (fps >= 60 ? 0.8 : 0.6));   // at 30 fps many shots leave the frame in under 3 frames
    check(`${tag} few phantom shots`, falseShots <= 2);
  }
}

// --- field outcomes ---
const field = { L, boundary: 65, fielders: [{ x: 0, y: -9, name: 'keeper' }, { x: 20, y: 22, name: 'cover' }] };
const lofted = simulateShot([0, 1.2, 0.8], [0, 30, 22], field);
check('big straight hit is SIX', lofted.outcome === 'SIX', lofted.outcome);
const ground = simulateShot([0, 1.2, 0.5], [-34, 6, 1], field);
check('hard square drive along the ground is FOUR', ground.outcome === 'FOUR', ground.outcome);
const toCover = simulateShot([0, 1.2, 0.5], [13, 14, 1], field);
check('push to cover is FIELDED by cover', toCover.outcome === 'FIELDED' && toCover.by.name === 'cover', toCover.outcome);
const edge = simulateShot([0, 1.2, 0.8], [0.3, -25, 1.5], field);
check('edge behind is CAUGHT by keeper', edge.outcome === 'CAUGHT' && edge.by.name === 'keeper', edge.outcome);

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
