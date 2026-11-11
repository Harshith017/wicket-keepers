import { calibrate, calibrateStumps, project } from './geometry.js';
import { MapView } from './maps.js';
import { analyseTrack, sampleSegments, simulateShot, runsFor, CREASE, STUMP_H } from './physics.js';
import { Detector, Tracker } from './detector.js';
import { FieldView, makeField, positionName, PRESETS } from './field.js';
import { DemoSource } from './sim.js';

const $ = (id) => document.getElementById(id);
const STORE = 'wkt:v1';
const MIN_CAM_HEIGHT = 1.5;      // metres; higher is fine and is picked up by calibration

// ---------------------------------------------------------------- state
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
const settings = Object.assign({ L: 20.12, rectW: 3.05, units: 'kmh', sens: 45, procW: 960, slowmo: 1, calMode: 'corners' }, saved.settings);
const F = {                                   // field state, shared by both field views
  L: settings.L, boundary: saved.boundary || 65, hand: saved.hand || 'R',
  preset: saved.preset || 'balanced', fielders: saved.fielders || null,
};
if (!F.fielders) F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
const S = {
  source: null, cam: null, camInfo: '', calibrating: false, armed: true,
  calibPts: saved.calibPts || [[0.42, 0.42], [0.58, 0.42], [0.72, 0.85], [0.28, 0.85]],   // striker L, striker R, bowler R, bowler L
  stumpPts: saved.stumpPts || [[0.5, 0.45], [0.5, 0.38], [0.5, 0.56], [0.5, 0.86]],   // striker base, striker top, bowler top, bowler base
  balls: saved.balls || [], last: null, live: null, lastT: -1, drag: -1,
  fps: 0, fpsN: 0, fpsT0: 0, status: '', statusKind: '',
};
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      settings, boundary: F.boundary, hand: F.hand, preset: F.preset, fielders: F.fielders,
      calibPts: S.calibPts, stumpPts: S.stumpPts, balls: S.balls.slice(-200),
    }));
  } catch (e) { /* storage unavailable: carry on without persistence */ }
}

const detector = new Detector(), tracker = new Tracker();
const view = $('view'), vctx = view.getContext('2d');
const proc = document.createElement('canvas'), pctx = proc.getContext('2d', { willReadFrequently: true });
const video = $('video');

// ---------------------------------------------------------------- sources
class VideoSource {
  constructor(kind) { this.kind = kind; this.running = false; }
  get width() { return video.videoWidth; }
  get height() { return video.videoHeight; }
  async open(file) {
    if (this.kind === 'camera') {
      // Insist on 60 fps first: with only an "ideal" hint most phones quietly
      // hand back 30. Phones usually offer 60 at 720p or 1080p, so try both
      // before settling for whatever the camera will give.
      const base = { facingMode: { ideal: 'environment' } };
      const ladder = [
        { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { min: 55, ideal: 60 } },
        { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { min: 55, ideal: 60 } },
        { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      ];
      let lastErr = null;
      for (const videoC of ladder) {
        try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoC }); break; }
        catch (err) {
          lastErr = err;
          if (err.name !== 'OverconstrainedError' && err.name !== 'ConstraintNotSatisfiedError') throw err;   // e.g. permission denied
        }
      }
      if (!this.stream) throw lastErr;
      const st = this.stream.getVideoTracks()[0].getSettings();
      this.camFps = st.frameRate ? Math.round(st.frameRate) : null;
      video.srcObject = this.stream; video.loop = false;
    } else {
      this.url = URL.createObjectURL(file);
      video.srcObject = null; video.src = this.url; video.loop = true;
    }
    video.muted = true;
    await video.play();
  }
  start(onFrame) {
    this.running = true;
    const useRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    const tick = (now, meta) => {
      if (!this.running) return;
      let t;
      if (this.kind === 'file') t = (meta ? meta.mediaTime : video.currentTime) / Math.max(1, settings.slowmo);
      else t = meta ? (meta.captureTime !== undefined ? meta.captureTime / 1000 : meta.mediaTime) : now / 1000;
      onFrame(t);
      if (useRvfc) video.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
    };
    if (useRvfc) video.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
  }
  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    video.pause(); video.srcObject = null;
    if (this.url) { URL.revokeObjectURL(this.url); video.removeAttribute('src'); video.load(); }
  }
  drawTo(ctx, w, h) { ctx.drawImage(video, 0, 0, w, h); }
}

let wakeLock = null;
async function setSource(kind, file) {
  if (S.source) { S.source.stop(); S.source = null; }
  detector.reset(); tracker.reset(); S.live = null; S.lastT = -1; S.lastBallEnd = -100; S.calibrating = false;
  document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.src === kind));
  try {
    let src;
    if (kind === 'demo') src = new DemoSource(settings.L, settings.rectW);
    else { src = new VideoSource(kind); await src.open(file); }
    S.source = src;
    $('stageEmpty').hidden = true; $('pill').hidden = false;
    recalibrate();
    src.start(onFrame);
    if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
  } catch (err) {
    document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.remove('on'));
    $('stageEmpty').hidden = false; $('pill').hidden = true;
    $('stageEmpty').innerHTML = kind === 'camera'
      ? '<b>Camera unavailable</b><span>Allow camera access for this page (it needs HTTPS), or try a video clip or the demo.</span>'
      : '<b>Couldn’t open that clip</b><span>Try a different video file.</span>';
  }
  syncControls();
}

// ---------------------------------------------------------------- calibration
const byStumps = () => settings.calMode === 'stumps';
const handlePts = () => (byStumps() ? S.stumpPts : S.calibPts);
const activePts = () => (S.source && S.source.kind === 'demo' ? (byStumps() ? S.source.stumpPts() : S.source.corners()) : handlePts());
function recalibrate() {
  const src = S.source;
  S.cam = null; S.camInfo = ''; S.camLow = false;
  if (!src || !src.width) return;
  const W = src.width, H = src.height;
  const px = activePts().map(([x, y]) => [x * W, y * H]);
  const r = byStumps() ? calibrateStumps(px, settings.L, W, H) : calibrate(px, settings.rectW, settings.L, W, H);
  if (r && r.rms < (byStumps() ? 0.004 : 0.02) * W) {
    S.cam = r.cam;
    const C = r.cam.C;
    // The height is worked out from the calibration; nothing is typed in.
    S.camLow = C[2] < MIN_CAM_HEIGHT;
    S.camInfo = `Camera ${(C[2] * 100).toFixed(0)} cm high, ${Math.hypot(C[0], C[1]).toFixed(0)} m from the striker's stumps`
      + (S.camLow ? `. Raise it to at least ${MIN_CAM_HEIGHT * 100} cm; this low, speed and length readings are unreliable` : '');
  } else S.camInfo = byStumps() ? 'Those marks don’t fit two sets of stumps — put each on the base or top of the middle stump.'
    : 'Those corners don’t form a pitch the camera could be seeing — adjust them.';
  tracker.W = W;
  let info = src.kind === 'demo' ? 'Demo scene is calibrated automatically. ' + S.camInfo : S.camInfo;
  if (src.kind === 'camera' && src.camFps) {
    info += src.camFps >= 55 ? ` \u00b7 Camera running at ${src.camFps} fps.`
      : ` \u00b7 This browser only gave ${src.camFps} fps, so fast balls will read less accurately.`;
  }
  $('calInfo').textContent = info;
}

function canvasPos(e) {
  const r = view.getBoundingClientRect();
  // the canvas uses object-fit: contain inside the stage
  const sc = Math.min(r.width / view.width, r.height / view.height);
  const ox = (r.width - view.width * sc) / 2, oy = (r.height - view.height * sc) / 2;
  return [(e.clientX - r.left - ox) / (view.width * sc), (e.clientY - r.top - oy) / (view.height * sc), sc];
}
// Where a handle is drawn relative to the point it marks (stump handles sit to one side).
const handleOffset = (i) => (byStumps() ? (i === 1 || i === 2 ? -1 : 1) * 30 / 1280 : 0);
view.addEventListener('pointerdown', (e) => {
  if (!S.calibrating) return;
  const [x, y, sc] = canvasPos(e), ar = view.height / view.width;
  let bi = -1, bd = 44 / (sc * view.width);
  handlePts().forEach((p, i) => {
    const d = Math.min(Math.hypot(p[0] - x, (p[1] - y) * ar), Math.hypot(p[0] + handleOffset(i) - x, (p[1] - y) * ar));
    if (d < bd) { bd = d; bi = i; }
  });
  if (bi >= 0) {
    // Keep the grab offset so the point does not jump under the finger.
    S.drag = bi; S.dragOff = [handlePts()[bi][0] - x, handlePts()[bi][1] - y];
    view.setPointerCapture(e.pointerId); e.preventDefault();
  }
});
view.addEventListener('pointermove', (e) => {
  if (S.drag < 0) return;
  const [x, y] = canvasPos(e);
  handlePts()[S.drag] = [Math.min(1, Math.max(0, x + S.dragOff[0])), Math.min(1, Math.max(0, y + S.dragOff[1]))];
  recalibrate();
});
const endDrag = () => { if (S.drag >= 0) { S.drag = -1; save(); } };
view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- frame loop
function onFrame(t) {
  const src = S.source;
  if (!src || !src.width) return;
  const W = src.width, H = src.height;
  if (view.width !== W || view.height !== H) {
    view.width = W; view.height = H;
    $('stage').style.aspectRatio = `${W} / ${H}`;
    recalibrate();
  }
  if (t < S.lastT || t - S.lastT > 1.5) { detector.reset(); tracker.reset(); S.live = null; S.lastBallEnd = -100; }
  S.lastT = t;
  src.drawTo(vctx, W, H);
  if (S.drag >= 0) grabLoupe(W, H);

  if (S.armed && S.cam && !S.calibrating) {
    const pw = Math.min(W, settings.procW), ph = Math.round(H * pw / W);
    if (proc.width !== pw || proc.height !== ph) { proc.width = pw; proc.height = ph; }
    pctx.drawImage(view, 0, 0, pw, ph);
    detector.thr = settings.sens;
    const det = detector.process(pctx.getImageData(0, 0, pw, ph), t);
    if (det) {
      const k = W / pw;
      const blobs = det.noisy ? [] : det.blobs.map((b) => ({ x: b.x * k, y: b.y * k, n: b.n }));
      const res = tracker.update(blobs, det.t);
      S.live = res.live;
      if (res.finished) onTrack(res.finished);
    }
  } else S.live = null;

  S.fpsN++;
  const now = performance.now();
  if (now - S.fpsT0 > 1000) { S.fps = S.fpsN * 1000 / (now - S.fpsT0); S.fpsN = 0; S.fpsT0 = now; updatePill(); }
  drawOverlay(W, H);
}

function updatePill() {
  let txt, kind = 'live';
  if (!S.cam) { txt = 'Not calibrated'; kind = 'bad'; }
  else if (S.calibrating) { txt = byStumps() ? 'Mark the base and top of each middle stump' : 'Drag the corners onto the pitch'; kind = 'busy'; }
  else if (!S.armed) { txt = 'Paused'; kind = ''; }
  else if (S.camLow && !S.live) { txt = `Camera too low \u2014 raise it to ${MIN_CAM_HEIGHT * 100} cm or more`; kind = 'bad'; }
  else if (S.live) { txt = 'Tracking…'; kind = 'busy'; }
  else txt = S.status || 'Ready — waiting for a ball';
  if (S.fps) txt += ` · ${Math.round(S.fps)} fps`;
  $('pillTxt').textContent = txt;
  $('pillDot').className = 'dot ' + kind;
}

// ---------------------------------------------------------------- magnifier
// While a handle is dragged, a magnified view of the clean frame under it is
// shown clear of the finger, so it can be placed to the pixel.
const loupe = document.createElement('canvas'), lctx = loupe.getContext('2d');
loupe.width = loupe.height = 220;
function grabLoupe(W, H) {
  const p = handlePts()[S.drag], r = 22 * W / 1280;
  lctx.fillStyle = '#000'; lctx.fillRect(0, 0, 220, 220);
  lctx.imageSmoothingEnabled = false;
  lctx.drawImage(view, p[0] * W - r, p[1] * H - r, 2 * r, 2 * r, 0, 0, 220, 220);
}
function drawLoupe(W, H, k) {
  const p = handlePts()[S.drag], x = p[0] * W, y = p[1] * H, R = 105 * k;
  const cx = Math.min(W - R - 8 * k, Math.max(R + 8 * k, x)), cy = y > 2.6 * R ? y - 1.5 * R : y + 1.5 * R;
  const c = vctx;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip();
  c.drawImage(loupe, cx - R, cy - R, 2 * R, 2 * R);
  c.strokeStyle = 'rgba(255,224,102,.95)'; c.lineWidth = 1.5 * k;
  c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - 8 * k, cy); c.moveTo(cx + 8 * k, cy); c.lineTo(cx + R, cy);
  c.moveTo(cx, cy - R); c.lineTo(cx, cy - 8 * k); c.moveTo(cx, cy + 8 * k); c.lineTo(cx, cy + R); c.stroke();
  c.restore();
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.lineWidth = 3 * k; c.strokeStyle = '#ffe066'; c.stroke();
}

// ---------------------------------------------------------------- overlay
function poly(pts3, color, width, W) {
  const c = vctx;
  c.beginPath();
  let pen = false;
  for (const X of pts3) {
    const p = project(S.cam, X);
    if (p[2] <= 0.2) { pen = false; continue; }
    if (pen) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]);
    pen = true;
  }
  c.strokeStyle = color; c.lineWidth = width * W / 1280; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke();
}
function drawOverlay(W, H) {
  const c = vctx, k = W / 1280, L = settings.L, hw = settings.rectW / 2;
  if (S.cam && (S.calibrating || !S.last)) {
    const col = S.calibrating ? 'rgba(255,224,102,.95)' : 'rgba(255,255,255,.35)';
    poly([[hw, 0, 0], [-hw, 0, 0], [-hw, L, 0], [hw, L, 0], [hw, 0, 0]], col, 2, W);
    for (const y of [CREASE, L - CREASE]) poly([[-hw, y, 0], [hw, y, 0]], col, 1.5, W);
    for (const y of [0, L]) for (const x of [-0.1143, 0, 0.1143]) poly([[x, y, 0], [x, y, STUMP_H]], col, 2, W);
  }
  if (S.calibrating) {
    const stumps = byStumps();
    const names = stumps ? ['Striker base', 'Striker top', 'Bowler top', 'Bowler base'] : ['Striker end', 'Striker end', 'Bowler end', 'Bowler end'];
    handlePts().forEach((p, i) => {
      const x = p[0] * W, y = p[1] * H, held = S.drag === i;
      // Stump handles sit off to the side with a pointer, so they never cover the stump itself.
      const ox = stumps ? (i === 1 || i === 2 ? -1 : 1) * 30 * k : 0;
      if (stumps) {
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + ox, y);
        c.lineWidth = 2 * k; c.strokeStyle = '#ffe066'; c.stroke();
      }
      c.beginPath(); c.arc(x + ox, y, 14 * k, 0, 7); c.fillStyle = held ? 'rgba(255,224,102,.1)' : 'rgba(255,224,102,.3)'; c.fill();
      c.lineWidth = 3 * k; c.strokeStyle = '#ffe066'; c.stroke();
      if (!held) { c.beginPath(); c.arc(x, y, 3 * k, 0, 7); c.fillStyle = '#ffe066'; c.fill(); }
      c.font = `600 ${14 * k}px Geist, sans-serif`; c.textAlign = stumps ? (ox < 0 ? 'right' : 'left') : 'center';
      const tx = stumps ? x + ox + Math.sign(ox) * 20 * k : x, ty = stumps ? y + 5 * k : y - 24 * k;
      c.lineWidth = 4 * k; c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(names[i], tx, ty);
      c.fillStyle = '#fff'; c.fillText(names[i], tx, ty);
    });
    if (S.drag >= 0) drawLoupe(W, H, k);
    return;
  }
  if (S.live) {
    c.fillStyle = '#ffe066';
    for (const p of S.live) { c.beginPath(); c.arc(p.u, p.v, 3.5 * k, 0, 7); c.fill(); }
  }
  const last = S.last;
  if (last && S.cam && performance.now() - last.shownAt < 9000) {
    const colors = { pre: '#ffd84d', post: '#ff9f43', shot: '#63e6ff' };
    for (const sg of last.samples) {
      poly(sg.pts, 'rgba(0,0,0,.55)', 7, W);
      poly(sg.pts, colors[sg.kind], 3.5, W);
    }
    if (last.bounce3) {
      const p = project(S.cam, last.bounce3);
      c.beginPath(); c.arc(p[0], p[1], 7 * k, 0, 7); c.fillStyle = '#ff9f43'; c.fill();
      c.lineWidth = 2 * k; c.strokeStyle = '#1b1b1b'; c.stroke();
    }
  } else if (last && performance.now() - last.shownAt >= 9000) S.last.samples = [];
}

// ---------------------------------------------------------------- a ball
const spd = (ms) => (settings.units === 'mph' ? ms * 2.23694 : ms * 3.6);
const unit = () => (settings.units === 'mph' ? 'mph' : 'km/h');

function lengthName(y) {
  if (y < 2) return 'Yorker';
  if (y < 6) return 'Full';
  if (y < 8) return 'Good length';
  if (y < 10) return 'Short of a length';
  return 'Short';
}
function lineName(x) {              // x: + toward off
  if (x > 0.3) return 'Outside off';
  if (x > 0.075) return 'Off stump';
  if (x >= -0.075) return 'Middle';
  if (x >= -0.3) return 'Leg stump';
  return 'Down leg';
}
function shotDirection(az) {
  const a = Math.abs(az), offS = az >= 0;
  if (a < 14) return 'straight back past the bowler';
  if (a < 40) return offS ? 'through mid-off' : 'through mid-on';
  if (a < 75) return offS ? 'through the covers' : 'through midwicket';
  if (a < 105) return offS ? 'square on the off side' : 'square on the leg side';
  if (a < 150) return offS ? 'behind point' : 'behind square leg';
  return offS ? 'fine on the off side' : 'fine down the leg side';
}

function onTrack(candidates) {
  const W = S.source.width;
  let r = null;
  for (const obs of candidates) {
    if (obs[0].t < S.lastBallEnd + 0.4 && obs[0].t > S.lastBallEnd - 5) continue;      // leftovers of the ball just scored
    const a = analyseTrack(obs, S.cam, { L: settings.L, hand: F.hand, rmsMax: 5 * W / 1280 });
    if (a.ok && (!r || a.rms < r.rms)) r = a;
  }
  if (!r) { S.status = 'Saw movement, but not a delivery'; updatePill(); return; }
  S.lastBallEnd = r.tEnd;
  const field = { L: settings.L, boundary: F.boundary, fielders: F.fielders };
  const ball = {
    at: Date.now(), speed: r.release.speed, swingCm: r.swingCm, turnDeg: r.turnDeg,
    length: r.bounce ? r.bounce.y : null, line: r.atStumps ? r.atStumps.x : null,
    hitting: !!(r.atStumps && r.atStumps.hitting), fps: Math.round(r.fps),
    bx: r.bounce ? r.bounce.x : null, sz: r.atStumps ? r.atStumps.z : null, hand: F.hand,
  };
  if (r.shot) {
    const sim = simulateShot(r.shot.impact, r.shot.v, field);
    ball.outcome = sim.outcome; ball.runs = runsFor(sim, settings.L);
    ball.by = sim.by ? sim.by.id : null; ball.byName = sim.by ? positionName(sim.by, F.hand) : null;
    ball.shotSpeed = r.shot.speed; ball.batSpeed = r.shot.batSpeed; ball.elev = r.shot.elevDeg; ball.az = r.shot.azimDeg;
    const step = Math.max(1, Math.ceil(sim.path.length / 40));
    ball.path = sim.path.filter((_, i) => i % step === 0 || i === sim.path.length - 1).map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]);
    ball.carry = sim.firstBounce ? Math.hypot(sim.firstBounce[0] - r.shot.impact[0], sim.firstBounce[1] - r.shot.impact[1]) : null;
  } else {
    ball.outcome = r.lost ? 'LOST' : ball.hitting ? 'BOWLED' : 'DOT'; ball.runs = 0;
  }
  if (S.source.kind === 'demo' && S.source.lastTruth) {
    const T = S.source.lastTruth;
    ball.truth = { speed: T.speed, swingCm: T.swingCm, turnDeg: T.turnDeg, shotSpeed: T.shot ? T.shot.speed : null };
  }
  S.balls.push(ball);
  S.last = {
    ball, shownAt: performance.now(), samples: sampleSegments(r.segments),
    bounce3: r.bounce ? [r.bounce.x * (F.hand === 'L' ? -1 : 1), r.bounce.y, 0] : null,
  };
  S.status = 'Ready — waiting for the next ball';
  save(); renderResult(); renderScore(); renderSession();
}

function headline(b) {
  switch (b.outcome) {
    case 'SIX': return ['Six', 'six', 'Cleared the rope on the full.'];
    case 'FOUR': return ['Four', 'six', 'Beat the field and reached the boundary.'];
    case 'CAUGHT': return ['Caught', 'out', `Taken at ${b.byName.toLowerCase()}.`];
    case 'BOWLED': return ['Bowled', 'out', 'No shot connected and the ball was hitting the stumps.'];
    case 'DOT': return ['No shot', '', 'Through to the keeper.'];
    case 'LOST': return ['Shot not seen', '', 'Lost the ball at the batter, so this one isn\u2019t scored.'];
    default: return [b.runs ? `${b.runs} run${b.runs > 1 ? 's' : ''}` : 'Dot ball', '',
      b.byName ? `Fielded at ${b.byName.toLowerCase()}.` : 'Stopped in the outfield.'];
  }
}
const isFigure = (v) => /^[\d.\u2014/ \u00d7-]+$/.test(String(v));
const tile = (label, value, u, note) => `<div class="tile"><div class="label">${label}</div><div class="v${isFigure(value) ? '' : ' word'}">${value}${u ? `<small>${u}</small>` : ''}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
function swingText(b) {
  if (b.swingCm === null || b.swingCm === undefined) return ['—', '', ''];
  const a = Math.abs(b.swingCm);
  if (a < 3) return ['Straight', '', 'under 3 cm'];
  return [a.toFixed(0), 'cm', b.swingCm > 0 ? 'away from the batter' : 'in to the batter'];
}
function turnText(b) {
  if (b.turnDeg === null || b.turnDeg === undefined) return ['—', '', b.length === null ? 'full toss' : 'hit too soon after pitching'];
  const a = Math.abs(b.turnDeg);
  if (a < 0.5) return ['None', '', 'held its line'];
  return [a.toFixed(1), '°', b.turnDeg > 0 ? 'away, like a leg-break' : 'in, like an off-break'];
}
function renderResult() {
  const last = S.last;
  $('result').hidden = !last; $('miniCard').hidden = !last;
  if (!last) return;
  const b = last.ball, [h, cls, sub] = headline(b);
  $('resLabel').textContent = `Ball ${S.balls.length}`;
  $('resHead').textContent = h; $('resHead').className = 'head ' + cls;
  $('resSub').textContent = b.shotSpeed ? `${sub} Hit ${shotDirection(b.az)}.` : sub;
  const sw = swingText(b), tn = turnText(b);
  let html = tile('Ball speed', spd(b.speed).toFixed(0), unit(), b.fps < 45 ? `from ${b.fps} fps video` : '')
    + tile('Bat speed', b.batSpeed != null ? spd(b.batSpeed).toFixed(0) : '—', b.batSpeed != null ? unit() : '', b.batSpeed != null ? 'estimated from the shot' : 'no shot played')
    + tile('Swing', sw[0], sw[1], sw[2])
    + tile('Turn off the pitch', tn[0], tn[1], tn[2])
    + tile('Length', b.length === null ? 'Full toss' : lengthName(b.length), '', b.length === null ? '' : `pitched ${b.length.toFixed(1)} m from the stumps`)
    + tile('Line', b.line === null ? '—' : lineName(b.line), '', b.line === null ? '' : b.hitting ? 'hitting the stumps' : 'missing the stumps');
  if (b.shotSpeed) {
    html += tile('Off the bat', spd(b.shotSpeed).toFixed(0), unit(), `launched ${b.elev.toFixed(0)}° ${b.elev >= 0 ? 'up' : 'down'}`);
    if (b.carry) html += tile('Carry', b.carry.toFixed(0), 'm', 'to where it first landed');
  }
  $('resTiles').innerHTML = html;
  const tr = $('resTruth');
  tr.hidden = !b.truth;
  if (b.truth) {
    const T = b.truth;
    tr.textContent = `Demo ground truth: ball ${spd(T.speed).toFixed(0)} ${unit()}`
      + (T.swingCm != null ? `, swing ${Math.abs(T.swingCm).toFixed(0)} cm` : '')
      + (T.turnDeg != null ? `, turn ${Math.abs(T.turnDeg).toFixed(1)}°` : '')
      + (T.shotSpeed ? `, off the bat ${spd(T.shotSpeed).toFixed(0)} ${unit()}` : ', no shot') + '.';
  }
  mini.shots = S.balls.filter((x) => x.path); mini.highlight = b.path ? b : null;
  mini.draw();
}

function renderScore() {
  const runs = S.balls.reduce((a, b) => a + (b.runs || 0), 0);
  const wk = S.balls.filter((b) => b.outcome === 'CAUGHT' || b.outcome === 'BOWLED').length;
  $('score').innerHTML = S.balls.length ? `<b>${runs}/${wk}</b> · ${S.balls.length} ball${S.balls.length > 1 ? 's' : ''}` : '';
}
function renderSession() {
  const B = S.balls;
  renderMaps();
  if (!B.length) {
    $('sessTiles').innerHTML = '<p class="muted" style="margin:0;grid-column:1/-1;padding:20px">No balls yet. Each delivery is added here as it is tracked.</p>';
    $('sessTable').innerHTML = ''; $('clearBtn').disabled = true; return;
  }
  $('clearBtn').disabled = false;
  const runs = B.reduce((a, b) => a + (b.runs || 0), 0), wk = B.filter((b) => b.outcome === 'CAUGHT' || b.outcome === 'BOWLED').length;
  const speeds = B.map((b) => b.speed), bats = B.filter((b) => b.batSpeed != null).map((b) => b.batSpeed);
  $('sessTiles').innerHTML = tile('Score', `${runs}/${wk}`, '', `${B.length} balls`)
    + tile('Fastest ball', spd(Math.max(...speeds)).toFixed(0), unit())
    + tile('Average ball', spd(speeds.reduce((a, v) => a + v, 0) / speeds.length).toFixed(0), unit())
    + tile('Top bat speed', bats.length ? spd(Math.max(...bats)).toFixed(0) : '—', bats.length ? unit() : '')
    + tile('Boundaries', `${B.filter((b) => b.outcome === 'FOUR').length} × 4`, '', `${B.filter((b) => b.outcome === 'SIX').length} × 6`);
  let rows = '';
  for (let i = B.length - 1; i >= 0; i--) {
    const b = B[i], sw = swingText(b), tn = turnText(b);
    rows += `<tr><td>${i + 1}</td><td><b>${headline(b)[0]}</b>${b.byName && b.outcome !== 'SIX' && b.outcome !== 'FOUR' ? `<br><span class="muted">${b.byName}</span>` : ''}</td>`
      + `<td class="num">${spd(b.speed).toFixed(0)}</td><td class="num">${b.batSpeed != null ? spd(b.batSpeed).toFixed(0) : '—'}</td>`
      + `<td>${sw[1] ? `${sw[0]} cm ${b.swingCm > 0 ? 'away' : 'in'}` : sw[0]}</td><td>${tn[1] ? `${tn[0]}° ${b.turnDeg > 0 ? 'away' : 'in'}` : tn[0]}</td>`
      + `<td>${b.length === null ? 'Full toss' : lengthName(b.length)}</td></tr>`;
  }
  $('sessTable').innerHTML = `<table><thead><tr><th>#</th><th>Result</th><th class="num">Ball ${unit()}</th><th class="num">Bat ${unit()}</th><th>Swing</th><th>Turn</th><th>Length</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------- session maps
const describeBall = (b, i) => `Ball ${i + 1} \u00b7 ${spd(b.speed).toFixed(0)} ${unit()} \u00b7 ${b.length == null ? 'full toss' : lengthName(b.length).toLowerCase()}, ${b.line == null ? '' : lineName(b.line).toLowerCase()}`;
const pitchMap = new MapView($('pitchMap'), 'pitch', $('mapTip'), describeBall);
const stumpMap = new MapView($('stumpMap'), 'stumps', $('mapTip'), describeBall);
function renderMaps() {
  const B = S.balls, mapped = B.filter((b) => b.sz != null);
  $('mapsCard').hidden = !mapped.length;
  if (!mapped.length) return;
  const opts = { hand: F.hand, L: settings.L };
  pitchMap.draw(B, opts); stumpMap.draw(B, opts);
  const full = mapped.filter((b) => b.length == null).length;
  $('pitchNote').textContent = full ? `${full} full toss${full > 1 ? 'es' : ''} not shown (never pitched).` : 'Tap a dot for that ball.';
}

// ---------------------------------------------------------------- field views
const mini = new FieldView($('miniField'), F);
const big = new FieldView($('bigField'), F, (f, done) => { if (done) { F.preset = 'custom'; syncField(); save(); } });
big.editable = true;
function syncField() {
  const sel = $('preset');
  sel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')
    + (F.preset === 'custom' ? '<option value="custom">Custom field</option>' : '');
  sel.value = F.preset;
  document.querySelectorAll('#handSeg button').forEach((b) => b.classList.toggle('on', b.dataset.hand === F.hand));
  $('bnd').value = F.boundary; $('bndTxt').textContent = `${F.boundary} m`;
  big.shots = S.balls.filter((x) => x.path);
  big.draw(); mini.draw();
}
$('preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  F.preset = e.target.value; F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
  syncField(); save();
});
$('handSeg').addEventListener('click', (e) => {
  const h = e.target.dataset.hand;
  if (!h || h === F.hand) return;
  F.hand = h; F.fielders.forEach((f) => { f.x = -f.x; });     // mirror the field for the other hand
  syncField(); save();
});
$('bnd').addEventListener('input', (e) => {
  F.boundary = +e.target.value;
  if (F.preset !== 'custom') F.fielders = makeField(F.preset, F.hand, F.L, F.boundary);
  syncField(); save();
});

// ---------------------------------------------------------------- controls
function syncControls() {
  const has = !!S.source, demo = has && S.source.kind === 'demo';
  $('calBtn').disabled = !has || demo;
  $('calBtn').textContent = S.calibrating ? 'Done' : 'Calibrate pitch';
  $('calBtn').classList.toggle('primary', S.calibrating);
  $('armBtn').disabled = !has;
  $('calModeSeg').hidden = !S.calibrating;
  $('sCal').value = settings.calMode;
  document.querySelectorAll('#calModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.calMode));
  $('armBtn').textContent = S.armed ? 'Pause tracking' : 'Resume tracking';
  view.style.touchAction = S.calibrating ? 'none' : 'auto';
  updatePill();
}
$('srcSeg').addEventListener('click', (e) => {
  const k = e.target.dataset.src;
  if (!k) return;
  if (k === 'file') $('fileIn').click(); else setSource(k);
});
$('calModeSeg').addEventListener('click', (e) => {
  const m = e.target.dataset.mode;
  if (!m || m === settings.calMode) return;
  settings.calMode = m; detector.reset(); tracker.reset(); recalibrate(); save(); syncControls();
});
$('fileIn').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setSource('file', f); e.target.value = ''; });
$('calBtn').addEventListener('click', () => { S.calibrating = !S.calibrating; detector.reset(); tracker.reset(); if (!S.calibrating) save(); syncControls(); });
$('armBtn').addEventListener('click', () => { S.armed = !S.armed; detector.reset(); tracker.reset(); syncControls(); });
$('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear every ball in this session?')) return;
  S.balls = []; S.last = null; save(); renderResult(); renderScore(); renderSession(); syncField();
});
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.tab));
  syncField();
  renderMaps();
});

const bind = (id, key, parse, after) => {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => {
    const v = parse(el.value);
    if (!(v > 0) && typeof v !== 'string') { el.value = settings[key]; return; }
    settings[key] = v; save(); after && after();
  });
};
const geometryChanged = () => {
  F.L = settings.L;
  if (S.source && S.source.kind === 'demo') { setSource('demo'); return; }
  recalibrate(); syncField();
};
bind('sL', 'L', (v) => Math.min(25, Math.max(8, +v)), geometryChanged);
bind('sW', 'rectW', (v) => Math.min(6, Math.max(0.5, +v)), geometryChanged);
bind('sCal', 'calMode', String, () => { detector.reset(); tracker.reset(); recalibrate(); syncControls(); });
bind('sUnits', 'units', String, () => { renderResult(); renderSession(); });
bind('sSens', 'sens', (v) => Math.min(150, Math.max(15, +v)));
bind('sProc', 'procW', (v) => +v);
bind('sSlow', 'slowmo', (v) => Math.min(32, Math.max(1, +v)));

window.addEventListener('resize', () => { big.draw(); mini.draw(); renderMaps(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.source && navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
});

syncField(); syncControls(); renderScore(); renderSession();
window.__tracker = { S, F, settings };      // handy for debugging from the console
