// Field model: fielder placement, presets, position names and the top-down drawing.
// Positions are in the pitch frame (origin at the striker's stumps, +y toward the bowler).

const rad = Math.PI / 180;

// Presets for a right-hander as [angle, distance] from the striker:
// angle 0 = straight back past the bowler, positive = off side, 180 = behind the wicket.
export const PRESETS = {
  balanced: { label: 'Balanced', keeper: 9, f: [[165, 13], [88, 26], [55, 27], [18, 26], [-18, 26], [-58, 27], [-92, 24], [150, 55], [-150, 55]] },
  attacking: { label: 'Attacking (pace)', keeper: 10, f: [[168, 12], [162, 13.5], [156, 15], [128, 15], [90, 25], [55, 27], [18, 27], [-20, 27], [-150, 55]] },
  defensive: { label: 'Defensive (death overs)', keeper: 9, f: [[150, 58], [88, 62], [58, 62], [18, 64], [-18, 64], [-58, 63], [-95, 60], [-140, 28], [45, 27]] },
  spin: { label: 'Spin', keeper: 2.5, f: [[165, 4.5], [-70, 4], [90, 24], [55, 26], [20, 25], [-20, 25], [-60, 26], [-95, 58], [-15, 62]] },
};

export function clampInside(f, L, boundary) {
  const cy = L / 2, d = Math.hypot(f.x, f.y - cy), max = boundary - 1.5;
  if (d > max) { f.x *= max / d; f.y = cy + (f.y - cy) * max / d; }
}

export function makeField(presetKey, hand, L, boundary) {
  const p = PRESETS[presetKey] || PRESETS.balanced, off = hand === 'L' ? -1 : 1;
  const fielders = [
    { id: 'wk', role: 'keeper', x: 0, y: -p.keeper },
    { id: 'bw', role: 'bowler', x: 0.9 * off, y: L - 2.5 },
  ];
  p.f.forEach(([a, d], i) => fielders.push({ id: 'f' + i, x: off * d * Math.sin(a * rad), y: d * Math.cos(a * rad) }));
  fielders.forEach((f) => clampInside(f, L, boundary));
  return fielders;
}

/** Conventional name for a spot on the field. */
export function positionName(f, hand) {
  if (f.role === 'keeper') return 'Wicketkeeper';
  if (f.role === 'bowler') return 'Bowler';
  const off = hand === 'L' ? -1 : 1;
  const d = Math.hypot(f.x, f.y), a = Math.atan2(f.x * off, f.y) / rad, A = Math.abs(a), offSide = a >= 0;
  const close = d < 9, ring = d < 34;
  if (A >= 172) return close || d < 16 ? 'Short stop' : 'Long stop';
  if (offSide) {
    if (A < 30) return close ? 'Silly mid-off' : ring ? 'Mid-off' : 'Long-off';
    if (A < 50) return close ? 'Silly mid-off' : ring ? 'Extra cover' : 'Deep extra cover';
    if (A < 72) return close ? 'Silly point' : ring ? 'Cover' : 'Deep cover';
    if (A < 100) return close ? 'Silly point' : ring ? 'Point' : 'Deep point';
    if (A < 135) return d < 17 ? 'Gully' : ring ? 'Backward point' : 'Deep backward point';
    return d < 17 ? 'Slip' : ring ? 'Short third' : 'Third man';
  }
  if (A < 30) return close ? 'Silly mid-on' : ring ? 'Mid-on' : 'Long-on';
  if (A < 72) return close ? 'Short leg' : ring ? 'Midwicket' : 'Deep midwicket';
  if (A < 105) return close ? 'Short leg' : ring ? 'Square leg' : 'Deep square leg';
  if (A < 138) return d < 17 ? 'Leg gully' : ring ? 'Backward square leg' : 'Deep backward square';
  return d < 17 ? 'Leg slip' : ring ? 'Short fine leg' : 'Fine leg';
}

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

/**
 * Top-down field view. Striker at the top, bowler below - the way you see it
 * from behind the bowler's arm, so a right-hander's off side is on the left.
 */
export class FieldView {
  constructor(canvas, state, onChange) {
    this.canvas = canvas; this.state = state; this.onChange = onChange;
    this.editable = false; this.shots = []; this.highlight = null; this.drag = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
  }
  geom() {
    const r = this.canvas.getBoundingClientRect();
    const size = Math.min(r.width, r.height);
    const s = (size / 2 - 14) / this.state.boundary;
    return { r, s, cx: r.width / 2, cy: r.height / 2 };
  }
  toScreen(x, y, g) { return [g.cx - x * g.s, g.cy + (y - this.state.L / 2) * g.s]; }
  toWorld(px, py, g) { return [-(px - g.cx) / g.s, (py - g.cy) / g.s + this.state.L / 2]; }
  down(e) {
    if (!this.editable) return;
    const g = this.geom(), px = e.clientX - g.r.left, py = e.clientY - g.r.top;
    let best = null, bd = 26;
    for (const f of this.state.fielders) {
      const [sx, sy] = this.toScreen(f.x, f.y, g), d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { this.drag = best; this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); this.draw(); }
  }
  move(e) {
    if (!this.drag) return;
    const g = this.geom();
    const [x, y] = this.toWorld(e.clientX - g.r.left, e.clientY - g.r.top, g);
    this.drag.x = x; this.drag.y = y;
    clampInside(this.drag, this.state.L, this.state.boundary);
    this.draw();
    this.onChange && this.onChange(this.drag, false);
  }
  up() { if (this.drag) { const f = this.drag; this.drag = null; this.draw(); this.onChange && this.onChange(f, true); } }

  draw() {
    const cv = this.canvas, g = this.geom(), dpr = window.devicePixelRatio || 1;
    if (!g.r.width) return;
    if (cv.width !== Math.round(g.r.width * dpr) || cv.height !== Math.round(g.r.height * dpr)) {
      cv.width = Math.round(g.r.width * dpr); cv.height = Math.round(g.r.height * dpr);
    }
    const c = cv.getContext('2d'), st = this.state, L = st.L;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, g.r.width, g.r.height);
    const col = (n) => css(cv, n);
    // outfield + rope
    c.beginPath(); c.arc(g.cx, g.cy, st.boundary * g.s, 0, 7);
    c.fillStyle = col('--turf'); c.fill();
    c.lineWidth = 3; c.strokeStyle = col('--rope'); c.stroke();
    // 30-yard circle (two semicircles joined)
    const R30 = 27.43 * g.s, [ax, ay] = this.toScreen(0, 0, g), [, by] = this.toScreen(0, L, g);
    c.beginPath(); c.arc(ax, ay, R30, Math.PI, 0); c.lineTo(ax + R30, by); c.arc(ax, by, R30, 0, Math.PI); c.closePath();
    c.setLineDash([4, 5]); c.lineWidth = 1; c.strokeStyle = col('--ring'); c.stroke(); c.setLineDash([]);
    // pitch
    const pw = Math.max(5, 3.05 * g.s);
    c.fillStyle = col('--pitch'); c.fillRect(ax - pw / 2, ay - 1.5 * g.s, pw, (L + 3) * g.s);
    c.fillStyle = col('--ink'); c.fillRect(ax - 3, ay - 1, 6, 2); c.fillRect(ax - 3, by - 1, 6, 2);
    // labels for orientation
    c.font = '600 10px Inter, system-ui, sans-serif'; c.fillStyle = col('--turf-ink'); c.textAlign = 'center';
    const offLeft = st.hand !== 'L';
    c.fillText(offLeft ? 'OFF' : 'LEG', g.cx - st.boundary * g.s * 0.72, g.cy + 3);
    c.fillText(offLeft ? 'LEG' : 'OFF', g.cx + st.boundary * g.s * 0.72, g.cy + 3);
    // earlier shots (wagon wheel)
    for (const sh of this.shots) {
      const hot = sh === this.highlight;
      if (hot) continue;
      this.path(c, g, sh, col, 0.35, 1.5);
    }
    if (this.highlight) this.path(c, g, this.highlight, col, 1, 3);
    // fielders
    for (const f of st.fielders) {
      const [sx, sy] = this.toScreen(f.x, f.y, g);
      const special = f.role === 'keeper' || f.role === 'bowler';
      const hit = this.highlight && this.highlight.by === f.id;
      c.beginPath(); c.arc(sx, sy, this.drag === f ? 10 : 7, 0, 7);
      c.fillStyle = hit ? col('--brass') : special ? col('--ink') : col('--chip');
      c.fill(); c.lineWidth = 2; c.strokeStyle = col('--chip-edge'); c.stroke();
      if (this.editable || hit) {
        c.font = '600 10px Inter, system-ui, sans-serif'; c.fillStyle = col('--turf-ink'); c.textAlign = 'center';
        c.fillText(positionName(f, st.hand), sx, sy + (sy > g.cy + st.boundary * g.s * 0.8 ? -12 : 19));
      }
    }
  }
  path(c, g, sh, col, alpha, width) {
    if (!sh.path || sh.path.length < 2) return;
    c.globalAlpha = alpha;
    c.beginPath();
    sh.path.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1], g); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.lineWidth = width; c.lineJoin = 'round';
    c.strokeStyle = sh.outcome === 'SIX' ? col('--six') : sh.outcome === 'FOUR' ? col('--four') : sh.outcome === 'CAUGHT' ? col('--out') : col('--run');
    c.stroke();
    const e = sh.path[sh.path.length - 1], [ex, ey] = this.toScreen(e[0], e[1], g);
    c.beginPath(); c.arc(ex, ey, width + 1.5, 0, 7); c.fillStyle = c.strokeStyle; c.fill();
    c.globalAlpha = 1;
  }
}
