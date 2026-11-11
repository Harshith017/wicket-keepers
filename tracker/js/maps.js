// Session maps: where each ball pitched, and where it reached the stumps.
// Ball coordinates are stored relative to the batter (+x = off side); they are
// drawn as seen from behind the bowler, matching the field view.

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
const LENGTHS = [[0, 2, 'Yorker'], [2, 6, 'Full'], [6, 8, 'Good'], [8, 10, 'Short'], [10, 99, 'Bouncer']];

export class MapView {
  /** kind: 'pitch' | 'stumps'. describe(ball, index) -> tooltip text. */
  constructor(canvas, kind, tip, describe) {
    this.canvas = canvas; this.kind = kind; this.tip = tip; this.describe = describe;
    this.dots = []; this.hot = -1;
    const pick = (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let bi = -1, bd = 18;
      this.dots.forEach((d, i) => { const q = Math.hypot(d.x - x, d.y - y); if (q < bd) { bd = q; bi = i; } });
      if (bi !== this.hot) { this.hot = bi; this.render(); }
      if (bi < 0) { tip.hidden = true; return; }
      const d = this.dots[bi], host = tip.offsetParent.getBoundingClientRect();
      tip.textContent = this.describe(d.ball, d.index);
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(host.width - tw - 4, r.left - host.left + d.x - tw / 2)) + 'px';
      tip.style.top = (r.top - host.top + d.y - tip.offsetHeight - 12) + 'px';
    };
    canvas.addEventListener('pointermove', pick);
    canvas.addEventListener('pointerdown', pick);
    canvas.addEventListener('pointerleave', () => { this.hot = -1; tip.hidden = true; this.render(); });
  }
  draw(balls, opts) { this.balls = balls; this.opts = opts; this.render(); }
  render() {
    const cv = this.canvas, r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !this.balls) return;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    this.dots = [];
    if (this.kind === 'pitch') this.pitch(c, r.width, r.height); else this.stumps(c, r.width, r.height);
    const col = (n) => css(cv, n), last = this.balls.length - 1;
    // dots: surface ring so overlaps stay readable; hollow = missing the stumps (stumps map only)
    this.dots.forEach((d, i) => {
      const latest = d.index === last, hot = i === this.hot, rad = hot ? 7.5 : latest ? 6.5 : 5;
      c.beginPath(); c.arc(d.x, d.y, rad + 2, 0, 7); c.fillStyle = col('--map-surface'); c.fill();
      c.beginPath(); c.arc(d.x, d.y, rad, 0, 7);
      const ink = latest ? col('--map-latest') : col('--map-dot');
      if (d.hollow) { c.lineWidth = 2.5; c.strokeStyle = ink; c.stroke(); } else { c.fillStyle = ink; c.fill(); }
    });
  }
  label(c, text, x, y, align = 'left') {
    c.font = '600 10.5px Inter, system-ui, sans-serif'; c.textAlign = align; c.textBaseline = 'middle';
    c.fillStyle = css(this.canvas, '--map-ink'); c.fillText(text, x, y);
  }
  pitch(c, w, h) {
    const col = (n) => css(this.canvas, n), o = this.opts;
    const yMax = Math.min(12, o.L - 1), top = 26, bot = 8, gutter = 58;
    const px = gutter, pw = w - gutter - 10, ph = h - top - bot;
    const X = (xw) => px + pw / 2 - xw * (pw / 3.4), Y = (y) => top + (y + 0.5) / (yMax + 0.5) * ph;
    // length bands, alternating two close tints of the pitch
    LENGTHS.forEach(([a, b, name], i) => {
      if (a >= yMax) return;
      const y0 = Y(Math.max(a, -0.5)), y1 = Y(Math.min(b, yMax));
      c.fillStyle = col(i % 2 ? '--map-band-b' : '--map-band-a');
      c.fillRect(px, i === 0 ? top : y0, pw, (i === 0 ? y1 - top : y1 - y0));
      this.label(c, name, px - 8, (Math.max(y0, top) + y1) / 2, 'right');
    });
    // crease and stumps at the striker's end
    c.strokeStyle = col('--map-line'); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(px, Y(1.22)); c.lineTo(px + pw, Y(1.22)); c.stroke();
    c.fillStyle = col('--map-ink');
    for (const sx of [-0.1143, 0, 0.1143]) c.fillRect(X(sx) - 1.5, Y(0) - 4, 3, 8);
    const offLeft = o.hand !== 'L';
    this.label(c, offLeft ? 'Off' : 'Leg', px + 4, 12); this.label(c, offLeft ? 'Leg' : 'Off', px + pw - 4, 12, 'right');
    this.label(c, 'Batter', px + pw / 2, 12, 'center');
    this.balls.forEach((b, index) => {
      if (b.length == null || b.bx == null) return;
      const xw = b.bx * (b.hand === 'L' ? -1 : 1);
      this.dots.push({ x: Math.max(px + 5, Math.min(px + pw - 5, X(xw))), y: Math.min(Y(yMax) - 5, Y(b.length)), ball: b, index });
    });
  }
  stumps(c, w, h) {
    const col = (n) => css(this.canvas, n), o = this.opts;
    const top = 26, bot = 22, px = 10, pw = w - 20, ph = h - top - bot, zMax = 2, half = 1.3;
    const X = (xw) => px + pw / 2 - xw * (pw / (2 * half)), Z = (z) => top + ph - z / zMax * ph;
    c.fillStyle = col('--map-band-a'); c.fillRect(px, top, pw, ph);
    // faint height guides every half metre
    c.strokeStyle = col('--map-line'); c.lineWidth = 1; c.globalAlpha = 0.35;
    for (const z of [0.5, 1, 1.5]) { c.beginPath(); c.moveTo(px, Z(z)); c.lineTo(px + pw, Z(z)); c.stroke(); }
    c.globalAlpha = 1;
    for (const z of [1, 2]) this.label(c, z + ' m', px + 4, Z(z) + (z === 2 ? 8 : -7));
    c.fillStyle = col('--map-ink'); c.fillRect(px, Z(0), pw, 2);
    c.fillStyle = col('--map-stump');
    for (const sx of [-0.1143, 0, 0.1143]) { const wpx = Math.max(3, 0.038 * pw / (2 * half)); c.fillRect(X(sx) - wpx / 2, Z(0.711), wpx, Z(0) - Z(0.711)); }
    const offLeft = o.hand !== 'L';
    this.label(c, offLeft ? 'Off' : 'Leg', px + 4, 12); this.label(c, offLeft ? 'Leg' : 'Off', px + pw - 4, 12, 'right');
    this.label(c, 'Seen from the bowler', px + pw / 2, h - 9, 'center');
    this.balls.forEach((b, index) => {
      if (b.line == null || b.sz == null) return;
      const xw = b.line * (b.hand === 'L' ? -1 : 1);
      this.dots.push({
        x: Math.max(px + 5, Math.min(px + pw - 5, X(xw))), y: Math.max(top + 5, Math.min(Z(0) - 5, Z(b.sz))),
        ball: b, index, hollow: !b.hitting,
      });
    });
  }
}
