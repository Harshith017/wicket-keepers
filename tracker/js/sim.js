// Demo mode: a synthetic net session rendered through a virtual camera, so the
// whole pipeline (detection -> tracking -> 3D fit -> field outcome) can be tried
// without a camera. The generator is DOM-free so the tests can use it too.

import { G, RB, KD, CREASE, groundBounce } from './physics.js';
import { lookAtCam, project } from './geometry.js';

/** Generate one delivery with true physics (quadratic drag, small time step). */
export function generateDelivery(L, rnd = Math.random, o = {}) {
  const pick = (v, d) => (v === undefined ? d : v);
  const speed0 = pick(o.speed, 22 + rnd() * 18);
  const len = pick(o.length, 2.5 + rnd() * 6.5);
  const x0 = pick(o.x0, (0.45 + rnd() * 0.3) * (rnd() < 0.5 ? 1 : -1));
  const xT = pick(o.line, (rnd() - 0.5) * 0.5);
  const ax = pick(o.ax, (rnd() - 0.5) * 5);
  const turn = pick(o.turn, (rnd() - 0.5) * 6);
  const play = pick(o.play, rnd() < 0.82);
  const z0 = 2.05 + rnd() * 0.2, y0 = L - CREASE;
  const d = y0 - len, T = d / (0.95 * speed0);
  const vz = (RB - z0 + 0.5 * G * T * T) / T;
  const vx = (xT - x0 - 0.5 * ax * T * T) / T;
  const vy = -Math.sqrt(Math.max(1, speed0 * speed0 - vx * vx - vz * vz));
  const shotV = play ? (() => {
    const s = pick(o.shotSpeed, 12 + rnd() * 28);
    const az = pick(o.shotAz, (rnd() * 2 - 1) * 150) * Math.PI / 180;
    const el = pick(o.shotEl, -3 + rnd() * 38) * Math.PI / 180;
    return [s * Math.cos(el) * Math.sin(az), s * Math.cos(el) * Math.cos(az), s * Math.sin(el)];
  })() : null;
  const yHit = pick(o.yHit, 0.9 + rnd() * 0.9);

  const dt = 1 / 1200, pts = [];
  const p = [x0, y0, z0], v = [vx, vy, vz];
  const truth = { speed: Math.hypot(vx, vy, vz), ax, bounce: null, turnDeg: null, swingCm: null, shot: null };
  let hit = false, bounces = 0, tEnd = 0;
  for (let i = 0; i < 1200 * 3; i++) {
    pts.push(p[0], p[1], p[2]);
    const s = Math.hypot(v[0], v[1], v[2]);
    const sw = !hit && bounces === 0 ? ax : 0;
    v[0] += (sw - KD * s * v[0]) * dt; v[1] -= KD * s * v[1] * dt; v[2] -= (G + KD * s * v[2]) * dt;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    tEnd = (i + 1) * dt;
    if (p[2] <= RB && v[2] < 0) {
      p[2] = RB;
      if (!hit && bounces === 0) {
        const h0 = Math.atan2(v[0], -v[1]);
        const h1 = h0 + turn * Math.PI / 180, sp = Math.hypot(v[0], v[1]) * 0.86;
        v[0] = sp * Math.sin(h1); v[1] = -sp * Math.cos(h1); v[2] = -0.55 * v[2];
        truth.bounce = { x: p[0], y: p[1], t: tEnd };
        truth.turnDeg = turn;
        truth.swingCm = 0.5 * ax * tEnd * tEnd * 100;
      } else groundBounce(v);
      bounces++;
    }
    if (!hit && shotV && p[1] <= yHit) {
      hit = true;
      if (!truth.bounce) truth.swingCm = 0.5 * ax * tEnd * tEnd * 100;
      truth.shot = {
        speed: Math.hypot(...shotV), impact: p.slice(), t: tEnd, v: shotV.slice(),
        elevDeg: Math.atan2(shotV[2], Math.hypot(shotV[0], shotV[1])) * 180 / Math.PI,
        azimDeg: Math.atan2(shotV[0], shotV[1]) * 180 / Math.PI,
      };
      v[0] = shotV[0]; v[1] = shotV[1]; v[2] = shotV[2];
    }
    if (!hit && p[1] < -8) break;                 // through to the keeper
    if (hit && tEnd > truth.shot.t + 1.6) break;
  }
  const posAt = (t) => {
    const i = Math.min(pts.length / 3 - 1, Math.max(0, Math.round(t / dt)));
    return [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
  };
  return { truth, tEnd, posAt };
}

/** A frame source that draws the synthetic scene to its own canvas. */
export class DemoSource {
  constructor(L, rectW) {
    this.kind = 'demo';
    this.L = L; this.rectW = rectW;
    this.width = 1280; this.height = 720;
    this.fps = 60;
    this.cam = lookAtCam([1.7, L + 7.5, 2.9], [0, 5, 0.6], 1150, this.width, this.height);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.time = 0; this.frame = 0;
    this.delivery = null; this.tStart = 0; this.nextAt = 1.0;
    this.lastTruth = null;
    this.running = false;
    this.seed = 12345;
  }
  rnd = () => {
    // mulberry32 so the demo is repeatable
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Image positions of the calibration rectangle, in the order the app expects. */
  corners() {
    const hw = this.rectW / 2, L = this.L;
    const w = [[hw, 0, 0], [-hw, 0, 0], [-hw, L, 0], [hw, L, 0]].map((X) => project(this.cam, X));
    // order: striker-end left, striker-end right, bowler-end right, bowler-end left (as seen)
    const s = [w[0], w[1]].sort((a, b) => a[0] - b[0]);
    const b = [w[2], w[3]].sort((a, b) => a[0] - b[0]);
    return [s[0], s[1], b[1], b[0]].map((q) => [q[0] / this.width, q[1] / this.height]);
  }
  start(onFrame) {
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.step();
      onFrame(this.time);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  drawTo(ctx, w, h) { ctx.drawImage(this.canvas, 0, 0, w, h); }

  step() {
    this.time += 1 / this.fps; this.frame++;
    if (!this.delivery && this.time >= this.nextAt) {
      this.delivery = generateDelivery(this.L, this.rnd);
      this.tStart = this.time;
      this.lastTruth = this.delivery.truth;
    }
    if (this.delivery && this.time - this.tStart > this.delivery.tEnd) {
      this.delivery = null; this.nextAt = this.time + 2.6;
    }
    this.draw();
  }

  line(a, b, width, color) {
    const c = this.ctx, p = project(this.cam, a), q = project(this.cam, b);
    if (p[2] <= 0.1 || q[2] <= 0.1) return;
    c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  quad(pts, color) {
    const c = this.ctx;
    c.fillStyle = color; c.beginPath();
    pts.forEach((X, i) => { const p = project(this.cam, X); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    c.closePath(); c.fill();
  }
  draw() {
    const c = this.ctx, L = this.L, cam = this.cam, W = this.width, H = this.height;
    const hz = project(cam, [0, -400, 0])[1];
    const sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#8fb7d6'); sky.addColorStop(1, '#cfe1ea');
    c.fillStyle = sky; c.fillRect(0, 0, W, hz + 1);
    const grass = c.createLinearGradient(0, hz, 0, H);
    grass.addColorStop(0, '#4f8f47'); grass.addColorStop(1, '#2f6b33');
    c.fillStyle = grass; c.fillRect(0, hz, W, H - hz);
    this.quad([[1.525, -1.5, 0], [-1.525, -1.5, 0], [-1.525, L + 1.5, 0], [1.525, L + 1.5, 0]], '#c9b17c');
    const white = 'rgba(255,255,255,.9)';
    for (const y of [0, CREASE, L - CREASE, L]) this.line([-1.32, y, 0], [1.32, y, 0], 2, white);
    for (const x of [-1.32, 1.32]) { this.line([x, -0.3, 0], [x, CREASE, 0], 2, white); this.line([x, L - CREASE, 0], [x, L + 0.3, 0], 2, white); }
    for (const y of [0, L]) for (const x of [-0.1143, 0, 0.1143]) {
      const d = project(cam, [x, y, 0.35])[2];
      this.line([x, y, 0], [x, y, 0.711], Math.max(2, 0.038 * cam.f / d), '#efe3bd');
    }
    // Batter (right-handed, standing leg side of the stumps) with a bat that swings as the ball arrives.
    const d = this.delivery, tt = d ? this.time - this.tStart : -1;
    const dB = project(cam, [-0.45, 1.1, 0.9])[2], wB = 0.42 * cam.f / dB;
    this.line([-0.45, 1.1, 0.15], [-0.45, 1.1, 1.45], wB, '#20324a');
    this.line([-0.45, 1.1, 1.62], [-0.45, 1.1, 1.66], wB * 0.55, '#d8b48f');
    let sw = 0;
    if (d && d.truth.shot) sw = Math.min(1, Math.max(0, (tt - (d.truth.shot.t - 0.12)) / 0.2));
    const ang = -1.9 + sw * 3.0;
    this.line([-0.3, 1.1, 0.95], [-0.3 + 0.85 * Math.sin(ang) * 0.6, 1.1 + 0.4 * sw, 0.95 - 0.85 * Math.cos(ang)], Math.max(3, 0.1 * cam.f / dB), '#d9c08a');
    // Bowler running in and following through (a big moving shape the tracker must ignore).
    const run = d ? tt : (this.time - this.nextAt);
    if (run > -1.4 && run < 0.9) {
      const by = L + 1.5 - (run + 1.4) * 3.2, bx = -0.75;
      const db = project(cam, [bx, by, 0.9])[2];
      if (db > 0.5) {
        const wb = 0.42 * cam.f / db;
        this.line([bx, by, 0.15], [bx, by, 1.45], wb, '#f1efe6');
        this.line([bx, by, 1.62], [bx, by, 1.66], wb * 0.55, '#c99f7c');
      }
    }
    // Ball, drawn as a motion-blurred streak over the exposure time.
    if (d && tt >= 0) {
      const a = d.posAt(Math.max(0, tt - 0.5 / this.fps)), b = d.posAt(tt);
      const pa = project(cam, a), pb = project(cam, b);
      if (pb[2] > 0.3 && pa[2] > 0.3) {
        c.strokeStyle = '#b3161b'; c.lineCap = 'round';
        c.lineWidth = Math.max(2.2, 2 * RB * cam.f / pb[2]);
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.stroke();
      }
    }
  }
}
