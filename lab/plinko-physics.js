// Duck Drop (plinko): the board, the bounce physics and the payouts, with no graphics,
// so the odds can be measured by simulating drops (see odds() below).
//
// The board is flat: x across, y up, in meters. Twelve rows of pegs in a triangle (3 pegs
// on top, 14 on the bottom), so a ball lands in one of 13 buckets. Where it lands comes
// from the bounces themselves; the only randomness is a tiny wobble at the drop and on
// dead-center hits, so a ball never balances on top of a peg.

export const ROWS = 12;
export const BUCKETS = ROWS + 1;
export const SPACING = 0.06;          // between pegs in a row
export const ROW_H = 0.055;           // between rows
export const PEG_R = 0.008;
export const BALL_R = 0.016;
export const GRAVITY = 3.4;           // slowed down so you can watch it bounce (a drop takes about 3 s)
export const BOTTOM_Y = -(ROWS - 1) * ROW_H - ROW_H * 0.7;
const RESTITUTION = 0.42;
const FRICTION = 0.9;                 // share of sliding speed kept on a bounce
const DRAG = 0.12;
export const STEP = 1 / 240;          // physics substep, seconds

// Bucket payouts, as a multiple of the bet, left to right. Tuned against the measured
// landing odds so each risk level returns about 97% over the long run.
export const RISKS = {
  low: { label: 'Low', pays: [10, 3, 1.5, 1.3, 1, 0.9, 0.5, 0.9, 1, 1.3, 1.5, 3, 10] },
  medium: { label: 'Medium', pays: [27, 9, 3, 1.6, 0.9, 0.5, 0.3, 0.5, 0.9, 1.6, 3, 9, 27] },
  high: { label: 'High', pays: [100, 16, 5.5, 1.3, 0.5, 0.1, 0.1, 0.1, 0.5, 1.3, 5.5, 16, 100] },
};

export function pegLayout() {
  const rows = [];
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let k = 0; k < r + 3; k++) row.push({ i: i++, r, k, x: (k - (r + 2) / 2) * SPACING, y: -r * ROW_H });
    rows.push(row);
  }
  return rows;
}

export function makeBall(rand) {
  return { x: (rand() - 0.5) * SPACING * 0.3, y: ROW_H * 0.9, vx: (rand() - 0.5) * 0.05, vy: 0, done: false, bucket: -1 };
}

// The side walls run through the outermost pegs, so a ball can't fall off the board
function wallX(y) {
  return ((Math.max(0, -y / ROW_H) + 2) / 2) * SPACING;
}

/* Advance a ball by one substep. Calls onHit(peg, speed) for each peg it bounces off.
   Sets ball.done and ball.bucket when it falls past the last row. */
export function stepBall(ball, rows, rand, onHit) {
  const dt = STEP;
  ball.vy -= GRAVITY * dt;
  const drag = 1 - DRAG * dt;
  ball.vx *= drag;
  ball.vy *= drag;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const r = Math.round(-ball.y / ROW_H);
  if (r >= 0 && r < ROWS) {
    const row = rows[r];
    const near = Math.round(ball.x / SPACING + (r + 2) / 2);
    for (let k = near - 1; k <= near + 1; k++) {
      const p = row[k];
      if (!p) continue;
      const dx = ball.x - p.x, dy = ball.y - p.y;
      const R = BALL_R + PEG_R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-6;
      let nx = dx / d, ny = dy / d;
      if (Math.abs(nx) < 0.1) {          // dead center: tip it off one side or the other
        nx += rand() < 0.5 ? -0.1 : 0.1;
        const l = Math.hypot(nx, ny);
        nx /= l;
        ny /= l;
      }
      ball.x = p.x + nx * R;
      ball.y = p.y + ny * R;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= (1 + RESTITUTION) * vn * nx;
        ball.vy -= (1 + RESTITUTION) * vn * ny;
        const tx = -ny, ty = nx;
        const vt = ball.vx * tx + ball.vy * ty;
        ball.vx -= (1 - FRICTION) * vt * tx;
        ball.vy -= (1 - FRICTION) * vt * ty;
        if (onHit) onHit(p, -vn);
      }
    }
  }

  const w = wallX(ball.y) - BALL_R;
  if (ball.x > w) { ball.x = w; if (ball.vx > 0) ball.vx *= -0.4; }
  else if (ball.x < -w) { ball.x = -w; if (ball.vx < 0) ball.vx *= -0.4; }

  if (ball.y < BOTTOM_Y) {
    ball.done = true;
    ball.bucket = Math.min(BUCKETS - 1, Math.max(0, Math.round(ball.x / SPACING) + (BUCKETS - 1) / 2));
  }
  return ball;
}

// Drop n balls without drawing anything; returns how often each bucket came up
export function simulate(n, rand = Math.random) {
  const rows = pegLayout();
  const counts = new Array(BUCKETS).fill(0);
  let steps = 0;
  for (let i = 0; i < n; i++) {
    const b = makeBall(rand);
    let s = 0;
    while (!b.done && s < 240 * 30) { stepBall(b, rows, rand); s++; }
    steps += s;
    counts[b.done ? b.bucket : (BUCKETS - 1) / 2]++;
  }
  return { counts, seconds: steps / n / 240 };
}

// The long-run return of each risk level, given simulated bucket frequencies
export function odds(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  const out = {};
  for (const [key, { pays }] of Object.entries(RISKS)) out[key] = pays.reduce((a, m, i) => a + (m * counts[i]) / n, 0);
  return out;
}
