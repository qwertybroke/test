#!/usr/bin/env node
// VESPER Explorer — procedural PBR texture generator.
//   node src/textures.mjs --out build/Textures [--only A,B] [--scale 0.5] [--jobs 4] [--no-preview]
// Each task runs in its own child process (parallel); results are merged into manifest.json.
// Conventions: BaseColor sRGB; ORM = R:AO G:roughness B:metallic (linear); Normal = OpenGL/glTF (+Y up);
// MetallicSmoothness = Unity (RGB metallic, A = 1 - roughness). Image top = world up where it matters.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  RNG, fbm, white, blur, normalFromHeight, cavityAO, convexity, dripDown, forDisk, forRect, rectDist,
  roundRectDist, canvasMasks, writeSet, registerFonts, getSharp, clamp, lerp, ss, mod, rgb, hash3,
} from './texlib.mjs';

const SELF = fileURLToPath(import.meta.url);

function dims(size, scale) {
  const W = Math.max(64, Math.round(size * scale));
  return { W, H: W, N: W * W, S: W / size };
}
function normalize(f) {
  let m = 0;
  for (let i = 0; i < f.length; i++) m += f[i];
  m /= f.length;
  let v = 0;
  for (let i = 0; i < f.length; i++) v += (f[i] - m) ** 2;
  const k = 1 / Math.sqrt(v / f.length || 1);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - m) * k;
  return f;
}
const F = (N, v = 0) => new Float32Array(N).fill(v);
const ch3 = (N) => [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
function mix3(out, i, c, t) {
  out[0][i] += (c[0] - out[0][i]) * t;
  out[1][i] += (c[1] - out[1][i]) * t;
  out[2][i] += (c[2] - out[2][i]) * t;
}
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Stamp a dome rivet / screw head into height (max-combined) and a wear mask.
function stampRivet(hgt, wear, w, h, x, y, r, amp, kind = 'dome') {
  forDisk(w, h, x, y, r * 1.8, (i, dx, dy, d) => {
    if (wear) wear[i] = Math.max(wear[i], ss(r * 1.8, r * 0.8, d));
    if (d > r + 0.5) return;
    const t = clamp(d / r);
    let v;
    if (kind === 'dome') v = amp * Math.sqrt(Math.max(0, 1 - t * t));
    else if (kind === 'flat') v = amp * ss(1, 0.75, t);
    else if (kind === 'counter') v = -amp * 0.6 * (1 - t) + (Math.abs(dx) < r * 0.16 || Math.abs(dy) < r * 0.16 ? -amp * 0.4 : 0) * (t < 0.7 ? 1 : 0);
    else { // screw: flat head with cross slot
      v = amp * ss(1, 0.7, t);
      if (t < 0.65 && (Math.abs(dx) < r * 0.14 || Math.abs(dy) < r * 0.14)) v -= amp * 0.7;
    }
    v *= ss(r + 0.5, r - 0.5, d);
    if (kind === 'counter') hgt[i] += v; else hgt[i] = Math.max(hgt[i], hgt[i] + v);
  });
}

// Scratch descriptors, drawn as thin slightly curved strokes.
// Scratches are mostly grouped in clusters sharing a direction (like real handling / abrasion marks).
function makeScratches(R, n, W, H, o = {}) {
  const { len = [0.02, 0.1], wid = [0.6, 1.2], op = [0.25, 0.8], dir = null, spread = Math.PI, region = null, clusters = Math.max(1, Math.round(n / 12)), crad = 0.08 * W } = o;
  const ry = () => (region ? R.range(region[0], region[1]) : R.range(0, H));
  const ra = () => (dir === null ? R.range(0, Math.PI * 2) : dir + R.range(-spread, spread));
  const cl = Array.from({ length: clusters }, () => ({ x: R.range(0, W), y: ry(), a: ra(), r: crad * R.range(0.4, 1.2) }));
  const out = [];
  for (let k = 0; k < n; k++) {
    let x, y, a;
    if (R.chance(0.8)) { const c = R.pick(cl); x = c.x + R.range(-1, 1) * c.r; y = c.y + R.range(-0.6, 0.6) * c.r; a = c.a + R.range(-0.2, 0.2); }
    else { x = R.range(0, W); y = ry(); a = ra(); }
    const L = R.range(len[0], len[1]) * (R.chance(0.7) ? R.range(0.3, 0.7) : 1);
    out.push({ x, y, dx: Math.cos(a) * L, dy: Math.sin(a) * L, bend: R.range(-0.04, 0.04) * L, w: R.range(wid[0], wid[1]), o: R.range(op[0], op[1]) });
  }
  return out;
}
function drawScratches(g, list, chan = 0) {
  g.lineCap = 'round';
  const c = [0, 0, 0]; c[chan] = 255;
  for (const s of list) {
    const L = Math.hypot(s.dx, s.dy) || 1, nx = -s.dy / L, ny = s.dx / L;
    const mx = s.x + s.dx / 2 + nx * s.bend, my = s.y + s.dy / 2 + ny * s.bend;
    // tapered: faint thin full stroke + stronger middle section
    for (const [t0, t1, wk, ok] of [[0, 1, 0.55, 0.6], [0.2, 0.75, 1, 1]]) {
      const p = (t) => [(1 - t) ** 2 * s.x + 2 * (1 - t) * t * mx + t * t * (s.x + s.dx), (1 - t) ** 2 * s.y + 2 * (1 - t) * t * my + t * t * (s.y + s.dy)];
      g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${s.o * ok})`;
      g.lineWidth = s.w * wk;
      g.beginPath();
      const [ax, ay] = p(t0); g.moveTo(ax, ay);
      for (let q = 1; q <= 4; q++) { const [bx, by] = p(t0 + (t1 - t0) * q / 4); g.lineTo(bx, by); }
      g.stroke();
    }
  }
}

// Generic panel rasteriser. panels: {x0,y0,x1,y1, ch?, rr?, plate, raise?, inset?:{m, depth, ch}}
function rasterPanels(W, H, panels, { gap, bev, round = false }) {
  const N = W * H, hgt = F(N), pid = new Int32Array(N).fill(-1), edge = F(N, 0);
  panels.forEach((p, k) => {
    forRect(W, H, p.x0, p.y0, p.x1, p.y1, (i, px, py) => {
      const d = p.rr ? roundRectDist(px, py, p.x0, p.y0, p.x1, p.y1, p.rr) : rectDist(px, py, p.x0, p.y0, p.x1, p.y1, p.ch || 0);
      if (d < 0) return;
      let v = round ? p.plate * Math.sin(Math.PI / 2 * ss(gap, gap + bev, d)) : p.plate * ss(gap, gap + bev, d);
      if (p.raise) v += p.raise * ss(gap, gap + bev * 2.5, d);
      if (p.inset) {
        const q = p.inset;
        const d2 = q.rr ? roundRectDist(px, py, p.x0 + q.m, p.y0 + q.m, p.x1 - q.m, p.y1 - q.m, q.rr)
          : rectDist(px, py, p.x0 + q.m, p.y0 + q.m, p.x1 - q.m, p.y1 - q.m, q.ch || 0);
        v += q.depth * ss(-(q.bev || bev) * 0.5, (q.bev || bev) * 0.5, d2);
      }
      hgt[i] = v; pid[i] = k; edge[i] = d;
    });
  });
  return { hgt, pid, edge };
}

// ============================================================ VESPER lettering
function emblemPath(g, x, y, s) {
  const P = (pts) => { g.moveTo(x + pts[0][0] * s, y + pts[0][1] * s); for (let k = 1; k < pts.length; k++) g.lineTo(x + pts[k][0] * s, y + pts[k][1] * s); g.closePath(); };
  g.beginPath();
  P([[0.02, 0.12], [0.22, 0.12], [0.5, 0.74], [0.5, 0.95]]);
  P([[0.98, 0.12], [0.78, 0.12], [0.5, 0.74], [0.5, 0.95]]);
  P([[0.31, 0.12], [0.43, 0.12], [0.5, 0.29], [0.57, 0.12], [0.69, 0.12], [0.5, 0.6]]);
}
const LETTER_W = { V: 1.0, E: 0.82, S: 0.86, P: 0.8, R: 0.86 };
function drawLetter(g, ch, x, y, L) {
  const w = LETTER_W[ch] * L, t = 0.085 * L, c = t / 2, r = 0.2 * L;
  g.save(); g.translate(x, y);
  g.lineWidth = t; g.lineCap = 'butt'; g.lineJoin = 'miter';
  if (ch === 'V') {
    const tw = t * 1.12, tb = t * 2.2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(tw, 0); g.lineTo(w / 2, L - tb); g.lineTo(w - tw, 0); g.lineTo(w, 0); g.lineTo(w / 2, L); g.closePath(); g.fill();
  } else if (ch === 'E') {
    g.fillRect(0, 0, w, t); g.fillRect(w * 0.1, L / 2 - t / 2, w * 0.8, t); g.fillRect(0, L - t, w, t);
  } else if (ch === 'S') {
    const r2 = Math.min(r, (L / 2 - c) * 0.9);
    g.beginPath(); g.moveTo(w, c); g.arcTo(c, c, c, L / 2, r2); g.arcTo(c, L / 2, w - c, L / 2, r2 * 0.6);
    g.arcTo(w - c, L / 2, w - c, L - c, r2 * 0.6); g.arcTo(w - c, L - c, 0, L - c, r2); g.lineTo(0, L - c); g.stroke();
  } else if (ch === 'P' || ch === 'R') {
    const yb = 0.56 * L;
    g.beginPath(); g.moveTo(c, L); g.lineTo(c, c); g.arcTo(w - c, c, w - c, yb, r * 0.9); g.arcTo(w - c, yb, c, yb, r * 0.9); g.lineTo(c, yb); g.stroke();
    if (ch === 'R') { g.beginPath(); g.moveTo(w * 0.42, yb); g.lineTo(w - c * 0.6, L); g.stroke(); }
  }
  g.restore();
  return w;
}
function wordWidth(word, L, sp) { let s = 0; for (const ch of word) s += LETTER_W[ch] * L; return s + (word.length - 1) * sp; }
function drawWord(g, word, x, y, L, sp) { let cx = x; for (const ch of word) { cx += drawLetter(g, ch, cx, y, L) + sp; } }
function spacedText(g, str, cx, y, size, font, totalW) {
  g.font = `${size}px ${font}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const ws = [...str].map((c) => g.measureText(c).width), sum = ws.reduce((a, b) => a + b, 0);
  const sp = str.length > 1 ? (totalW - sum) / (str.length - 1) : 0;
  let x = cx - totalW / 2;
  [...str].forEach((c, k) => { g.fillText(c, x, y); x += ws[k] + sp; });
}
// Full logo: emblem + VESPER + EXPLORER, fitted into box (x,y,w,h).
function drawLogo(g, x, y, w, h, col, withEmblem = true) {
  g.fillStyle = col; g.strokeStyle = col;
  const L = h * 0.42, sp = 0.4 * L;
  const ww = wordWidth('VESPER', L, sp);
  const es = withEmblem ? h * 0.78 : 0, gapE = withEmblem ? h * 0.16 : 0;
  const total = es + gapE + ww;
  const k = Math.min(1, (w * 0.94) / total);
  g.save(); g.translate(x + w / 2, y + h / 2); g.scale(k, k); g.translate(-total / 2, -h / 2);
  if (withEmblem) { emblemPath(g, 0, h * 0.1, es); g.fill(); }
  const wx = es + gapE, wy = h * 0.16;
  drawWord(g, 'VESPER', wx, wy, L, sp);
  const ey = wy + L + 0.62 * L, size = 0.3 * L, tw = ww * 0.62;
  spacedText(g, 'EXPLORER', wx + ww / 2, ey, size, 'VSans', tw);
  const lw = Math.max(1.5, L * 0.025), ly = ey - size * 0.36;
  g.fillRect(wx, ly - lw / 2, (ww - tw) / 2 - L * 0.18, lw);
  g.fillRect(wx + (ww + tw) / 2 + L * 0.18, ly - lw / 2, (ww - tw) / 2 - L * 0.18, lw);
  g.restore();
}

// ============================================================ HULL (3 variants, shared layout)
const HULL_VARIANTS = {
  HullPanel_Light: { paint: rgb(196, 199, 202), prim: rgb(58, 61, 66), bare: rgb(148, 151, 156), grime: rgb(112, 108, 100), dust: rgb(166, 162, 154), vent: rgb(40, 42, 46), pr: 0.52, pm: 0.08, cr: 0.3, cm: 0.9, tone: 0.035 },
  HullPanel_Mid: { paint: rgb(105, 108, 113), prim: rgb(206, 208, 209), bare: rgb(152, 155, 160), grime: rgb(62, 60, 57), dust: rgb(118, 115, 108), vent: rgb(28, 29, 32), pr: 0.5, pm: 0.12, cr: 0.3, cm: 0.9, tone: 0.045 },
  HullPanel_Dark: { paint: rgb(30, 32, 36), prim: rgb(166, 169, 173), bare: rgb(104, 108, 115), grime: rgb(50, 48, 45), dust: rgb(60, 58, 55), vent: rgb(12, 13, 15), pr: 0.35, pm: 0.55, cr: 0.27, cm: 0.95, tone: 0.07 },
};
const RED = rgb(168, 46, 40), YEL = rgb(214, 168, 44);
const HULL_WORDS = ['NO STEP', 'VX-07', 'VX-984', 'DSE-01', 'A-12', 'B-07', 'C-31', 'MAINT', 'LH2', 'N2', 'O2', 'CAUTION', 'KEEP CLEAR', 'LIFT', 'EXT PWR', '984', '07', 'NO PUSH', 'VENT', 'SERVICE', 'RCS-4', 'DOCK', 'EVA', 'GND', 'H-22', 'FRAME 41', 'STA 112'];

async function genHull(job) {
  const { W, H, N, S } = dims(2048, job.scale);
  const PX = W / 8, U = W / 32;
  const R = new RNG(984001);
  const splitSeq = (total, min, max) => { const out = []; let rem = total; while (rem > max) { const v = R.int(min, Math.min(max, rem - min)); out.push(v); rem -= v; } out.push(rem); return out; };
  const cells = [];
  const kd = (r, d) => {
    if (d < 3) {
      const canV = r.w >= 7, canH = r.h >= 7;
      if (canV && (r.w >= r.h || !canH) && R.chance(0.55)) { const s = R.int(3, r.w - 3); kd({ ...r, w: s }, d + 1); kd({ ...r, x: r.x + s, w: r.w - s }, d + 1); return; }
      if (canH && R.chance(0.5)) { const s = R.int(3, r.h - 3); kd({ ...r, h: s }, d + 1); kd({ ...r, y: r.y + s, h: r.h - s }, d + 1); return; }
    }
    if (r.w >= 4 && r.h >= 4 && r.w <= 8 && r.h <= 8 && R.chance(0.14)) {
      const sx = R.int(2, r.w - 2), sy = R.int(2, r.h - 2);
      cells.push({ x: r.x, y: r.y, w: sx, h: sy }, { x: r.x + sx, y: r.y, w: r.w - sx, h: sy }, { x: r.x, y: r.y + sy, w: r.w, h: r.h - sy });
      return;
    }
    cells.push(r);
  };
  let yy = R.int(0, 31);
  for (const rh of splitSeq(32, 6, 12)) {
    let xx = R.int(0, 31);
    for (const rw of splitSeq(32, 4, 12)) { kd({ x: xx, y: yy, w: rw, h: rh }, 0); xx += rw; }
    yy += rh;
  }
  const panels = cells.map((c) => {
    const p = { x0: c.x * U, y0: c.y * U, x1: (c.x + c.w) * U, y1: (c.y + c.h) * U, uw: c.w, uh: c.h };
    p.tone = R.chance(0.1) ? R.range(-2.4, 2.4) : R.range(-1, 1);
    p.raise = R.range(-0.6, 0.9) * S;
    p.plate = 4 * S;
    p.ch = R.chance(0.3) ? R.pick([0.05, 0.08, 0.12]) * PX : 0;
    if (c.w >= 5 && c.h >= 5 && R.chance(0.35)) p.inset = { m: R.range(0.1, 0.2) * PX, depth: (R.chance(0.6) ? -1.4 : 1.1) * S, ch: R.chance(0.5) ? 0.07 * PX : 0, bev: 3 * S };
    return p;
  });
  const { hgt: hp, pid } = rasterPanels(W, H, panels, { gap: 2.0 * S, bev: 3.2 * S });

  // ---- features (planned once, drawn 9x for wrap)
  registerFonts();
  const mctx = createCanvas(8, 8).getContext('2d');
  const hf = [], marks = [], rivets = [];
  const place = (p, w, h, m) => {
    const ax = p.x0 + m + w / 2, bx = p.x1 - m - w / 2, ay = p.y0 + m + h / 2, by = p.y1 - m - h / 2;
    if (bx < ax || by < ay) return null;
    return [Math.round(R.range(ax, bx)), Math.round(R.range(ay, by))];
  };
  const C = [0, 0, 0, 0, 0, 0, 0, 1, 2];
  for (const p of panels) {
    const pw = p.x1 - p.x0, ph = p.y1 - p.y0;
    const mIn = p.inset ? p.inset.m : 0;
    const margin = 0.07 * PX + mIn;
    let rivRow = false;
    if (R.chance(0.42)) {
      rivRow = true;
      const ins = p.inset ? p.inset.m * 0.5 : 0.05 * PX;
      const sp = R.pick([0.07, 0.09, 0.11]) * PX, rr = R.pick([0.011, 0.014]) * PX;
      const horiz = pw >= ph ? R.chance(0.8) : R.chance(0.25);
      if (horiz) {
        const n = Math.floor((pw - 2 * ins) / sp), x0 = p.x0 + (pw - n * sp) / 2;
        for (const y of [p.y0 + ins, p.y1 - ins]) for (let k = 0; k <= n; k++) rivets.push([x0 + k * sp, y, rr, 'dome']);
      } else {
        const n = Math.floor((ph - 2 * ins) / sp), y0 = p.y0 + (ph - n * sp) / 2;
        for (const x of [p.x0 + ins, p.x1 - ins]) for (let k = 0; k <= n; k++) rivets.push([x, y0 + k * sp, rr, 'dome']);
      }
    }
    if (!rivRow && R.chance(0.35)) {
      const ins = 0.045 * PX + (p.ch ? p.ch * 0.4 : 0), rr = 0.016 * PX;
      for (const [x, y] of [[p.x0 + ins, p.y0 + ins], [p.x1 - ins, p.y0 + ins], [p.x0 + ins, p.y1 - ins], [p.x1 - ins, p.y1 - ins]]) rivets.push([x, y, rr, 'screw']);
    }
    // hatch
    if (!p.inset && pw >= 1.0 * PX && ph >= 0.9 * PX && R.chance(0.24)) {
      const hw = Math.round(R.range(0.45, Math.min(1.2, pw / PX - 0.35)) * PX), hh = Math.round(R.range(0.4, Math.min(1.0, ph / PX - 0.35)) * PX);
      const pos = place(p, hw, hh, 0.12 * PX);
      if (pos) {
        const x = pos[0] - hw / 2, y = pos[1] - hh / 2;
        const f = { t: 'hatch', x, y, w: hw, h: hh, r: 0.035 * PX, lw: 2.4 * S, latches: [], hinges: [] };
        const lw = 0.11 * PX, lh = 0.05 * PX, side = R.pick(['l', 'r', 't', 'b']);
        const vertSide = side === 'l' || side === 'r';
        for (const q of [0.25, 0.75]) {
          let lx, ly, w2 = vertSide ? lh : lw, h2 = vertSide ? lw : lh;
          if (vertSide) { lx = side === 'l' ? x + 0.05 * PX : x + hw - 0.05 * PX - w2; ly = y + hh * q - h2 / 2; }
          else { ly = side === 't' ? y + 0.05 * PX : y + hh - 0.05 * PX - h2; lx = x + hw * q - w2 / 2; }
          const bt = 0.014 * PX;
          f.latches.push({ x: lx, y: ly, w: w2, h: h2, r: Math.min(w2, h2) * 0.3, bx: vertSide ? lx + w2 / 2 - bt / 2 : lx + w2 * 0.15, by: vertSide ? ly + h2 * 0.15 : ly + h2 / 2 - bt / 2, bw: vertSide ? bt : w2 * 0.7, bh: vertSide ? h2 * 0.7 : bt });
          let hx, hy; const hgw = vertSide ? 0.03 * PX : 0.09 * PX, hgh = vertSide ? 0.09 * PX : 0.03 * PX;
          if (vertSide) { hx = side === 'l' ? x + hw - hgw / 2 : x - hgw / 2; hy = y + hh * q - hgh / 2; }
          else { hy = side === 't' ? y + hh - hgh / 2 : y - hgh / 2; hx = x + hw * q - hgw / 2; }
          f.hinges.push({ x: hx, y: hy, w: hgw, h: hgh });
        }
        hf.push(f);
        if (R.chance(0.6)) {
          const s = R.pick(['ACCESS', 'MAINT', 'SERVICE', 'EXT PWR', 'H-22', 'PANEL 7', 'FILL']), size = Math.round(0.045 * PX);
          marks.push({ t: 'text', s, x: x + hw / 2, y: y - size * 1.1, size, font: 'VSansBold', c: 0 });
        }
        if (R.chance(0.35)) marks.push({ t: 'frame', x: x - 0.025 * PX, y: y - 0.025 * PX, w: hw + 0.05 * PX, h: hh + 0.05 * PX, lw: 0.012 * PX, c: R.pick([0, 2]) });
        continue;
      }
    }
    // vents
    if (pw >= 0.8 * PX && ph >= 0.5 * PX && R.chance(0.14)) {
      const vert = R.chance(0.3);
      const n = R.int(4, 9), L = Math.round(R.range(0.22, Math.min(0.6, (vert ? ph : pw) / PX - 0.3)) * PX), sh = 0.028 * PX, gp = 0.06 * PX;
      const gw = vert ? n * gp : L, gh = vert ? L : n * gp;
      const pos = place(p, gw, gh, 0.12 * PX + mIn);
      if (pos) {
        const x = pos[0] - gw / 2, y = pos[1] - gh / 2, slots = [];
        for (let k = 0; k < n; k++) slots.push(vert ? { x: x + k * gp + (gp - sh) / 2, y, w: sh, h: L } : { x, y: y + k * gp + (gp - sh) / 2, w: L, h: sh });
        const fm = 0.035 * PX;
        hf.push({ t: 'vent', slots, fx: x - fm, fy: y - fm, fw: gw + 2 * fm, fh: gh + 2 * fm, fr: 0.02 * PX, lw: 2 * S });
      }
    }
    // stencil text
    if (R.chance(0.3)) {
      const s = R.pick(HULL_WORDS), size = Math.round(R.pick([0.045, 0.06, 0.08, 0.1]) * PX), font = R.pick(['VSansBold', 'VMonoBold', 'FSansBold']);
      mctx.font = `${size}px ${font}`;
      const tw = mctx.measureText(s).width, rot = R.chance(0.2) ? -Math.PI / 2 : 0;
      const box = s === 'NO STEP' || R.chance(0.15);
      const bw = tw + size * 0.8;
      const pos = rot ? place(p, size * 1.6, bw, margin) : place(p, bw, size * 1.6, margin);
      if (pos) marks.push({ t: 'text', s, x: pos[0], y: pos[1], size, font, c: s === 'CAUTION' ? 2 : R.pick(C), rot, box, bw });
    }
    if (R.chance(0.12)) {
      const n = R.int(2, 3), size = R.range(0.04, 0.07) * PX, dir = R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      const pos = place(p, size * n * 1.2, size * 1.2, margin);
      if (pos) marks.push({ t: 'chev', x: pos[0], y: pos[1], n, size, rot: dir, c: R.pick([0, 0, 2]) });
    }
    if (R.chance(0.12)) {
      const w = Math.round(R.range(0.2, 0.34) * PX), h = Math.round(R.range(0.09, 0.15) * PX);
      const pos = place(p, w, h, margin);
      if (pos) {
        const lines = [];
        const nl = Math.max(2, Math.floor(h / (0.028 * PX)) - 1);
        for (let k = 0; k < nl; k++) lines.push(R.range(0.3, 0.9));
        hf.push({ t: 'plate', x: pos[0] - w / 2, y: pos[1] - h / 2, w, h });
        marks.push({ t: 'plate', x: pos[0], y: pos[1], w, h, lines, c: 0, bar: R.chance(0.4) ? Array.from({ length: 18 }, () => R.int(1, 3)) : null });
      }
    }
    if (R.chance(0.04)) {
      const s = 0.09 * PX, pos = place(p, s, s, margin);
      if (pos) marks.push({ t: 'tri', x: pos[0], y: pos[1], s, c: 2 });
    }
    if (pw >= 1.0 * PX && R.chance(0.1)) {
      const y = R.chance(0.5) ? p.y0 + margin : p.y1 - margin;
      marks.push({ t: 'stripe', x: p.x0 + margin, y, w: pw - 2 * margin, lw: 0.012 * PX, gap: 0.025 * PX, c: R.pick([0, 1]) });
    }
    if (!p.inset && Math.max(pw, ph) >= 1.4 * PX && R.chance(0.18)) {
      if (pw > ph) { const x = Math.round(R.range(p.x0 + 0.3 * PX, p.x1 - 0.3 * PX)); hf.push({ t: 'line', x0: x, y0: p.y0, x1: x, y1: p.y1, lw: 2.2 * S }); }
      else { const y = Math.round(R.range(p.y0 + 0.3 * PX, p.y1 - 0.3 * PX)); hf.push({ t: 'line', x0: p.x0, y0: y, x1: p.x1, y1: y, lw: 2.2 * S }); }
    }
  }
  const scratches = makeScratches(R, 320, W, H, { len: [0.02, 0.16].map((v) => v * PX), wid: [0.7 * S, 1.3 * S], op: [0.2, 0.65], dir: 0, spread: 0.6, clusters: 28, crad: 0.25 * PX });

  const [mGroove, mVent, mRaise] = canvasMasks(W, H, (g) => {
    for (const f of hf) {
      if (f.t === 'hatch') {
        g.strokeStyle = 'rgb(255,0,0)'; g.lineWidth = f.lw; g.beginPath(); g.roundRect(f.x, f.y, f.w, f.h, f.r); g.stroke();
        for (const l of f.latches) { g.fillStyle = 'rgb(0,150,0)'; g.beginPath(); g.roundRect(l.x, l.y, l.w, l.h, l.r); g.fill(); g.fillStyle = 'rgb(0,0,200)'; g.fillRect(l.bx, l.by, l.bw, l.bh); }
        g.fillStyle = 'rgb(0,0,150)'; for (const hg of f.hinges) g.fillRect(hg.x, hg.y, hg.w, hg.h);
      } else if (f.t === 'vent') {
        g.fillStyle = 'rgb(0,255,0)';
        for (const s of f.slots) { g.beginPath(); g.roundRect(s.x, s.y, s.w, s.h, Math.min(s.w, s.h) / 2); g.fill(); }
        g.strokeStyle = 'rgb(255,0,0)'; g.lineWidth = f.lw; g.beginPath(); g.roundRect(f.fx, f.fy, f.fw, f.fh, f.fr); g.stroke();
      } else if (f.t === 'line') {
        g.strokeStyle = 'rgb(255,0,0)'; g.lineWidth = f.lw; g.beginPath(); g.moveTo(f.x0, f.y0); g.lineTo(f.x1, f.y1); g.stroke();
      } else if (f.t === 'plate') { g.fillStyle = 'rgb(0,0,128)'; g.fillRect(f.x, f.y, f.w, f.h); }
    }
  });
  const COLS = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)'];
  const [mkA, mkR, mkY] = canvasMasks(W, H, (g) => {
    for (const f of marks) {
      g.save(); g.translate(f.x, f.y); if (f.rot) g.rotate(f.rot);
      const col = COLS[f.c]; g.fillStyle = col; g.strokeStyle = col;
      if (f.t === 'text') {
        g.font = `${f.size}px ${f.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.s, 0, f.size * 0.04);
        if (f.box) { g.lineWidth = Math.max(1, f.size * 0.08); g.strokeRect(-f.bw / 2, -f.size * 0.72, f.bw, f.size * 1.44); }
      } else if (f.t === 'chev') {
        const s = f.size;
        for (let k = 0; k < f.n; k++) {
          const ox = (k - (f.n - 1) / 2) * s * 1.1;
          g.beginPath(); g.moveTo(ox - s * 0.45, -s * 0.5); g.lineTo(ox - s * 0.1, -s * 0.5); g.lineTo(ox + s * 0.4, 0); g.lineTo(ox - s * 0.1, s * 0.5); g.lineTo(ox - s * 0.45, s * 0.5); g.lineTo(ox + s * 0.05, 0); g.closePath(); g.fill();
        }
      } else if (f.t === 'plate') {
        g.fillStyle = 'rgb(55,0,0)'; g.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
        g.fillStyle = col; g.lineWidth = Math.max(1, 1.6 * S); g.strokeRect(-f.w / 2 + 3 * S, -f.h / 2 + 3 * S, f.w - 6 * S, f.h - 6 * S);
        const lh = Math.max(1, 2.2 * S), step = (f.h - 12 * S) / f.lines.length;
        f.lines.forEach((l, k) => g.fillRect(-f.w / 2 + 8 * S, -f.h / 2 + 7 * S + k * step, (f.w * 0.55) * l, lh));
        if (f.bar) { let bx = f.w * 0.12; for (const b of f.bar) { g.fillRect(bx, -f.h / 2 + 8 * S, b * S, f.h - 16 * S); bx += (b + 2) * S; } }
      } else if (f.t === 'tri') {
        const s = f.s; g.lineJoin = 'round'; g.lineWidth = s * 0.08;
        g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(s * 0.55, s * 0.45); g.lineTo(-s * 0.55, s * 0.45); g.closePath(); g.fill();
        g.fillStyle = COLS[0]; g.fillRect(-s * 0.05, -s * 0.2, s * 0.1, s * 0.38); g.fillRect(-s * 0.05, s * 0.26, s * 0.1, s * 0.1);
      } else if (f.t === 'frame') {
        g.lineWidth = f.lw; g.setLineDash([f.lw * 4, f.lw * 3]); g.strokeRect(0, 0, f.w, f.h);
      } else if (f.t === 'stripe') {
        g.fillRect(0, -f.lw / 2, f.w, f.lw); g.fillRect(0, -f.lw / 2 + f.gap, f.w, f.lw * 0.6);
      }
      g.restore();
    }
  });
  const [mScr] = canvasMasks(W, H, (g) => drawScratches(g, scratches, 0));

  // ---- height
  const gB = blur(mGroove, W, H, 0.6 * S, 0.6 * S, 2), vB = blur(mVent, W, H, 0.7 * S, 0.7 * S, 2), rB = blur(mRaise, W, H, 0.7 * S, 0.7 * S, 2);
  const h0 = F(N), rivW = F(N);
  for (let i = 0; i < N; i++) h0[i] = hp[i] - 2.4 * S * gB[i] - 5.5 * S * vB[i] + 1.4 * S * rB[i];
  for (const [x, y, r, kind] of rivets) stampRivet(h0, rivW, W, H, x, y, r, kind === 'dome' ? 1.6 * S : 1.4 * S, kind);

  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 11 });
  const nMid = fbm(W, H, { fx: 12, oct: 4, seed: 12 });
  const nHi = fbm(W, H, { fx: 64, oct: 3, seed: 13 });
  const nFine = fbm(W, H, { fx: 256, oct: 2, seed: 14 });
  const nStreak = fbm(W, H, { fx: 96, fy: 3, oct: 3, seed: 15 });

  const conv = convexity(h0, W, H, 2.5 * S);
  const chip = F(N), scuff = F(N), markWear = F(N);
  for (let i = 0; i < N; i++) {
    const e = clamp(conv[i] / (1.1 * S));
    const v = e * 0.55 + nHi[i] * 0.34 + nFine[i] * 0.16 + nLow[i] * 0.12;
    let c = ss(0.6, 0.66, v);
    c = Math.max(c, ss(0.86, 0.9, 0.42 + nHi[i] * 0.5 + nFine[i] * 0.3) * ss(0.05, 0.35, nLow[i] + nMid[i] * 0.3));
    c = Math.max(c, rivW[i] * ss(0.32, 0.42, nFine[i] + nHi[i] * 0.5));
    chip[i] = c;
    scuff[i] = ss(0.42, 0.62, v) * (1 - c);
    markWear[i] = ss(0.15, 0.6, nHi[i] * 0.6 + nFine[i] * 0.7);
  }
  const hgt = F(N);
  const peel = fbm(W, H, { fx: 384, oct: 2, seed: 16 });
  for (let i = 0; i < N; i++) hgt[i] = h0[i] - 0.45 * S * chip[i] - 0.15 * S * mScr[i] + 0.05 * S * peel[i];
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.1 / S }, { r: 6 * S, k: 0.085 / S }, { r: 20 * S, k: 0.05 / S }], 0.12);
  const normal = normalFromHeight(hgt, W, H, 1.0);

  // grime
  const cavB = blur(hgt, W, H, 7 * S);
  const grimeC = F(N), src = F(N);
  for (let i = 0; i < N; i++) {
    const c = cavB[i] - hgt[i];
    grimeC[i] = ss(0.4 * S, 2.6 * S, c) * (0.65 + 0.35 * nMid[i]);
    src[i] = ss(0.8 * S, 2.5 * S, c) * clamp(0.6 + nHi[i]) + ss(0.5, 1, vB[i]);
  }
  const drip = dripDown(src, W, H, Math.exp(-1 / (0.55 * PX)));
  const streak = blur(drip, W, H, 1.5 * S, 3 * S, 2);
  for (let i = 0; i < N; i++) streak[i] = clamp(streak[i] * clamp(0.35 + nStreak[i] * 0.9) ** 2 * 1.5) * ss(-0.35, 0.45, nLow[i] + 0.5 * nMid[i]);
  const ptone = F(N);
  for (let i = 0; i < N; i++) ptone[i] = pid[i] >= 0 ? panels[pid[i]].tone : 0;
  const ventC = F(N);
  for (let i = 0; i < N; i++) ventC[i] = ss(0.4, 0.95, vB[i]) * 0.9;

  const out = {};
  for (const name of job.want) {
    const V = HULL_VARIANTS[name];
    const base = ch3(N), rough = F(N), metal = F(N);
    const scuffC = [lerp(V.paint[0], V.bare[0], 0.35), lerp(V.paint[1], V.bare[1], 0.35), lerp(V.paint[2], V.bare[2], 0.35)];
    for (let i = 0; i < N; i++) {
      const tone = 1 + V.tone * ptone[i] + 0.03 * nLow[i] + 0.015 * nMid[i] + 0.01 * nFine[i];
      base[0][i] = V.paint[0] * tone; base[1][i] = V.paint[1] * tone; base[2][i] = V.paint[2] * tone;
      let ro = V.pr + 0.045 * nMid[i] + 0.02 * nFine[i], me = V.pm;
      const wk = 1 - 0.6 * markWear[i];
      let t = mkA[i] * 0.95 * wk; if (t > 0) { mix3(base, i, V.prim, t); ro += (V.pr - 0.06 - ro) * t; }
      t = mkR[i] * 0.92 * wk; if (t > 0) { mix3(base, i, RED, t); ro += (V.pr - 0.06 - ro) * t; me += (0.05 - me) * t; }
      t = mkY[i] * 0.92 * wk; if (t > 0) { mix3(base, i, YEL, t); ro += (V.pr - 0.06 - ro) * t; me += (0.05 - me) * t; }
      t = ventC[i]; if (t > 0) { mix3(base, i, V.vent, t); ro += (0.6 - ro) * t; }
      t = mScr[i] * 0.6; if (t > 0) { mix3(base, i, V.bare, t * 0.7); ro += 0.08 * t; me += (0.6 - me) * t * 0.5; }
      t = scuff[i] * 0.35; if (t > 0) { mix3(base, i, scuffC, t); ro += 0.05 * t; }
      t = chip[i]; if (t > 0) { mix3(base, i, scale3(V.bare, 1 + 0.08 * nFine[i]), t); ro += (V.cr - ro) * t; me += (V.cm - me) * t; }
      t = clamp(grimeC[i] * 0.55 + streak[i] * 0.32); if (t > 0) { mix3(base, i, V.grime, t); ro += 0.14 * t; me *= 1 - 0.3 * t; }
      t = clamp(0.5 + nLow[i] * 0.9) * 0.14; mix3(base, i, V.dust, t); ro += 0.05 * t;
      rough[i] = clamp(ro, 0.04, 1); metal[i] = clamp(me);
    }
    out[name] = await job.write(name, { w: W, h: H, base, ao, rough, metal, normal, tileMeters: [8, 8] });
  }
  return out;
}

// ============================================================ METAL_DARK
async function genMetalDark(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2, R = new RNG(5501);
  const brush = normalize(blur(white(W, H, 77), W, H, 40 * S, 0, 2));
  const brush2 = normalize(fbm(W, H, { fx: 2, fy: 192, oct: 3, seed: 21 }));
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 22 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 23 }), nHi = fbm(W, H, { fx: 48, oct: 3, seed: 24 });
  const scr = makeScratches(R, 520, W, H, { len: [0.005, 0.07].map((v) => v * PX), wid: [0.5 * S, 1.1 * S], op: [0.15, 0.6] });
  const scrL = makeScratches(R, 70, W, H, { len: [0.1, 0.5].map((v) => v * PX), wid: [0.5 * S, 0.9 * S], op: [0.12, 0.35], dir: 0, spread: 0.12 });
  const [mS] = canvasMasks(W, H, (g) => { drawScratches(g, scr); drawScratches(g, scrL); });
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  const C0 = rgb(50, 52, 57), CS = rgb(118, 121, 127), CW = rgb(84, 87, 93), CG = rgb(34, 34, 35);
  for (let i = 0; i < N; i++) {
    const b = brush[i] * 0.6 + brush2[i] * 0.4;
    const k = 1 + 0.05 * b + 0.04 * nMid[i] + 0.03 * nLow[i];
    base[0][i] = C0[0] * k; base[1][i] = C0[1] * k; base[2][i] = C0[2] * k;
    let ro = 0.38 + 0.035 * b + 0.04 * nMid[i], me = 0.85;
    const wear = ss(0.5, 0.8, nLow[i] * 0.5 + nMid[i] * 0.4 + nHi[i] * 0.3 + 0.25);
    mix3(base, i, CW, wear * 0.5); ro += (0.3 - ro) * wear * 0.6;
    const s = mS[i]; mix3(base, i, CS, s * 0.75); ro += 0.06 * s; me += 0.1 * s;
    const gr = ss(0.2, 0.7, -nLow[i] * 0.6 - nMid[i] * 0.3) * 0.45; mix3(base, i, CG, gr); ro += 0.08 * gr; me -= 0.15 * gr;
    rough[i] = clamp(ro, 0.25, 0.6); metal[i] = clamp(me);
    hgt[i] = b * 0.06 * S - mS[i] * 0.35 * S + nHi[i] * 0.05 * S;
  }
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.2 / S }], 0.6);
  return { Metal_Dark: await job.write('Metal_Dark', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [2, 2] }) };
}

// ============================================================ GREEBLE_TECH
async function genGreeble(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const R = new RNG(7331), U = 16 * S, NU = 64;
  const cells = [];
  const kd = (r, d) => {
    const maxS = d < 1 ? 0 : R.pick([4, 5, 6, 8, 10, 14]);
    if ((r.w > maxS || r.h > maxS) && (r.w >= 4 || r.h >= 4)) {
      const vert = r.w >= 4 && (r.w > r.h || r.h < 4 || (r.w === r.h && R.chance(0.5)));
      if (vert) { const s = R.int(2, r.w - 2); kd({ ...r, w: s }, d + 1); kd({ ...r, x: r.x + s, w: r.w - s }, d + 1); }
      else { const s = R.int(2, r.h - 2); kd({ ...r, h: s }, d + 1); kd({ ...r, y: r.y + s, h: r.h - s }, d + 1); }
      return;
    }
    cells.push(r);
  };
  kd({ x: R.int(0, NU - 1), y: R.int(0, NU - 1), w: NU, h: NU }, 0);
  const types = [['plate', 2.2], ['vent', 2], ['fins', 1.2], ['conduit', 1.3], ['port', 1], ['grille', 1], ['box', 1.6], ['light', 0.7], ['hazard', 0.35]];
  const tsum = types.reduce((a, t) => a + t[1], 0);
  const pickType = () => { let v = R.f() * tsum; for (const [t, w] of types) { v -= w; if (v <= 0) return t; } return 'plate'; };
  const hgt = F(N), mat = new Uint8Array(N), cid = new Int32Array(N);
  const bolts = [];
  const info = cells.map((c, k) => {
    const x0 = c.x * U, y0 = c.y * U, x1 = (c.x + c.w) * U, y1 = (c.y + c.h) * U;
    const cw = x1 - x0, chh = y1 - y0, long = cw >= chh;
    let type = pickType();
    if (Math.min(cw, chh) < 40 * S && (type === 'port' || type === 'conduit')) type = 'vent';
    const o = { x0, y0, x1, y1, cw, chh, long, type, lvl: R.int(0, 5) * 1.7 * S, ch: R.chance(0.4) ? R.pick([4, 8, 12]) * S : 0,
      g0: R.chance(0.22) ? R.range(0.17, 0.24) : R.range(0.3, 0.45), rough: R.range(0.38, 0.6), metal: R.chance(0.3) ? R.range(0.6, 0.8) : R.range(0.15, 0.35),
      period: R.pick([7, 9, 11, 14]) * S, npipe: R.int(2, 4), dots: R.int(1, 3), dotCol: R.pick([2, 3, 6, 6]), m: R.range(0.15, 0.25) };
    if ((type === 'plate' || type === 'box') && Math.min(cw, chh) >= 44 * S) {
      const ins = 7 * S + o.ch * 0.4;
      for (const [x, y] of [[x0 + ins, y0 + ins], [x1 - ins, y0 + ins], [x0 + ins, y1 - ins], [x1 - ins, y1 - ins]]) bolts.push([x, y, 3.4 * S, R.pick(['dome', 'screw', 'flat'])]);
    }
    if (type === 'conduit') { const n = Math.floor((long ? cw : chh) / (50 * S)); for (let q = 1; q < n; q++) o.clamps = (o.clamps || []).concat([q / n]); }
    return o;
  });
  info.forEach((c, k) => {
    forRect(W, H, c.x0, c.y0, c.x1, c.y1, (i, px, py) => {
      const d = rectDist(px, py, c.x0, c.y0, c.x1, c.y1, c.ch);
      if (d < 0) { hgt[i] = 0; mat[i] = 1; cid[i] = k; return; }
      const lx = px - c.x0, ly = py - c.y0;
      const a = c.long ? lx : ly, b = c.long ? ly : lx, A = c.long ? c.cw : c.chh, B = c.long ? c.chh : c.cw;
      const top = c.lvl + 3 * S;
      let v = top * ss(1 * S, 2.6 * S, d), m = d < 1.2 * S ? 1 : 0;
      const inner = d - 4 * S;
      if (inner > 0) {
        switch (c.type) {
          case 'vent': {
            const ra = rectDist(px, py, c.x0 + 6 * S, c.y0 + 6 * S, c.x1 - 6 * S, c.y1 - 6 * S, 0);
            if (ra > 0) { const t = mod(a, c.period) / c.period; const sl = ss(0.18, 0.28, Math.abs(t - 0.5) < 0.3 ? 0.3 - Math.abs(t - 0.5) : 0) * ss(0, 2 * S, ra); v -= 5 * S * sl; if (sl > 0.5) m = 1; }
            break;
          }
          case 'fins': {
            const t = mod(b, c.period) / c.period, r = Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 2), 0.5);
            v += 3.5 * S * r * ss(0, 3 * S, inner); if (r < 0.15) m = 1; else m = 4;
            break;
          }
          case 'conduit': {
            const fl = c.lvl - 2 * S; v = Math.min(v, fl + (top - fl) * ss(2 * S, 0, inner));
            if (inner > 2 * S) { m = 1; v = fl; }
            const pitch = (B - 12 * S) / c.npipe, rr = pitch * 0.42;
            for (let q = 0; q < c.npipe; q++) {
              const cc = 6 * S + pitch * (q + 0.5), dd = Math.abs(b - cc);
              let r2 = rr;
              if (c.clamps) for (const cl of c.clamps) if (Math.abs(a - cl * A) < 3 * S) r2 = rr * 1.18;
              if (dd < r2) { const pv = fl + Math.sqrt(r2 * r2 - dd * dd) * 1.1; if (pv > v) { v = pv; m = (q % 2) ? 4 : 0; if (r2 > rr) m = 4; } }
            }
            break;
          }
          case 'port': {
            const cx = c.cw / 2, cy = c.chh / 2, rad = Math.min(c.cw, c.chh) * 0.36, r = Math.hypot(lx - cx, ly - cy) / rad;
            if (r < 1.12) {
              v += 1.8 * S * ss(1.12, 1.0, r) * ss(0.78, 0.86, r);
              if (r < 0.8) { v -= 3.5 * S * ss(0.8, 0.74, r); m = 1; }
              if (r < 0.32) { v += 4.5 * S * ss(0.32, 0.27, r); m = 4; }
              if (r < 0.12) v -= 1.2 * S;
            }
            break;
          }
          case 'grille': {
            const p = 6.5 * S, ra = rectDist(px, py, c.x0 + 6 * S, c.y0 + 6 * S, c.x1 - 6 * S, c.y1 - 6 * S, 0);
            if (ra > 0) { const qx = mod(lx, p) - p / 2, qy = mod(ly, p) - p / 2, rr = Math.hypot(qx, qy); if (rr < 2.1 * S) { v -= 4 * S * ss(2.1 * S, 1.4 * S, rr); m = 1; } }
            break;
          }
          case 'box': {
            const mm = Math.min(c.cw, c.chh) * c.m, d2 = rectDist(px, py, c.x0 + mm, c.y0 + mm, c.x1 - mm, c.y1 - mm, mm * 0.5);
            v += 4.5 * S * ss(-1 * S, 1.5 * S, d2);
            break;
          }
          case 'light': {
            for (let q = 0; q < c.dots; q++) {
              const cx = c.long ? c.cw * (q + 1) / (c.dots + 1) : c.cw / 2, cy = c.long ? c.chh / 2 : c.chh * (q + 1) / (c.dots + 1);
              const rr = Math.min(5 * S, Math.min(c.cw, c.chh) * 0.18), dd = Math.hypot(lx - cx, ly - cy);
              if (dd < rr * 1.5) { v -= 1.2 * S * ss(rr * 1.5, rr * 1.3, dd); m = 1; }
              if (dd < rr) { v += 2.2 * S * Math.sqrt(1 - (dd / rr) ** 2); m = c.dotCol; }
            }
            break;
          }
          case 'hazard': {
            const t = mod((lx + ly) / (10 * S), 1); m = t < 0.5 ? 2 : 5;
            break;
          }
          default: break;
        }
      }
      hgt[i] = v; mat[i] = m; cid[i] = k;
    });
  });
  const bw = F(N);
  for (const [x, y, r, k] of bolts) forDisk(W, H, x, y, r, (i) => { mat[i] = 4; }), stampRivet(hgt, bw, W, H, x, y, r, 2 * S, k);
  const nMid = fbm(W, H, { fx: 8, oct: 4, seed: 31 }), nHi = fbm(W, H, { fx: 64, oct: 3, seed: 32 }), nFine = fbm(W, H, { fx: 192, oct: 2, seed: 33 });
  const conv = convexity(hgt, W, H, 2 * S);
  const cav = blur(hgt, W, H, 5 * S);
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.09 / S }, { r: 5 * S, k: 0.06 / S }, { r: 16 * S, k: 0.035 / S }], 0.1);
  const base = ch3(N), rough = F(N), metal = F(N);
  const MC = { 1: rgb(22, 23, 25), 2: rgb(212, 166, 40), 3: rgb(176, 42, 36), 4: rgb(138, 141, 146), 5: rgb(30, 30, 32), 6: rgb(232, 122, 34) };
  for (let i = 0; i < N; i++) {
    const c = info[cid[i]], m = mat[i];
    const k = 1 + 0.04 * nMid[i] + 0.02 * nFine[i];
    let col = m === 0 ? [c.g0 * 0.97 * k, c.g0 * 0.99 * k, c.g0 * 1.03 * k] : scale3(MC[m], k);
    base[0][i] = col[0]; base[1][i] = col[1]; base[2][i] = col[2];
    let ro = m === 1 ? 0.7 : m === 4 ? 0.32 : m === 2 || m === 3 || m === 5 || m === 6 ? 0.45 : c.rough, me = m === 1 ? 0.2 : m === 4 ? 0.9 : m >= 2 ? 0.1 : c.metal;
    ro += 0.04 * nMid[i];
    const e = clamp(conv[i] / (1.2 * S)), w = ss(0.62, 0.7, e * 0.6 + nHi[i] * 0.35 + nFine[i] * 0.2) * (m === 1 ? 0 : 1);
    mix3(base, i, rgb(150, 153, 158), w); ro += (0.3 - ro) * w; me += (0.9 - me) * w;
    const gr = ss(0.5 * S, 3 * S, cav[i] - hgt[i]) * (0.6 + 0.4 * nMid[i]);
    mix3(base, i, rgb(40, 38, 35), gr * 0.5); ro += 0.12 * gr;
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  const h2 = F(N); for (let i = 0; i < N; i++) h2[i] = hgt[i] + nFine[i] * 0.06 * S;
  return { Greeble_Tech: await job.write('Greeble_Tech', { w: W, h: H, base, ao, rough, metal, height: h2, normalStrength: 1.3, tileMeters: [2, 2] }) };
}

// ============================================================ ENGINE_METAL
async function genEngine(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 3, R = new RNG(4242);
  const nWarp = fbm(W, H, { fx: 4, fy: 2, oct: 3, seed: 41 }), nLow = fbm(W, H, { fx: 3, oct: 3, seed: 42 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 43 });
  const nHi = fbm(W, H, { fx: 48, oct: 3, seed: 44 }), nStr = fbm(W, H, { fx: 40, fy: 2, oct: 3, seed: 45 });
  // circumferential machining marks along U: fine, low amplitude
  const brush = normalize(blur(white(W, H, 46), W, H, 24 * S, 0, 2));
  for (let i = 0; i < N; i++) brush[i] *= 0.6;
  const brush2 = normalize(fbm(W, H, { fx: 2, fy: 128, oct: 2, seed: 47 }));
  for (let i = 0; i < N; i++) brush[i] += brush2[i] * 0.4;
  // heat-tint palette (temper colours), cyclic so V tiles: steel → straw → bronze → purple → blue → grey-blue → steel
  const stops = [[0, rgb(128, 127, 126)], [0.14, rgb(170, 148, 104)], [0.27, rgb(160, 118, 82)], [0.4, rgb(122, 84, 108)], [0.53, rgb(80, 92, 138)], [0.68, rgb(104, 118, 138)], [0.84, rgb(124, 126, 130)], [1, rgb(128, 127, 126)]];
  const pal = (t) => { t = mod(t, 1); for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { const a = stops[k - 1], b = stops[k], u = ss(0, 1, (t - a[0]) / (b[0] - a[0])); return [lerp(a[1][0], b[1][0], u), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u)]; } return stops[0][1]; };
  const rows = 4, RH = H / rows, segs = 4;
  const hgt = F(N), base = ch3(N), rough = F(N), metal = F(N), weld = F(N);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / RH), ly = mod(y + 0.5, RH), ds = Math.min(ly, RH - ly);
    const xo = (row % 2) * W / (segs * 2);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = mod(x + 0.5 - xo, W / segs), dv = Math.min(lx, W / segs - lx);
      let v = -2.6 * S * ss(2.6 * S, 1.2 * S, ds) - 1.8 * S * ss(1.8 * S, 0.8 * S, dv) * ss(2 * S, 4 * S, ds);
      const wb = ds > 2.6 * S && ds < 9 * S && ly > RH / 2 ? Math.sin(Math.PI * (ds - 2.6 * S) / (6.4 * S)) : 0;
      v += wb * (1.1 + 0.5 * nHi[i]) * S; weld[i] = wb;
      hgt[i] = v + brush[i] * 0.04 * S + nHi[i] * 0.04 * S;
    }
  }
  const bw = F(N);
  for (let r = 0; r < rows; r++) { const n = 24; for (let k = 0; k < n; k++) stampRivet(hgt, bw, W, H, (k + 0.5) * W / n, r * RH + 12 * S, 3 * S, 1.5 * S, 'dome'); }
  for (let i = 0; i < N; i++) {
    const y = Math.floor(i / W);
    const t = (y + 0.5) / H * 2 + 0.1 * nWarp[i] + 0.04 * nMid[i];
    const heat = pal(t), steel = rgb(128, 127, 126);
    const amt = 0.55 + 0.25 * clamp(0.5 + nLow[i]);
    const k = 1 + 0.035 * brush[i] + 0.04 * nMid[i] + 0.02 * nHi[i];
    base[0][i] = lerp(steel[0], heat[0], amt) * k; base[1][i] = lerp(steel[1], heat[1], amt) * k; base[2][i] = lerp(steel[2], heat[2], amt) * k;
    let ro = 0.33 + 0.03 * brush[i] + 0.05 * nMid[i], me = 1;
    const w = weld[i]; mix3(base, i, rgb(92, 88, 84), w * 0.55); ro += 0.15 * w;
    // soot: soft cloudy deposits with faint lengthwise flow streaks
    const sv = nLow[i] * 0.55 + nMid[i] * 0.35 + nHi[i] * 0.12 + nStr[i] * 0.18;
    const soot = ss(0.0, 0.7, sv) * 0.7;
    mix3(base, i, rgb(34, 32, 31), soot); ro += (0.72 - ro) * soot; me += (0.6 - me) * soot;
    rough[i] = clamp(ro, 0.2, 0.9); metal[i] = clamp(me);
  }
  const ao = cavityAO(hgt, W, H, [{ r: 2 * S, k: 0.12 / S }, { r: 8 * S, k: 0.05 / S }], 0.3);
  return { Engine_Metal: await job.write('Engine_Metal', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [3, 3] }) };
}

// ============================================================ DECALS atlas
async function genDecals(job) {
  registerFonts();
  const sc = job.scale, W = Math.round(2048 * sc), H = W, N = W * H;
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  g.scale(sc, sc);
  const DARK = 'rgb(30,33,37)', WHITE = 'rgb(232,233,229)';
  const cellsPx = {
    logo: [0, 0, 1536, 384], name_white: [0, 384, 1536, 384], emblem: [1536, 0, 512, 512], emblem_white: [1536, 512, 512, 512],
    hullnum: [0, 768, 768, 256], hullnum_white: [768, 768, 768, 256], reg: [0, 1024, 2048, 128], hazard: [0, 1152, 2048, 256],
    nostep: [0, 1408, 512, 256], arrow: [512, 1408, 512, 256], intake: [1024, 1408, 1024, 256],
  };
  const mainCol = {};
  drawLogo(g, 32, 24, 1472, 336, DARK); mainCol.logo = DARK;
  drawLogo(g, 32, 384 + 24, 1472, 336, WHITE); mainCol.name_white = WHITE;
  g.fillStyle = DARK; emblemPath(g, 1536 + 40, 40, 432); g.fill(); mainCol.emblem = DARK;
  g.fillStyle = WHITE; emblemPath(g, 1536 + 40, 512 + 40, 432); g.fill(); mainCol.emblem_white = WHITE;
  const hullnum = (x, y, col) => {
    g.save(); g.fillStyle = col; g.font = '200px FSansBold'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(x + 384, y + 132); g.scale(0.86, 1); g.fillText('VX-984', 0, 0);
    // stencil bridges
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const bx of [-262, -96, 72, 214, 356]) g.fillRect(bx - 5, -4, 10, 8);
    g.restore(); g.globalCompositeOperation = 'source-over';
  };
  hullnum(0, 768, DARK); mainCol.hullnum = DARK; hullnum(768, 768, WHITE); mainCol.hullnum_white = WHITE;
  g.fillStyle = DARK; g.textBaseline = 'middle';
  spacedText(g, 'DSE-01   VESPER   DEEP SPACE EXPLORER', 1024, 1024 + 64 + 22, 62, 'VSans', 1900); mainCol.reg = DARK;
  // hazard band (period 128 → tiles along U)
  g.save(); g.beginPath(); g.rect(0, 1152 + 16, 2048, 224); g.clip();
  g.fillStyle = 'rgb(222,172,34)'; g.fillRect(0, 1152 + 16, 2048, 224);
  g.fillStyle = 'rgb(28,28,30)';
  for (let x = -512; x < 2048 + 512; x += 128) { g.beginPath(); g.moveTo(x, 1152 + 16); g.lineTo(x + 64, 1152 + 16); g.lineTo(x + 64 + 224, 1152 + 240); g.lineTo(x + 224, 1152 + 240); g.closePath(); g.fill(); }
  g.restore(); mainCol.hazard = 'rgb(222,172,34)';
  // NO STEP
  g.strokeStyle = DARK; g.fillStyle = DARK; g.lineWidth = 12; g.strokeRect(40, 1408 + 40, 432, 176);
  const fit = (s, x, y, maxW, size, font, align) => {
    g.font = `${size}px ${font}`; const w = g.measureText(s).width;
    if (w > maxW) g.font = `${Math.floor(size * maxW / w)}px ${font}`;
    g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
  };
  fit('NO STEP', 256, 1408 + 130, 370, 96, 'VSansBold', 'center'); mainCol.nostep = DARK;
  // arrow
  g.beginPath(); g.moveTo(552, 1408 + 104); g.lineTo(820, 1408 + 104); g.lineTo(820, 1408 + 48); g.lineTo(980, 1408 + 128); g.lineTo(820, 1408 + 208); g.lineTo(820, 1408 + 152); g.lineTo(552, 1408 + 152); g.closePath(); g.fill();
  mainCol.arrow = DARK;
  // DANGER · INTAKE
  g.fillStyle = 'rgb(186,36,32)'; g.fillRect(1024 + 24, 1408 + 32, 976, 192);
  g.strokeStyle = 'rgb(236,234,228)'; g.lineWidth = 8; g.strokeRect(1024 + 40, 1408 + 48, 944, 160);
  g.fillStyle = 'rgb(236,234,228)';
  g.beginPath(); g.moveTo(1024 + 130, 1408 + 70); g.lineTo(1024 + 200, 1408 + 186); g.lineTo(1024 + 60, 1408 + 186); g.closePath(); g.fill();
  g.fillStyle = 'rgb(186,36,32)'; g.fillRect(1024 + 124, 1408 + 104, 12, 46); g.fillRect(1024 + 124, 1408 + 160, 12, 12);
  g.fillStyle = 'rgb(236,234,228)'; fit('DANGER · INTAKE', 1024 + 236, 1408 + 130, 720, 84, 'VSansBold', 'left');
  mainCol.intake = 'rgb(186,36,32)';

  const id = g.getImageData(0, 0, W, H).data;
  const nHi = fbm(W, H, { fx: 96, oct: 3, seed: 51 }), nMid = fbm(W, H, { fx: 24, oct: 3, seed: 52 });
  const base = ch3(N), alpha = F(N);
  const cells = {};
  const parse = (s) => s.match(/\d+/g).map(Number).map((v) => v / 255);
  for (const [name, r] of Object.entries(cellsPx)) {
    const [x, y, w, h] = r.map((v) => Math.round(v * sc));
    cells[name] = [x, y, w, h];
    const mc = parse(mainCol[name]);
    const worn = name === 'hazard' || name === 'nostep' || name === 'intake' || name === 'arrow' ? 1 : name.startsWith('hullnum') ? 0.6 : 0.25;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = yy * W + xx;
      let a = id[i * 4 + 3] / 255;
      const wear = ss(0.62, 0.7, nHi[i] * 0.6 + nMid[i] * 0.45 + 0.18) * worn;
      a *= 1 - wear;
      a *= 1 - 0.12 * worn * clamp(0.5 + nMid[i]);
      alpha[i] = a;
      if (id[i * 4 + 3] > 0) { base[0][i] = id[i * 4] / 255; base[1][i] = id[i * 4 + 1] / 255; base[2][i] = id[i * 4 + 2] / 255; }
      else { base[0][i] = mc[0]; base[1][i] = mc[1]; base[2][i] = mc[2]; }
    }
  }
  const rough = F(N, 0.5), metal = F(N, 0), ao = F(N, 1);
  return { Decals: await job.write('Decals', { w: W, h: H, base, alpha, ao, rough, metal, tileMeters: null, cells }) };
}

// ============================================================ interior helpers
function interiorWear(N, conv, S, nHi, nFine, nLow, amount = 1) {
  const chip = F(N);
  for (let i = 0; i < N; i++) {
    const e = clamp(conv[i] / (1.0 * S));
    chip[i] = ss(0.66, 0.72, e * 0.5 * amount + nHi[i] * 0.34 + nFine[i] * 0.18 + nLow[i] * 0.1);
  }
  return chip;
}

// ============================================================ WALL_PANEL / WALL_WHITE / WALL_INDUSTRIAL
async function genWalls(job) {
  const out = {};
  if (job.want.has('Wall_Panel')) out.Wall_Panel = await wallPanel(job, 'Wall_Panel');
  if (job.want.has('Wall_White')) out.Wall_White = await wallWhite(job);
  if (job.want.has('Wall_Industrial')) out.Wall_Industrial = await wallIndustrial(job);
  return out;
}
async function wallPanel(job, name) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2.4, R = new RNG(2101);
  const kick = Math.round(0.15 * PX), yk = H - kick;
  const xs = [0, Math.round(W / 3), Math.round(2 * W / 3), W];
  const panels = [];
  panels.push({ x0: 0, y0: yk, x1: W / 2, y1: H, plate: 2 * S, kind: 'kick', tone: 0 }, { x0: W / 2, y0: yk, x1: W, y1: H, plate: 2 * S, kind: 'kick', tone: 0 });
  const ys = H - Math.round(1.1 * PX);
  for (let c = 0; c < 3; c++) {
    const ins = { m: 0.05 * PX, depth: 1.2 * S, ch: 0.03 * PX, bev: 2.5 * S };
    if (c === 1) {
      panels.push({ x0: xs[c], y0: 0, x1: xs[c + 1], y1: ys, plate: 3.2 * S, inset: ins, ch: 0.02 * PX, tone: R.range(-1, 1) });
      panels.push({ x0: xs[c], y0: ys, x1: xs[c + 1], y1: yk, plate: 3.2 * S, inset: ins, ch: 0.02 * PX, tone: R.range(-1, 1) });
    } else panels.push({ x0: xs[c], y0: 0, x1: xs[c + 1], y1: yk, plate: 3.2 * S, inset: ins, ch: 0.02 * PX, tone: R.range(-1, 1) });
  }
  const { hgt: hp, pid } = rasterPanels(W, H, panels, { gap: 1.8 * S, bev: 2.6 * S });
  // vent grille on col 2, label plates
  const vx = (xs[2] + xs[3]) / 2, vw = 0.46 * PX, vy = H - 0.62 * PX, vh = 0.24 * PX;
  const plates = [{ x: xs[0] + 0.12 * PX, y: H - 1.55 * PX, w: 0.16 * PX, h: 0.06 * PX, s: 'B-12' }, { x: xs[1] + 0.1 * PX, y: ys - 0.14 * PX, w: 0.22 * PX, h: 0.06 * PX, s: 'DECK A  03' }];
  const [mV, mP, mL] = canvasMasks(W, H, (g) => {
    g.fillStyle = 'rgb(0,255,0)'; g.beginPath(); g.roundRect(vx - vw / 2, vy, vw, vh, 0.015 * PX); g.fill();
    g.fillStyle = 'rgb(255,0,0)';
    for (let k = 0; k < 9; k++) { g.beginPath(); g.roundRect(vx - vw / 2 + 0.03 * PX, vy + 0.025 * PX + k * (vh - 0.05 * PX) / 8.6, vw - 0.06 * PX, 0.012 * PX, 0.006 * PX); g.fill(); }
    for (const p of plates) {
      g.fillStyle = 'rgb(0,255,0)'; g.fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle = 'rgb(0,0,255)'; g.font = `${Math.round(p.h * 0.62)}px VSansBold`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.s, p.x + p.w / 2, p.y + p.h / 2 + 1);
    }
    g.fillStyle = 'rgb(0,0,255)'; g.font = `${Math.round(0.035 * PX)}px VSansBold`; g.textAlign = 'left';
    g.fillText('▲ 02', xs[2] + 0.07 * PX, 0.12 * PX);
  });
  // R = louvre slats, G = recessed vent area / raised label plates (told apart by position), B = plate text
  const [mSlat, mArea, mText] = [mV, mP, mL];
  const hgt = F(N), wear = F(N);
  const vRect = [vx - vw / 2, vy, vx + vw / 2, vy + vh];
  for (let i = 0; i < N; i++) {
    hgt[i] = hp[i] + mSlat[i] * 2.5 * S;
    if (mArea[i] <= 0) continue;
    const x = i % W, y = (i / W) | 0;
    const inVent = x >= vRect[0] - 2 && x <= vRect[2] + 2 && y >= vRect[1] - 2 && y <= vRect[3] + 2;
    hgt[i] += inVent ? -5 * S * mArea[i] : 1.0 * S * mArea[i];
  }
  for (const p of panels) {
    if (p.kind === 'kick') continue;
    const ins = 0.022 * PX;
    for (const [x, y] of [[p.x0 + ins, p.y0 + ins], [p.x1 - ins, p.y0 + ins], [p.x0 + ins, p.y1 - ins], [p.x1 - ins, p.y1 - ins]]) stampRivet(hgt, wear, W, H, x, y, 0.008 * PX, 1.0 * S, 'screw');
  }
  for (let k = 0; k < 8; k++) stampRivet(hgt, wear, W, H, (k + 0.5) * W / 8, yk + kick / 2, 0.008 * PX, 1.0 * S, 'screw');
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 61 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 62 }), nHi = fbm(W, H, { fx: 48, oct: 3, seed: 63 }), nFine = fbm(W, H, { fx: 160, oct: 2, seed: 64 });
  const scr = makeScratches(R, 160, W, H, { len: [0.02, 0.18].map((v) => v * PX), wid: [0.6 * S, 1.2 * S], op: [0.2, 0.6], dir: 0, spread: 0.25, region: [H - 0.5 * PX, H] });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  const conv = convexity(hgt, W, H, 2 * S);
  const chip = interiorWear(N, conv, S, nHi, nFine, nLow, 1);
  const peel = fbm(W, H, { fx: 256, oct: 2, seed: 65 });
  for (let i = 0; i < N; i++) hgt[i] += -0.3 * S * chip[i] + 0.04 * S * peel[i];
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.1 / S }, { r: 6 * S, k: 0.07 / S }, { r: 18 * S, k: 0.03 / S }], 0.12);
  const cav = blur(hgt, W, H, 6 * S);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(170, 175, 181), CK = rgb(86, 90, 96), CB = rgb(150, 153, 158), CD = rgb(30, 31, 34), CG = rgb(105, 102, 96), CPL = rgb(48, 52, 58), CT = rgb(206, 208, 210);
  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0, p = pid[i] >= 0 ? panels[pid[i]] : null, kickP = p && p.kind === 'kick';
    const k = 1 + 0.02 * (p ? p.tone : 0) + 0.02 * nLow[i] + 0.012 * nMid[i] + 0.008 * nFine[i];
    const c0 = kickP ? CK : C;
    base[0][i] = c0[0] * k; base[1][i] = c0[1] * k; base[2][i] = c0[2] * k;
    let ro = (kickP ? 0.45 : 0.55) + 0.04 * nMid[i], me = kickP ? 0.45 : 0.05;
    const x = i % W, inVent = x >= vRect[0] - 2 && x <= vRect[2] + 2 && y >= vRect[1] - 2 && y <= vRect[3] + 2;
    if (mArea[i] > 0) { mix3(base, i, inVent ? CD : CPL, mArea[i] * (inVent ? 0.9 : 1)); if (!inVent) { ro = 0.35; me = 0.3; } }
    if (mSlat[i] > 0 && inVent) mix3(base, i, rgb(120, 124, 130), mSlat[i]);
    if (mText[i] > 0) mix3(base, i, CT, mText[i]);
    const s = mS[i] * (kickP ? 1 : 0.4); mix3(base, i, CB, s * 0.6); ro += 0.06 * s;
    mix3(base, i, CB, chip[i]); ro += (0.3 - ro) * chip[i]; me += (0.85 - me) * chip[i];
    const floorG = ss(0.45 * PX, 0, H - y) * (0.6 + 0.4 * nMid[i]);
    const gr = clamp(ss(0.3 * S, 2.5 * S, cav[i] - hgt[i]) * 0.5 + floorG * 0.35) * (0.7 + 0.3 * nHi[i]);
    mix3(base, i, CG, gr * 0.5); ro += 0.1 * gr;
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  return job.write(name, { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [2.4, 2.4] });
}

async function wallWhite(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2.4, R = new RNG(2202);
  const kick = Math.round(0.15 * PX), yk = H - kick;
  const xs = [0, Math.round(W / 3), Math.round(2 * W / 3), W];
  const rr = 0.06 * PX;
  const panels = [{ x0: 0, y0: yk, x1: W / 2, y1: H, plate: 2.5 * S, rr: 0.02 * PX, kind: 'kick' }, { x0: W / 2, y0: yk, x1: W, y1: H, plate: 2.5 * S, rr: 0.02 * PX, kind: 'kick' }];
  for (let c = 0; c < 3; c++) panels.push({ x0: xs[c], y0: 0, x1: xs[c + 1], y1: yk, plate: 4 * S, rr, tone: R.range(-1, 1) });
  const { hgt, pid } = rasterPanels(W, H, panels, { gap: 1.5 * S, bev: 7 * S, round: true });
  // flush round access ports + thin reveal line at 1.0 m (paint)
  const yl = H - Math.round(1.0 * PX);
  const ports = [[xs[0] + (xs[1] - xs[0]) / 2, H - 0.45 * PX], [xs[2] + 0.1 * PX, 0.25 * PX]];
  for (const [px, py] of ports) forDisk(W, H, px, py, 0.035 * PX, (i, dx, dy, d) => { const r = 0.03 * PX; hgt[i] -= 0.8 * S * ss(1.2 * S, 0, Math.abs(d - r)); });
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 71 }), nMid = fbm(W, H, { fx: 12, oct: 3, seed: 72 }), nFine = fbm(W, H, { fx: 200, oct: 2, seed: 73 });
  for (let i = 0; i < N; i++) hgt[i] += 0.025 * S * nFine[i];
  const ao = cavityAO(hgt, W, H, [{ r: 3 * S, k: 0.07 / S }, { r: 12 * S, k: 0.03 / S }], 0.25);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(220, 223, 226), CK = rgb(188, 192, 197), CL = rgb(196, 204, 210);
  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0, p = pid[i] >= 0 ? panels[pid[i]] : null, kickP = p && p.kind === 'kick';
    const k = 1 + 0.008 * (p && p.tone ? p.tone : 0) + 0.01 * nLow[i] + 0.005 * nMid[i];
    const c0 = kickP ? CK : C;
    base[0][i] = c0[0] * k; base[1][i] = c0[1] * k; base[2][i] = c0[2] * k;
    let ro = (kickP ? 0.4 : 0.3) + 0.03 * nMid[i] + 0.01 * nFine[i];
    if (!kickP && Math.abs(y + 0.5 - yl) < 0.012 * PX) mix3(base, i, CL, ss(0.012 * PX, 0.009 * PX, Math.abs(y + 0.5 - yl)));
    const fl = ss(0.3 * PX, 0, H - y) * 0.12 * (0.6 + 0.4 * nMid[i]); mix3(base, i, rgb(170, 170, 166), fl); ro += fl * 0.2;
    rough[i] = clamp(ro, 0.1, 0.9); metal[i] = 0;
  }
  return job.write('Wall_White', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [2.4, 2.4] });
}

async function wallIndustrial(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2.4, R = new RNG(2303);
  const panels = [];
  const bot = Math.round(0.3 * PX);
  panels.push({ x0: 0, y0: H - bot, x1: W / 2, y1: H, plate: 3 * S, tone: R.range(-1, 1), kind: 'bot' }, { x0: W / 2, y0: H - bot, x1: W, y1: H, plate: 3 * S, tone: R.range(-1, 1), kind: 'bot' });
  const rowH = (H - bot) / 3;
  for (let r = 0; r < 3; r++) {
    const y0 = r * rowH, y1 = (r + 1) * rowH, off = (r % 2) * W / 6;
    for (let c = 0; c < 3; c++) panels.push({ x0: off + c * W / 3, y0, x1: off + (c + 1) * W / 3, y1, plate: 3.5 * S, raise: R.range(-0.8, 0.8) * S, tone: R.range(-1, 1) });
  }
  const { hgt, pid } = rasterPanels(W, H, panels, { gap: 1.8 * S, bev: 2.4 * S });
  const rivW = F(N);
  for (const p of panels) {
    const ins = 0.04 * PX, sp = 0.1 * PX, pw = p.x1 - p.x0, ph = p.y1 - p.y0;
    const nx = Math.round((pw - 2 * ins) / sp), ny = Math.round((ph - 2 * ins) / sp);
    for (let k = 0; k <= nx; k++) for (const y of [p.y0 + ins, p.y1 - ins]) stampRivet(hgt, rivW, W, H, p.x0 + ins + k * (pw - 2 * ins) / nx, y, 0.009 * PX, 1.6 * S, 'dome');
    for (let k = 1; k < ny; k++) for (const x of [p.x0 + ins, p.x1 - ins]) stampRivet(hgt, rivW, W, H, x, p.y0 + ins + k * (ph - 2 * ins) / ny, 0.009 * PX, 1.6 * S, 'dome');
  }
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 81 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 82 }), nHi = fbm(W, H, { fx: 48, oct: 3, seed: 83 }), nFine = fbm(W, H, { fx: 160, oct: 2, seed: 84 });
  const scr = makeScratches(R, 420, W, H, { len: [0.02, 0.25].map((v) => v * PX), wid: [0.6 * S, 1.5 * S], op: [0.2, 0.7], dir: 0, spread: 0.3, region: [H - 1.2 * PX, H] });
  const scr2 = makeScratches(R, 160, W, H, { len: [0.01, 0.06].map((v) => v * PX), wid: [0.5 * S, 1 * S], op: [0.2, 0.5] });
  const oilSrc = F(N);
  // irregular, noise-distorted stain outlines (not discs), a soft halo and thin drips below
  for (let k = 0; k < 4; k++) {
    const cx = R.range(0, W), cy = R.range(0.15 * H, 0.8 * H), r = R.range(0.06, 0.13) * PX, ar = R.range(0.6, 1.3);
    forDisk(W, H, cx, cy, r * 2.2, (i, dx, dy, d) => {
      const dd = Math.hypot(dx * ar, dy / ar) / r + 0.55 * nMid[i] + 0.3 * nHi[i];
      oilSrc[i] = Math.max(oilSrc[i], 0.55 * ss(1.0, 0.75, dd) + 0.25 * ss(1.6, 0.9, dd));
    });
  }
  const nStr = fbm(W, H, { fx: 120, fy: 3, oct: 3, seed: 85 });
  const dsrc = F(N); for (let i = 0; i < N; i++) dsrc[i] = ss(0.5, 0.8, oilSrc[i]) * ss(0.25, 0.6, nStr[i]);
  const oilD = dripDown(dsrc, W, H, Math.exp(-1 / (0.3 * PX)));
  const [mS, mS2] = canvasMasks(W, H, (g) => { drawScratches(g, scr, 0); drawScratches(g, scr2, 1); });
  const conv = convexity(hgt, W, H, 2 * S);
  const chip = interiorWear(N, conv, S, nHi, nFine, nLow, 1.25);
  for (let i = 0; i < N; i++) { chip[i] = Math.max(chip[i], rivW[i] * ss(0.1, 0.25, nFine[i] + nHi[i] * 0.4)); hgt[i] += -0.35 * S * chip[i] - 0.2 * S * (mS[i] + mS2[i]) + 0.05 * S * nFine[i]; }
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.1 / S }, { r: 6 * S, k: 0.07 / S }, { r: 18 * S, k: 0.03 / S }], 0.12);
  const cav = blur(hgt, W, H, 6 * S);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(95, 100, 106), CB = rgb(150, 153, 158), CG = rgb(52, 50, 46), CO = rgb(34, 31, 26);
  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0, p = pid[i] >= 0 ? panels[pid[i]] : null;
    const k = 1 + 0.04 * (p ? p.tone : 0) + 0.04 * nLow[i] + 0.025 * nMid[i] + 0.012 * nFine[i] - (p && p.kind === 'bot' ? 0.12 : 0);
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    let ro = 0.6 + 0.05 * nMid[i] + 0.02 * nFine[i], me = 0.35;
    const s = clamp(mS[i] + mS2[i] * 0.8); mix3(base, i, CB, s * 0.55); ro += (0.42 - ro) * s * 0.5; me += (0.8 - me) * s * 0.5;
    mix3(base, i, CB, chip[i]); ro += (0.32 - ro) * chip[i]; me += (0.9 - me) * chip[i];
    const floorG = ss(0.6 * PX, 0, H - y);
    const gr = clamp(ss(0.3 * S, 2.5 * S, cav[i] - hgt[i]) * 0.6 + floorG * 0.4 + clamp(nLow[i] * 0.5) * 0.3) * (0.65 + 0.35 * nHi[i]);
    mix3(base, i, CG, gr * 0.55); ro += 0.1 * gr;
    const oil = clamp(oilSrc[i] + oilD[i] * 0.45) * (0.8 + 0.2 * nHi[i]);
    mix3(base, i, CO, oil * 0.6); ro += (0.22 - ro) * oil * 0.8; me += (0.2 - me) * oil * 0.6;
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  return job.write('Wall_Industrial', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [2.4, 2.4] });
}

// ============================================================ FLOORS / CEILING
async function genFloorDeck(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2.4, R = new RNG(3101), T = W / 2;
  const panels = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) panels.push({ x0: i * T, y0: j * T, x1: (i + 1) * T, y1: (j + 1) * T, plate: 3 * S, tone: R.range(-1, 1), wearOff: R.range(-0.3, 0.3) });
  const { hgt, pid, edge } = rasterPanels(W, H, panels, { gap: 1.6 * S, bev: 2.4 * S });
  const frame = 0.05 * PX, p = 0.036 * PX, lugH = 1.6 * S;
  const ncell = Math.floor((T - 2 * frame - 0.3 * p) / p), start = (T - ncell * p) / 2;
  // lift-handle recesses on one tile (lugs suppressed around them)
  const handles = [];
  { const pp = panels[1], hw = 0.13 * PX, hh = 0.035 * PX, cx = (pp.x0 + pp.x1) / 2; handles.push([cx - hw / 2, pp.y0 + frame + 0.05 * PX, cx + hw / 2, pp.y0 + frame + 0.05 * PX + hh], [cx - hw / 2, pp.y1 - frame - 0.05 * PX - hh, cx + hw / 2, pp.y1 - frame - 0.05 * PX]); }
  const lug = F(N), hand = F(N);
  for (let i = 0; i < N; i++) {
    if (edge[i] < frame) continue;
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    let skip = false;
    for (const [a0, b0, a1, b1] of handles) {
      if (x > a0 - 0.03 * PX && x < a1 + 0.03 * PX && y > b0 - 0.03 * PX && y < b1 + 0.03 * PX) skip = true;
      const d = roundRectDist(x, y, a0, b0, a1, b1, (b1 - b0) / 2);
      if (d > -1) { const v = ss(-1 * S, 1.5 * S, d); hgt[i] -= 4 * S * v; hand[i] = Math.max(hand[i], v); }
    }
    if (skip) continue;
    const pp = panels[pid[i]], lx = x - pp.x0 - start, ly = y - pp.y0 - start;
    const cx = Math.floor(lx / p), cy = Math.floor(ly / p);
    if (cx < 0 || cy < 0 || cx >= ncell || cy >= ncell) continue;
    const ux = lx - (cx + 0.5) * p, uy = ly - (cy + 0.5) * p;
    const sgn = (cx + cy) & 1 ? 1 : -1;
    const a = (ux + sgn * uy) * 0.7071, b = (ux * -sgn + uy) * 0.7071;
    const e = (a / (0.42 * p)) ** 2 + (b / (0.11 * p)) ** 2;
    const v = ss(1.0, 0.55, e);
    lug[i] = v; hgt[i] += lugH * v;
  }
  const rivW = F(N);
  for (const pp of panels) {
    const ins = frame / 2;
    for (const [x, y] of [[pp.x0 + ins, pp.y0 + ins], [pp.x1 - ins, pp.y0 + ins], [pp.x0 + ins, pp.y1 - ins], [pp.x1 - ins, pp.y1 - ins], [(pp.x0 + pp.x1) / 2, pp.y0 + ins], [(pp.x0 + pp.x1) / 2, pp.y1 - ins], [pp.x0 + ins, (pp.y0 + pp.y1) / 2], [pp.x1 - ins, (pp.y0 + pp.y1) / 2]])
      stampRivet(hgt, rivW, W, H, x, y, 0.012 * PX, 1.4 * S, 'counter');
  }
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 91 }), nMid = fbm(W, H, { fx: 12, oct: 4, seed: 92 }), nHi = fbm(W, H, { fx: 64, oct: 3, seed: 93 }), nFine = fbm(W, H, { fx: 192, oct: 2, seed: 94 });
  const scr = makeScratches(R, 500, W, H, { len: [0.01, 0.12].map((v) => v * PX), wid: [0.5 * S, 1.1 * S], op: [0.15, 0.5] });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  for (let i = 0; i < N; i++) hgt[i] += -0.2 * S * mS[i] + 0.06 * S * nFine[i];
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.12 / S }, { r: 5 * S, k: 0.07 / S }, { r: 16 * S, k: 0.03 / S }], 0.15);
  const cav = blur(hgt, W, H, 4 * S);
  const conv = convexity(hgt, W, H, 2 * S);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(70, 75, 82), CW = rgb(150, 154, 160), CG = rgb(42, 41, 38);
  for (let i = 0; i < N; i++) {
    const pp = pid[i] >= 0 ? panels[pid[i]] : null;
    const k = 1 + 0.04 * (pp ? pp.tone : 0) + 0.04 * nLow[i] + 0.025 * nMid[i] + 0.015 * nFine[i];
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    let ro = 0.5 + 0.05 * nMid[i], me = 0.6;
    const walk = ss(-0.45, 0.25, nLow[i] + (pp ? pp.wearOff : 0) + 0.25 * nMid[i]);
    const top = clamp(lug[i] * 1.4) * (0.25 + 0.75 * walk) + ss(0.5, 0.9, conv[i] / S) * 0.6;
    const w = clamp(top * (0.75 + 0.25 * nHi[i]));
    mix3(base, i, CW, w * 0.8); ro += (0.24 - ro) * w; me += (0.92 - me) * w;
    if (hand[i] > 0) mix3(base, i, rgb(22, 23, 25), hand[i] * 0.85);
    const s = mS[i] * (0.4 + 0.6 * walk); mix3(base, i, CW, s * 0.5); ro += (0.3 - ro) * s * 0.4;
    const gr = clamp(ss(0.2 * S, 1.6 * S, cav[i] - hgt[i]) * 0.8 + (1 - walk) * 0.2) * (0.6 + 0.4 * nHi[i]);
    mix3(base, i, CG, gr * 0.5); ro += 0.15 * gr; me -= 0.2 * gr;
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  return { Floor_Deck: await job.write('Floor_Deck', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1.1, tileMeters: [2.4, 2.4] }) };
}

async function genFloorGrate(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 1.2, T = W / 2, frame = Math.round(0.03 * PX);
  const nb = 15, nc = 5, inner = T - 2 * frame;
  const pitchB = inner / nb, pitchC = inner / nc, bw = 5 * S, cw = 6 * S, DEPTH = 22 * S;
  const hgt = F(N), hole = F(N), holeD = F(N), kindM = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, lx = mod(x + 0.5, T), ly = mod(y + 0.5, T);
    const d = Math.min(lx, T - lx, ly, T - ly);
    let v;
    if (d < frame) {
      v = DEPTH * ss(0.6 * S, 2.6 * S, d) * (d < frame - 1.5 * S ? 1 : ss(frame + 0.5 * S, frame - 1.5 * S, d));
      if (d < 0.8 * S) { v = 2 * S; kindM[i] = 1; } else kindM[i] = 2;
    } else {
      const ix = lx - frame, iy = ly - frame;
      const db = Math.abs(mod(ix, pitchB) - pitchB / 2), dc = Math.abs(mod(iy, pitchC) - pitchC / 2);
      const vb = ss(bw / 2 + 0.6 * S, bw / 2 - 1.2 * S, db), vc = ss(cw / 2 + 0.6 * S, cw / 2 - 1.2 * S, dc);
      const serr = 0.6 * S * (Math.abs(mod(iy, 8 * S) - 4 * S) < 1.2 * S ? 1 : 0);
      const hb = DEPTH * vb - serr * vb, hc = (DEPTH - 2.5 * S) * vc;
      v = Math.max(hb, hc, 0);
      kindM[i] = hb >= hc ? 3 : 4;
      const h0 = 1 - Math.max(vb, vc);
      hole[i] = h0;
      holeD[i] = Math.min(db - bw / 2, dc - cw / 2, d - frame);
      if (h0 > 0.5) v = Math.max(v, 1 * S);
    }
    hgt[i] = v;
  }
  const rivW = F(N);
  for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) for (const [ax, ay] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x = k * T + (ax ? T - frame / 2 : frame / 2), y = j * T + (ay ? T - frame / 2 : frame / 2);
    stampRivet(hgt, rivW, W, H, x, y, frame * 0.32, 2.2 * S, 'screw');
  }
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 101 }), nMid = fbm(W, H, { fx: 12, oct: 4, seed: 102 }), nHi = fbm(W, H, { fx: 64, oct: 3, seed: 103 });
  for (let i = 0; i < N; i++) hgt[i] += nHi[i] * 0.08 * S;
  const ao = cavityAO(hgt, W, H, [{ r: 2 * S, k: 0.03 / S }, { r: 8 * S, k: 0.03 / S }, { r: 20 * S, k: 0.02 / S }], 0.05);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(104, 107, 111), CW = rgb(150, 153, 157), CH = rgb(16, 17, 19), CG = rgb(50, 47, 42);
  for (let i = 0; i < N; i++) {
    const k = 1 + 0.05 * nLow[i] + 0.03 * nMid[i];
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    let ro = 0.45 + 0.05 * nMid[i], me = 0.85;
    const topness = ss(DEPTH * 0.85, DEPTH, hgt[i]);
    const w = topness * ss(-0.3, 0.6, nLow[i] + 0.4 * nMid[i]) * (0.7 + 0.3 * nHi[i]);
    mix3(base, i, CW, w * 0.8); ro += (0.26 - ro) * w;
    const depthF = 1 - clamp(hgt[i] / DEPTH);
    mix3(base, i, CG, clamp(depthF * 1.2) * 0.5 * (0.6 + 0.4 * nHi[i])); ro += 0.2 * depthF;
    if (hole[i] > 0) {
      // bar side faces fade into darkness; faint structure far below
      const deep = ss(0.5 * S, 9 * S, holeD[i]);
      const hc = [lerp(0.2, CH[0], deep), lerp(0.205, CH[1], deep), lerp(0.215, CH[2], deep)];
      const below = 1 + 0.35 * nMid[i] + 0.2 * nLow[i];
      mix3(base, i, scale3(hc, below), ss(0.3, 0.9, hole[i])); ro += (0.8 - ro) * hole[i]; me += (0.3 - me) * hole[i];
    }
    if (kindM[i] === 1) mix3(base, i, CH, 0.85);
    ao[i] = Math.min(ao[i], lerp(1, lerp(0.45, 0.06, ss(0.5 * S, 9 * S, holeD[i])), ss(0.3, 0.95, hole[i])), lerp(1, 0.35, clamp(depthF * 1.3) * (1 - topness)));
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  return { Floor_Grate: await job.write('Floor_Grate', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 0.9, tileMeters: [1.2, 1.2] }) };
}

async function genCeiling(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 2.4, R = new RNG(3303);
  const panels = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) panels.push({ x0: i * W / 4, y0: j * H / 2, x1: (i + 1) * W / 4, y1: (j + 1) * H / 2, plate: 3.2 * S, tone: R.range(-1, 1), ch: 0.025 * PX, inset: { m: 0.05 * PX, depth: -1.1 * S, ch: 0.02 * PX, bev: 2.4 * S } });
  const { hgt, pid } = rasterPanels(W, H, panels, { gap: 1.8 * S, bev: 2.4 * S });
  const hole = F(N);
  // perforated diffuser panel (0,0) and slot vent panel (2,1)
  { const p = panels[1], m = 0.12 * PX, pitch = 0.025 * PX, r = 0.007 * PX;
    for (let y = p.y0 + m; y <= p.y1 - m; y += pitch) for (let x = p.x0 + m; x <= p.x1 - m; x += pitch) forDisk(W, H, x, y, r, (i, dx, dy, d) => { const v = ss(r, r - 1.2 * S, d); hgt[i] -= 3 * S * v; hole[i] = Math.max(hole[i], v); }); }
  { const p = panels[6], cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, L = 0.32 * PX;
    for (let k = 0; k < 6; k++) { const y = cy - 0.1 * PX + k * 0.04 * PX; forRect(W, H, cx - L / 2, y - 0.01 * PX, cx + L / 2, y + 0.01 * PX, (i, px, py) => { const d = rectDist(px, py, cx - L / 2, y - 0.01 * PX, cx + L / 2, y + 0.01 * PX); const v = ss(0, 1.5 * S, d); hgt[i] -= 4 * S * v; hole[i] = Math.max(hole[i], v); }); } }
  { const p = panels[3], cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, r0 = 0.07 * PX;
    forDisk(W, H, cx, cy, r0 * 1.1, (i, dx, dy, d) => { const t = d / r0; let v = 1.5 * S * ss(1.1, 0.95, t); if (t < 0.75) v -= 3 * S * ss(0.75, 0.68, t); if (t < 0.75 && (Math.abs(mod(Math.atan2(dy, dx) * 6 / Math.PI, 1) - 0.5) > 0.35)) { v -= 2 * S; hole[i] = Math.max(hole[i], 0.8 * ss(0.75, 0.68, t)); } if (t < 0.25) v += 3 * S; hgt[i] += v; }); }
  const rivW = F(N);
  for (const p of panels) { const ins = 0.025 * PX + 0.01 * PX; for (const [x, y] of [[p.x0 + ins, p.y0 + ins], [p.x1 - ins, p.y0 + ins], [p.x0 + ins, p.y1 - ins], [p.x1 - ins, p.y1 - ins]]) stampRivet(hgt, rivW, W, H, x, y, 0.009 * PX, 1.2 * S, 'screw'); }
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 111 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 112 }), nHi = fbm(W, H, { fx: 48, oct: 3, seed: 113 }), nFine = fbm(W, H, { fx: 160, oct: 2, seed: 114 });
  const conv = convexity(hgt, W, H, 2 * S);
  const chip = interiorWear(N, conv, S, nHi, nFine, nLow, 0.8);
  for (let i = 0; i < N; i++) hgt[i] += -0.3 * S * chip[i] + 0.04 * S * nFine[i];
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.1 / S }, { r: 6 * S, k: 0.07 / S }, { r: 18 * S, k: 0.03 / S }], 0.1);
  const hb = blur(hole, W, H, 6 * S);
  const cav = blur(hgt, W, H, 6 * S);
  const base = ch3(N), rough = F(N), metal = F(N);
  const C = rgb(120, 125, 132), CB = rgb(160, 164, 170), CH = rgb(20, 21, 23), CG = rgb(70, 68, 64);
  for (let i = 0; i < N; i++) {
    const p = pid[i] >= 0 ? panels[pid[i]] : null;
    const k = 1 + 0.03 * (p ? p.tone : 0) + 0.025 * nLow[i] + 0.015 * nMid[i] + 0.01 * nFine[i];
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    let ro = 0.6 + 0.04 * nMid[i], me = 0.15;
    mix3(base, i, CB, chip[i]); ro += (0.32 - ro) * chip[i]; me += (0.85 - me) * chip[i];
    mix3(base, i, CH, hole[i] * 0.9);
    const gr = clamp(ss(0.3 * S, 2.5 * S, cav[i] - hgt[i]) * 0.5 + hb[i] * 0.6) * (0.65 + 0.35 * nHi[i]);
    mix3(base, i, CG, gr * 0.45); ro += 0.1 * gr;
    rough[i] = clamp(ro, 0.1, 0.95); metal[i] = clamp(me);
  }
  return { Ceiling: await job.write('Ceiling', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [2.4, 2.4] }) };
}

// ============================================================ SMALL MATERIALS
async function genHazard(job) {
  const { W, H, N, S } = dims(512, job.scale);
  const PX = W, R = new RNG(4401), period = W / 4;
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 121 }), nMid = fbm(W, H, { fx: 10, oct: 4, seed: 122 }), nHi = fbm(W, H, { fx: 40, oct: 3, seed: 123 }), nFine = fbm(W, H, { fx: 128, oct: 2, seed: 124 });
  const scr = makeScratches(R, 160, W, H, { len: [0.01, 0.12].map((v) => v * PX), wid: [0.6 * S, 1.3 * S], op: [0.25, 0.8] });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  const Y = rgb(222, 172, 32), K = rgb(28, 28, 30), M = rgb(130, 133, 138), G = rgb(70, 64, 54);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = mod((x + 0.5 + y + 0.5) / period, 1);
    const d = Math.min(Math.abs(t - 0.25), Math.abs(t - 0.75)) * period * 0.7071;
    const yel = t > 0.25 && t < 0.75 ? 1 : 0, aa = ss(0, 1.2 * S, d);
    const s = lerp(0.5, yel, aa);
    const k = 1 + 0.04 * nMid[i] + 0.02 * nFine[i];
    base[0][i] = lerp(K[0], Y[0], s) * k; base[1][i] = lerp(K[1], Y[1], s) * k; base[2][i] = lerp(K[2], Y[2], s) * k;
    let ro = 0.5 + 0.05 * nMid[i], me = 0.05;
    const chip = Math.max(ss(0.64, 0.7, nHi[i] * 0.55 + nMid[i] * 0.35 + nLow[i] * 0.25 + nFine[i] * 0.2), mS[i] * 0.9);
    mix3(base, i, scale3(M, 1 + 0.1 * nFine[i]), chip); ro += (0.32 - ro) * chip; me += (0.9 - me) * chip;
    const gr = clamp(0.5 + nLow[i] * 0.8) * 0.25 * (0.6 + 0.4 * nHi[i]); mix3(base, i, G, gr); ro += 0.1 * gr;
    rough[i] = clamp(ro); metal[i] = clamp(me);
    hgt[i] = -0.6 * S * chip + 0.05 * S * nFine[i];
  }
  const ao = cavityAO(hgt, W, H, [{ r: 2 * S, k: 0.25 / S }], 0.5);
  return { Hazard: await job.write('Hazard', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [1, 1] }) };
}

async function genMetalPainted(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W / 1.5, R = new RNG(4502);
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 131 }), nMid = fbm(W, H, { fx: 12, oct: 4, seed: 132 }), nHi = fbm(W, H, { fx: 64, oct: 3, seed: 133 }), nFine = fbm(W, H, { fx: 256, oct: 2, seed: 134 });
  const scr = makeScratches(R, 180, W, H, { len: [0.01, 0.1].map((v) => v * PX), wid: [0.6 * S, 1.4 * S], op: [0.3, 0.85], clusters: 14, crad: 0.12 * PX });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  const nChip = fbm(W, H, { fx: 128, oct: 2, seed: 135 });
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  const C = rgb(234, 234, 232), M = rgb(128, 131, 136), G = rgb(196, 195, 190), P = rgb(176, 178, 178);
  for (let i = 0; i < N; i++) {
    const k = 1 + 0.012 * nLow[i] + 0.008 * nMid[i] + 0.006 * nFine[i];
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    let ro = 0.42 + 0.04 * nMid[i] + 0.02 * nFine[i], me = 0;
    // clustered chips: low-freq zones × crisp high-freq breakup; a grey primer ring around each chip
    const zone = ss(0.05, 0.45, nLow[i] * 0.7 + nMid[i] * 0.5);
    const v = zone * 0.6 + nHi[i] * 0.45 + nChip[i] * 0.3;
    const primer = ss(0.5, 0.53, v);
    const chip = Math.max(ss(0.56, 0.59, v), mS[i] * 0.85);
    mix3(base, i, P, primer * (1 - chip) * 0.8);
    const scuff = ss(0.3, 0.5, v) * (1 - primer);
    mix3(base, i, G, scuff * 0.3); ro += 0.06 * scuff;
    mix3(base, i, scale3(M, 1 + 0.1 * nFine[i]), chip); ro += (0.3 - ro) * chip; me += (0.95 - me) * chip;
    const gr = clamp(0.4 + nLow[i] * 0.8) * 0.12 * (0.6 + 0.4 * nHi[i]); mix3(base, i, G, gr); ro += 0.06 * gr;
    rough[i] = clamp(ro); metal[i] = clamp(me);
    hgt[i] = -0.5 * S * primer - 0.5 * S * chip + 0.06 * S * nFine[i] + 0.04 * S * nHi[i];
  }
  const ao = cavityAO(hgt, W, H, [{ r: 2 * S, k: 0.2 / S }], 0.5);
  return { Metal_Painted: await job.write('Metal_Painted', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [1.5, 1.5] }) };
}

async function genMetalBrushed(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const PX = W, R = new RNG(4603);
  const brush = normalize(blur(white(W, H, 141), W, H, 60 * S, 0, 2));
  const brush2 = normalize(fbm(W, H, { fx: 2, fy: 300, oct: 2, seed: 142 }));
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 143 }), nMid = fbm(W, H, { fx: 10, oct: 3, seed: 144 });
  const scr = makeScratches(R, 120, W, H, { len: [0.01, 0.08].map((v) => v * PX), wid: [0.5 * S, 0.9 * S], op: [0.1, 0.35] });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  const base = ch3(N), rough = F(N), metal = F(N, 1), hgt = F(N);
  const C = rgb(186, 189, 193);
  for (let i = 0; i < N; i++) {
    const b = brush[i] * 0.65 + brush2[i] * 0.35;
    const k = 1 + 0.035 * b + 0.02 * nMid[i] + 0.015 * nLow[i] + 0.05 * mS[i];
    base[0][i] = C[0] * k; base[1][i] = C[1] * k; base[2][i] = C[2] * k;
    rough[i] = clamp(0.3 + 0.03 * b + 0.025 * nMid[i] + 0.02 * nLow[i] + 0.05 * mS[i], 0.22, 0.38);
    hgt[i] = b * 0.08 * S - mS[i] * 0.25 * S;
  }
  return { Metal_Brushed: await job.write('Metal_Brushed', { w: W, h: H, base, ao: F(N, 1), rough, metal, height: hgt, normalStrength: 1, tileMeters: [1, 1] }) };
}

async function genFabric(job) {
  const { W, H, N, S } = dims(512, job.scale);
  const p = 8 * S;
  const nT = W / p;
  const thr = (k, s) => hash3(mod(k, nT), s, 999);
  const nMid = fbm(W, H, { fx: 8, oct: 3, seed: 151 }), fib = fbm(W, H, { fx: 128, oct: 2, seed: 152 });
  const fibX = normalize(blur(white(W, H, 153), W, H, 3 * S, 0, 1)), fibY = normalize(blur(white(W, H, 154), W, H, 0, 3 * S, 1));
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const cx = Math.floor((x + 0.5) / p), cy = Math.floor((y + 0.5) / p);
    const fx = mod(x + 0.5, p) / p, fy = mod(y + 0.5, p) / p;
    const warpOver = ((cx + cy) & 1) === 0;
    const pWarp = Math.sin(Math.PI * fx) ** 0.7, pWeft = Math.sin(Math.PI * fy) ** 0.7;
    const alongWarp = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (fy - 0.5)) * (warpOver ? 1 : -1);
    const alongWeft = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (fx - 0.5)) * (warpOver ? -1 : 1);
    const tw = 0.85 + 0.3 * thr(cx, 1), tf = 0.85 + 0.3 * thr(cy, 2);
    const hw = pWarp * (0.55 + 0.45 * alongWarp) * tw, hf = pWeft * (0.55 + 0.45 * alongWeft) * tf;
    const isWarp = hw >= hf;
    const v = Math.max(hw, hf);
    hgt[i] = v * 2.2 * S + (isWarp ? fibY[i] : fibX[i]) * 0.12 * S + fib[i] * 0.1 * S;
    const tone = isWarp ? 0.97 + 0.05 * thr(cx, 3) : 0.95 + 0.05 * thr(cy, 4);
    const k = tone * (1 + 0.025 * nMid[i]) * (0.9 + 0.1 * v);
    base[0][i] = 0.872 * k; base[1][i] = 0.863 * k; base[2][i] = 0.847 * k;
    rough[i] = clamp(0.9 + 0.04 * fib[i] - 0.03 * v); metal[i] = 0;
  }
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.18 / S }, { r: 4 * S, k: 0.06 / S }], 0.4);
  return { Fabric: await job.write('Fabric', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [0.5, 0.5] }) };
}

async function genPlastic(job) {
  const { W, H, N, S } = dims(512, job.scale);
  const R = new RNG(4704);
  const st = fbm(W, H, { fx: 96, oct: 3, seed: 161, gain: 0.6 }), nLow = fbm(W, H, { fx: 3, oct: 3, seed: 162 }), nMid = fbm(W, H, { fx: 12, oct: 3, seed: 163 });
  const scr = makeScratches(R, 40, W, H, { len: [0.01, 0.06].map((v) => v * W), wid: [0.5 * S, 0.9 * S], op: [0.1, 0.3] });
  const [mS] = canvasMasks(W, H, (g) => drawScratches(g, scr));
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  for (let i = 0; i < N; i++) {
    const k = 1 + 0.01 * nLow[i] + 0.006 * nMid[i] + 0.006 * st[i];
    base[0][i] = 0.886 * k; base[1][i] = 0.894 * k; base[2][i] = 0.898 * k;
    rough[i] = clamp(0.35 + 0.04 * st[i] + 0.02 * nMid[i] + 0.1 * mS[i]);
    hgt[i] = 0.25 * S * st[i] - 0.2 * S * mS[i];
  }
  return { Plastic_White: await job.write('Plastic_White', { w: W, h: H, base, ao: F(N, 1), rough, metal, height: hgt, normalStrength: 1, tileMeters: [1, 1] }) };
}

async function genWood(job) {
  const { W, H, N, S } = dims(1024, job.scale);
  const R = new RNG(4805), planks = 4, PH = H / planks;
  const warps = [], fine = fbm(W, H, { fx: 4, fy: 48, oct: 4, seed: 171 }), nMid = fbm(W, H, { fx: 6, oct: 4, seed: 172 });
  for (let k = 0; k < planks; k++) warps.push(fbm(W, H, { fx: 2, fy: 2, oct: 4, seed: 180 + k }));
  const pores = blur(white(W, H, 173), W, H, 5 * S, 0, 1);
  const pr = normalize(pores);
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  const L = rgb(104, 68, 44), D = rgb(50, 31, 20), MID = rgb(78, 50, 32);
  const P = Array.from({ length: planks }, () => ({ freq: R.int(14, 22), amp: R.range(0.8, 1.6), off: R.f(), tone: R.range(-0.08, 0.08), fig: R.range(0.5, 1) }));
  for (let y = 0; y < H; y++) {
    const k = Math.min(planks - 1, Math.floor(y / PH)), pl = P[k], wf = warps[k];
    const ly = (y + 0.5 - k * PH) / PH;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const g = ly * pl.freq * 0.5 + pl.amp * wf[i] * 3 + 0.15 * fine[i] + pl.off + (x / W) * 0;
      const ring = mod(g, 1);
      const late = ss(0.55, 0.85, ring) * ss(1.0, 0.9, ring);
      const fig = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 3 + wf[i] * 6) * pl.fig;
      let c = [lerp(MID[0], L[0], 0.5 + 0.4 * nMid[i]), lerp(MID[1], L[1], 0.5 + 0.4 * nMid[i]), lerp(MID[2], L[2], 0.5 + 0.4 * nMid[i])];
      const dk = clamp(late * 0.85 + 0.25 * fine[i] + 0.1 * (fig - 0.5));
      c = [lerp(c[0], D[0], dk), lerp(c[1], D[1], dk), lerp(c[2], D[2], dk)];
      const pore = ss(1.6, 2.6, pr[i]) * (0.5 + 0.5 * late);
      const tk = 1 + pl.tone;
      const seam = ss(1.2 * S, 0, Math.min(ly * PH, (1 - ly) * PH));
      base[0][i] = c[0] * tk * (1 - 0.5 * pore) * (1 - 0.5 * seam); base[1][i] = c[1] * tk * (1 - 0.5 * pore) * (1 - 0.5 * seam); base[2][i] = c[2] * tk * (1 - 0.5 * pore) * (1 - 0.5 * seam);
      rough[i] = clamp(0.35 + 0.03 * nMid[i] + 0.05 * pore); metal[i] = 0;
      hgt[i] = -0.25 * S * pore - 0.05 * S * late - 0.6 * S * seam;
    }
  }
  const ao = cavityAO(hgt, W, H, [{ r: 1.5 * S, k: 0.15 / S }], 0.6);
  return { Wood: await job.write('Wood', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [1.5, 1.5] }) };
}

async function genRubber(job) {
  const { W, H, N, S } = dims(512, job.scale);
  const p = 32 * S, rad = 10 * S;
  const nLow = fbm(W, H, { fx: 3, oct: 3, seed: 191 }), nMid = fbm(W, H, { fx: 12, oct: 3, seed: 192 }), nFine = fbm(W, H, { fx: 128, oct: 2, seed: 193 });
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, qx = mod(x + 0.5, p) - p / 2, qy = mod(y + 0.5, p) - p / 2, d = Math.hypot(qx, qy);
    const stud = ss(rad + 1.2 * S, rad - 1.2 * S, d);
    hgt[i] = stud * 2.6 * S + 0.08 * S * nFine[i];
    const k = 1 + 0.05 * nMid[i] + 0.04 * nFine[i];
    base[0][i] = 0.125 * k; base[1][i] = 0.125 * k; base[2][i] = 0.133 * k;
    const dust = (1 - stud) * clamp(0.4 + nLow[i] * 0.8) * 0.35;
    mix3(base, i, rgb(78, 76, 72), dust);
    const worn = stud * ss(-0.2, 0.6, nLow[i] + 0.3 * nMid[i]);
    rough[i] = clamp(0.82 + 0.04 * nFine[i] - 0.14 * worn + 0.05 * dust); metal[i] = 0;
  }
  const ao = cavityAO(hgt, W, H, [{ r: 2 * S, k: 0.12 / S }, { r: 6 * S, k: 0.05 / S }], 0.4);
  return { Rubber: await job.write('Rubber', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, tileMeters: [1, 1] }) };
}

async function genLightPanel(job) {
  const { W, H, N, S } = dims(512, job.scale);
  const fr = 14 * S, nFine = fbm(W, H, { fx: 128, oct: 2, seed: 201 }), nMid = fbm(W, H, { fx: 8, oct: 3, seed: 202 });
  const base = ch3(N), rough = F(N), metal = F(N), hgt = F(N), em = ch3(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, px = x + 0.5, py = y + 0.5;
    const d = rectDist(px, py, 0, 0, W, H, 0);
    const inner = ss(fr - 0.8 * S, fr + 0.8 * S, d);
    const u = (px / W - 0.5) * 2, v = (py / H - 0.5) * 2;
    const centre = 1 - 0.18 * Math.min(1, u * u * 0.8 + v * v * 0.8);
    const vign = ss(fr, fr + 30 * S, d);
    const e = inner * centre * (0.86 + 0.14 * vign) * (1 + 0.012 * nFine[i] + 0.01 * nMid[i]);
    em[0][i] = e; em[1][i] = e; em[2][i] = e;
    const frameC = 0.215 + 0.02 * nFine[i];
    const diff = 0.93 + 0.01 * nFine[i];
    base[0][i] = lerp(frameC, diff, inner); base[1][i] = lerp(frameC * 1.02, diff, inner); base[2][i] = lerp(frameC * 1.05, diff * 1.01, inner);
    rough[i] = lerp(0.45, 0.25, inner); metal[i] = lerp(0.6, 0, inner);
    hgt[i] = (d < fr ? 3 * S * ss(0, 3 * S, d) : 3 * S - 2.2 * S * ss(fr - 1 * S, fr + 2 * S, d)) + 0.02 * S * nFine[i];
  }
  const ao = cavityAO(hgt, W, H, [{ r: 3 * S, k: 0.08 / S }], 0.5);
  return { LightPanel: await job.write('LightPanel', { w: W, h: H, base, ao, rough, metal, height: hgt, normalStrength: 1, emission: em, tileMeters: [1, 1] }) };
}

// ============================================================ SCREENS atlas
const CY = '#5fd0ff', OR = '#ffa040', GR = '#7dffa0';
function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function T(g, s, x, y, size, col, align = 'left', font = 'VMono') { g.font = `${size}px ${font}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); }
function screenBg(g, col, title, R) {
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#0a1626'); gr.addColorStop(1, '#040a14');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = rgba(col, 0.07); g.lineWidth = 1;
  for (let k = 32; k < 512; k += 32) { g.beginPath(); g.moveTo(k, 14); g.lineTo(k, 498); g.stroke(); g.beginPath(); g.moveTo(14, k); g.lineTo(498, k); g.stroke(); }
  g.strokeStyle = rgba(col, 0.55); g.lineWidth = 1.5; g.strokeRect(10.5, 10.5, 491, 491);
  g.strokeStyle = col; g.lineWidth = 3;
  for (const [x, y, dx, dy] of [[10, 10, 1, 1], [502, 10, -1, 1], [10, 502, 1, -1], [502, 502, -1, -1]]) { g.beginPath(); g.moveTo(x + dx * 28, y); g.lineTo(x, y); g.lineTo(x, y + dy * 28); g.stroke(); }
  g.fillStyle = rgba(col, 0.14); g.fillRect(14, 14, 484, 34);
  T(g, title, 26, 39, 20, col, 'left', 'VSansBold');
  T(g, `VX-984 · ${String(R.int(100, 999))}`, 486, 39, 14, rgba(col, 0.7), 'right');
}
function drawScreen(g, idx, R) {
  const titles = ['SENSOR · RADAR', 'TELEMETRY', 'SYSTEM STATUS', 'SHIP SCHEMATIC', 'ORBITAL', 'NAVIGATION', 'REACTOR CORE', 'MEDICAL', 'STAR MAP', 'PROPULSION', 'CARGO', 'TERMINAL', 'ВНИМАНИЕ', 'SERVER RACK', 'VESPER OS', 'LIFE SUPPORT'];
  const col = idx === 6 || idx === 12 ? OR : idx === 7 || idx === 13 ? GR : CY;
  screenBg(g, col, titles[idx], R);
  g.lineCap = 'round'; g.lineJoin = 'round';
  switch (idx) {
    case 0: {
      const cx = 256, cy = 280, r = 190;
      g.strokeStyle = rgba(CY, 0.6); g.lineWidth = 1.5;
      for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, r * k / 4, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
      for (let k = 0; k < 36; k++) { const a = k * Math.PI / 18, l = k % 3 ? 6 : 14; g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l)); g.stroke(); }
      const a0 = -0.6;
      for (let k = 0; k < 40; k++) { g.fillStyle = rgba(CY, 0.22 * (1 - k / 40)); g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a0 - (k + 1) * 0.025, a0 - k * 0.025); g.closePath(); g.fill(); }
      g.strokeStyle = CY; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r); g.stroke();
      for (const [a, d, c] of [[-0.9, 0.6, OR], [-1.3, 0.35, CY], [2.2, 0.75, CY], [0.8, 0.5, GR], [-2.6, 0.85, CY]]) { const x = cx + Math.cos(a) * r * d, y = cy + Math.sin(a) * r * d; g.fillStyle = c; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.strokeStyle = rgba(c, 0.6); g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
      T(g, 'RNG 50 km', 24, 488, 16, CY); T(g, 'CONTACTS 05', 488, 488, 16, OR, 'right');
      break;
    }
    case 1: {
      const rows = [['THRUST kN', CY], ['HULL TEMP K', OR], ['FLUX mT', GR]];
      rows.forEach(([lab, c], k) => {
        const y0 = 70 + k * 145, h = 120;
        g.strokeStyle = rgba(c, 0.35); g.lineWidth = 1; g.strokeRect(30.5, y0 + 0.5, 452, h);
        for (let q = 1; q < 4; q++) { g.beginPath(); g.moveTo(30, y0 + q * h / 4); g.lineTo(482, y0 + q * h / 4); g.stroke(); }
        g.strokeStyle = c; g.lineWidth = 2.2; g.beginPath();
        let v = R.range(0.3, 0.7);
        for (let x = 0; x <= 452; x += 6) { v = clamp(v + R.range(-0.08, 0.08), 0.1, 0.9); const yy = y0 + h - v * h; x ? g.lineTo(30 + x, yy) : g.moveTo(30 + x, yy); }
        g.stroke();
        T(g, lab, 38, y0 + 20, 15, c); T(g, (R.range(10, 990)).toFixed(1), 474, y0 + 20, 15, c, 'right');
      });
      break;
    }
    case 2: {
      const L = [['HULL INTEGRITY', '97%'], ['SHIELD GRID', 'ONLINE'], ['POWER BUS A', '412 kW'], ['POWER BUS B', '398 kW'], ['COOLANT', 'NOMINAL'], ['RCS FUEL', '81%'], ['COMMS', 'LINK OK'], ['AI CORE', 'IDLE'], ['GRAV PLATING', '1.00 g'], ['HEAT SINK', '64%'], ['EVA LOCKS', 'SEALED'], ['DRONES', '4 / 4']];
      L.forEach(([a, b], k) => { const y = 84 + k * 34; T(g, a, 30, y, 18, rgba(CY, 0.85)); T(g, b, 482, y, 18, b === 'IDLE' ? OR : CY, 'right'); g.strokeStyle = rgba(CY, 0.15); g.beginPath(); g.moveTo(30, y + 10); g.lineTo(482, y + 10); g.stroke(); });
      break;
    }
    case 3: {
      g.strokeStyle = CY; g.lineWidth = 2.5;
      const pts = [[40, 270], [70, 230], [150, 205], [250, 190], [360, 188], [420, 205], [470, 240], [478, 262], [470, 292], [420, 322], [330, 340], [180, 340], [90, 325], [52, 300]];
      g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      g.fillStyle = rgba(CY, 0.08); g.fill();
      g.lineWidth = 1.2; g.strokeStyle = rgba(CY, 0.7);
      for (const y of [232, 268, 304]) { g.beginPath(); g.moveTo(80, y); g.lineTo(455, y); g.stroke(); }
      for (let x = 120; x < 440; x += 40) { g.beginPath(); g.moveTo(x, 200); g.lineTo(x, 335); g.stroke(); }
      g.fillStyle = OR; g.fillRect(300, 240, 36, 22); g.fillStyle = GR; g.fillRect(180, 276, 36, 22);
      T(g, 'DECK A', 30, 110, 16, CY); T(g, 'DECK B', 30, 134, 16, CY); T(g, 'DECK C', 30, 158, 16, CY);
      g.strokeStyle = rgba(CY, 0.7); g.beginPath(); g.moveTo(40, 390); g.lineTo(478, 390); g.moveTo(40, 382); g.lineTo(40, 398); g.moveTo(478, 382); g.lineTo(478, 398); g.stroke();
      T(g, '98.4 m', 259, 418, 18, CY, 'center'); T(g, 'ENGINEERING ▲ ALERT', 482, 470, 15, OR, 'right');
      break;
    }
    case 4: {
      const cx = 230, cy = 280, r = 120;
      const gr = g.createRadialGradient(cx - 40, cy - 40, 10, cx, cy, r); gr.addColorStop(0, '#2a6a8e'); gr.addColorStop(0.7, '#123a58'); gr.addColorStop(1, '#0a2238');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.strokeStyle = rgba(CY, 0.9); g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      g.strokeStyle = rgba(CY, 0.25); g.lineWidth = 1; for (let k = -3; k <= 3; k++) { g.beginPath(); g.ellipse(cx, cy, r * Math.cos(k * 0.4), r, 0, 0, 7); g.stroke(); }
      g.setLineDash([8, 6]); g.strokeStyle = CY; g.lineWidth = 1.8; g.beginPath(); g.ellipse(cx, cy, 200, 70, -0.25, 0, 7); g.stroke(); g.setLineDash([]);
      const a = 0.4, sx = cx + Math.cos(a) * 200 * Math.cos(-0.25) - Math.sin(a) * 70 * Math.sin(-0.25), sy = cy + Math.cos(a) * 200 * Math.sin(-0.25) + Math.sin(a) * 70 * Math.cos(-0.25);
      g.fillStyle = OR; g.beginPath(); g.moveTo(sx, sy - 9); g.lineTo(sx + 8, sy + 7); g.lineTo(sx - 8, sy + 7); g.closePath(); g.fill();
      T(g, 'KEPLER-442b', 30, 86, 20, CY, 'left', 'VSansBold'); T(g, 'ALT 420 km   INC 12.4°', 30, 112, 15, rgba(CY, 0.8)); T(g, 'PERIAPSIS T-00:14:52', 30, 478, 16, OR);
      break;
    }
    case 5: {
      g.strokeStyle = rgba(CY, 0.35); g.lineWidth = 1;
      for (let k = 0; k <= 12; k++) { const x = 40 + k * 36; g.beginPath(); g.moveTo(256 + (x - 256) * 0.35, 120); g.lineTo(x, 470); g.stroke(); }
      for (let k = 0; k <= 8; k++) { const t = k / 8, y = 120 + 350 * t * t; const s = 0.35 + 0.65 * t * t; g.beginPath(); g.moveTo(256 - 216 * s, y); g.lineTo(256 + 216 * s, y); g.stroke(); }
      g.strokeStyle = OR; g.lineWidth = 3; g.beginPath(); g.moveTo(150, 460); g.bezierCurveTo(140, 330, 380, 300, 300, 150); g.stroke();
      for (const [x, y] of [[150, 460], [205, 340], [318, 255], [300, 150]]) { g.strokeStyle = CY; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke(); }
      T(g, 'ETA 04:12:33', 30, 86, 20, CY, 'left', 'VSansBold'); T(g, 'WP 3/4  ·  0.82 c', 482, 86, 15, rgba(CY, 0.8), 'right'); T(g, 'COURSE LOCKED', 482, 480, 16, GR, 'right');
      break;
    }
    case 6: {
      T(g, 'REACTOR', 256, 120, 40, OR, 'center', 'VSansBold'); T(g, '98%', 256, 200, 72, OR, 'center', 'VSansBold');
      for (let k = 0; k < 10; k++) { const h = [0.9, 0.95, 0.85, 0.98, 0.92, 0.88, 0.97, 0.9, 0.94, 0.86][k] * 200, x = 52 + k * 42; g.strokeStyle = rgba(OR, 0.4); g.lineWidth = 1; g.strokeRect(x + 0.5, 250.5, 30, 200); g.fillStyle = k === 3 ? '#ffd080' : OR; for (let s = 0; s < h; s += 10) g.fillRect(x + 3, 450 - s - 8, 24, 7); }
      T(g, 'CORE TEMP 2.1 MK', 30, 486, 15, rgba(OR, 0.85)); T(g, 'OUTPUT 4.8 GW', 482, 486, 15, rgba(OR, 0.85), 'right');
      break;
    }
    case 7: {
      g.strokeStyle = rgba(GR, 0.3); g.lineWidth = 1; g.strokeRect(30.5, 70.5, 452, 200);
      g.strokeStyle = GR; g.lineWidth = 2.6; g.beginPath();
      for (let x = 0; x <= 452; x++) { const t = mod(x, 113) / 113; let y = 0; if (t > 0.3 && t < 0.34) y = -(t - 0.3) * 1500; else if (t >= 0.34 && t < 0.38) y = -60 + (t - 0.34) * 3200; else if (t >= 0.38 && t < 0.42) y = 68 - (t - 0.38) * 1700; else if (t > 0.6 && t < 0.72) y = -Math.sin((t - 0.6) / 0.12 * Math.PI) * 14; const yy = 180 + y; x ? g.lineTo(30 + x, yy) : g.moveTo(30 + x, yy); }
      g.stroke();
      T(g, '72 BPM', 30, 350, 56, GR, 'left', 'VSansBold'); T(g, 'SpO2 98%', 30, 420, 40, GR, 'left', 'VSansBold');
      T(g, 'BP 118/76', 482, 350, 20, rgba(GR, 0.8), 'right'); T(g, 'TEMP 36.7°C', 482, 380, 20, rgba(GR, 0.8), 'right'); T(g, 'PATIENT: CREW 04', 30, 480, 16, rgba(GR, 0.8));
      break;
    }
    case 8: {
      for (let k = 0; k < 140; k++) { const x = R.range(20, 492), y = R.range(56, 492), r = R.range(0.6, 2); g.fillStyle = rgba(CY, R.range(0.3, 0.9)); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      const cons = [[[90, 140], [150, 120], [210, 160], [250, 130], [300, 180]], [[320, 300], [380, 270], [430, 320], [400, 400], [330, 380], [320, 300]], [[100, 330], [150, 380], [120, 450], [200, 430]]];
      g.strokeStyle = rgba(CY, 0.8); g.lineWidth = 1.5;
      for (const c of cons) { g.beginPath(); c.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); for (const [x, y] of c) { g.fillStyle = CY; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } }
      T(g, 'ORION ARM', 150, 105, 15, CY); T(g, 'CYGNUS', 340, 255, 15, CY); T(g, 'HOME', 128, 475, 15, OR);
      g.strokeStyle = OR; g.lineWidth = 2; g.beginPath(); g.arc(380, 270, 14, 0, 7); g.stroke();
      break;
    }
    case 9: {
      const gauge = (cx, v, lab, val, c) => {
        g.lineWidth = 16; g.strokeStyle = rgba(c, 0.18); g.beginPath(); g.arc(cx, 270, 92, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
        g.strokeStyle = c; g.beginPath(); g.arc(cx, 270, 92, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * v)); g.stroke();
        g.lineWidth = 2; for (let k = 0; k <= 10; k++) { const a = Math.PI * (0.75 + 0.15 * k); g.beginPath(); g.moveTo(cx + Math.cos(a) * 108, 270 + Math.sin(a) * 108); g.lineTo(cx + Math.cos(a) * 116, 270 + Math.sin(a) * 116); g.stroke(); }
        T(g, val, cx, 282, 34, c, 'center', 'VSansBold'); T(g, lab, cx, 400, 16, c, 'center');
      };
      gauge(136, 0.84, 'MAIN DRIVE', '84%', CY); gauge(376, 0.55, 'VELOCITY AU/h', '1.2', OR);
      T(g, 'BURN 00:03:20', 256, 470, 18, CY, 'center');
      break;
    }
    case 10: {
      T(g, 'MANIFEST', 30, 88, 26, CY, 'left', 'VSansBold'); T(g, 'BAY 2', 482, 88, 18, OR, 'right');
      const rows = [['CRG-107', '12t', 'OK'], ['CRG-112', '4.5t', 'OK'], ['CRG-118', '8t', 'OK'], ['CRG-121', '2t', 'CHECK'], ['CRG-130', '16t', 'OK'], ['CRG-131', '0.8t', 'OK'], ['MED-004', '0.3t', 'OK'], ['H2O-01', '22t', 'OK'], ['FUEL-02', '30t', 'LOW']];
      rows.forEach(([a, b, c], k) => { const y = 132 + k * 38; T(g, a, 30, y, 20, CY); T(g, b, 300, y, 20, CY, 'right'); T(g, c, 482, y, 20, c === 'OK' ? GR : OR, 'right'); g.strokeStyle = rgba(CY, 0.15); g.beginPath(); g.moveTo(30, y + 12); g.lineTo(482, y + 12); g.stroke(); });
      break;
    }
    case 11: {
      const lines = ['> diag --all', 'core........ OK', 'nav......... OK', 'comms....... OK', 'thermal..... 61%', '> sync deck_b', 'syncing ███████░░ 78%', '> _'];
      lines.forEach((l, k) => T(g, l, 30, 86 + k * 26, 18, k === 6 ? OR : CY));
      for (let k = 0; k < 24; k++) { const h = (0.2 + 0.8 * Math.abs(Math.sin(k * 0.7) * Math.cos(k * 0.23))) * 150, x = 34 + k * 19; g.fillStyle = k % 5 === 0 ? OR : CY; for (let s = 0; s < h; s += 8) g.fillRect(x, 480 - s - 6, 14, 5); }
      break;
    }
    case 12: {
      g.fillStyle = rgba(OR, 0.12); g.fillRect(14, 48, 484, 450);
      for (let x = -40; x < 520; x += 40) { g.fillStyle = OR; g.beginPath(); g.moveTo(x, 470); g.lineTo(x + 20, 470); g.lineTo(x + 44, 494); g.lineTo(x + 24, 494); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x, 56); g.lineTo(x + 20, 56); g.lineTo(x + 44, 80); g.lineTo(x + 24, 80); g.closePath(); g.fill(); }
      g.strokeStyle = OR; g.lineWidth = 8; g.beginPath(); g.moveTo(256, 112); g.lineTo(340, 262); g.lineTo(172, 262); g.closePath(); g.stroke();
      g.fillStyle = OR; g.beginPath(); g.moveTo(266, 140); g.lineTo(236, 206); g.lineTo(258, 206); g.lineTo(246, 248); g.lineTo(280, 186); g.lineTo(258, 186); g.closePath(); g.fill();
      T(g, 'ВНИМАНИЕ', 256, 336, 54, OR, 'center', 'VSansBold'); T(g, 'ВЫСОКОЕ', 256, 388, 34, OR, 'center', 'VSansBold'); T(g, 'НАПРЯЖЕНИЕ', 256, 430, 34, OR, 'center', 'VSansBold');
      break;
    }
    case 13: {
      for (let r = 0; r < 14; r++) for (let c = 0; c < 14; c++) { const v = R.f(); const colr = v < 0.12 ? OR : v < 0.75 ? GR : null; const x = 52 + c * 31, y = 82 + r * 28; g.fillStyle = colr ? colr : rgba(GR, 0.12); g.beginPath(); g.roundRect(x, y, 18, 12, 3); g.fill(); }
      T(g, 'NODE 01-14   LOAD 63%', 30, 486, 16, GR);
      break;
    }
    case 14: {
      g.fillStyle = CY; emblemPath(g, 156, 70, 200); g.fill();
      spacedText(g, 'V E S P E R', 256, 360, 46, 'VSans', 380);
      T(g, 'DEEP SPACE EXPLORER', 256, 400, 18, rgba(CY, 0.8), 'center');
      g.fillStyle = rgba(CY, 0.25); g.fillRect(106, 440, 300, 6); g.fillStyle = CY; g.fillRect(106, 440, 220, 6);
      T(g, 'BOOT 74%', 256, 478, 15, rgba(CY, 0.8), 'center');
      break;
    }
    case 15: {
      const cx = 256, cy = 250;
      g.lineWidth = 22; g.strokeStyle = rgba(CY, 0.15); g.beginPath(); g.arc(cx, cy, 130, 0, 7); g.stroke();
      g.strokeStyle = CY; g.beginPath(); g.arc(cx, cy, 130, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.84); g.stroke();
      g.lineWidth = 2; g.strokeStyle = rgba(CY, 0.6); g.beginPath(); g.arc(cx, cy, 104, 0, 7); g.stroke();
      T(g, 'O₂ 21%', cx, cy + 14, 52, CY, 'center', 'VSansBold'); T(g, 'LIFE SUPPORT', cx, cy + 50, 16, rgba(CY, 0.8), 'center');
      T(g, 'CO₂ 0.04%', 40, 460, 18, CY); T(g, '101 kPa', 256, 460, 18, CY, 'center'); T(g, '21.5°C', 472, 460, 18, GR, 'right');
      break;
    }
    default: break;
  }
}
async function genScreens(job) {
  registerFonts();
  const sc = job.scale, W = Math.round(2048 * sc), H = W, N = W * H, cs = W / 4;
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  const R = new RNG(6060);
  const cells = {};
  for (let k = 0; k < 16; k++) {
    const cx = (k % 4) * cs, cy = Math.floor(k / 4) * cs;
    cells[String(k)] = [cx, cy, cs, cs];
    g.save(); g.translate(cx, cy); g.scale(cs / 512, cs / 512); g.beginPath(); g.rect(0, 0, 512, 512); g.clip();
    drawScreen(g, k, R);
    g.restore();
  }
  const d = g.getImageData(0, 0, W, H).data;
  const img = ch3(N), bright = ch3(N);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) { const v = d[i * 4 + c] / 255; img[c][i] = v; bright[c][i] = Math.max(0, v - 0.25); }
  const glow = bright.map((b) => blur(b, W, H, 5 * sc * 2, 5 * sc * 2, 3));
  const glow2 = bright.map((b) => blur(b, W, H, 14 * sc * 2, 14 * sc * 2, 3));
  const em = ch3(N), base = ch3(N);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) { const v = clamp(img[c][i] + glow[c][i] * 0.55 + glow2[c][i] * 0.35); em[c][i] = v; base[c][i] = 0.02 + v * 0.25; }
  return { Screens: await job.write('Screens', { w: W, h: H, base, ao: F(N, 1), rough: F(N, 0.15), metal: F(N, 0), emission: em, tileMeters: null, cells }) };
}

// ============================================================ task table
const TASKS = [
  { id: 'Hull', sets: ['HullPanel_Light', 'HullPanel_Mid', 'HullPanel_Dark'], fn: genHull },
  { id: 'Walls', sets: ['Wall_Panel', 'Wall_White', 'Wall_Industrial'], fn: genWalls },
  { id: 'Screens', sets: ['Screens'], fn: genScreens },
  { id: 'Greeble_Tech', sets: ['Greeble_Tech'], fn: genGreeble },
  { id: 'Decals', sets: ['Decals'], fn: genDecals },
  { id: 'Floor_Deck', sets: ['Floor_Deck'], fn: genFloorDeck },
  { id: 'Floor_Grate', sets: ['Floor_Grate'], fn: genFloorGrate },
  { id: 'Ceiling', sets: ['Ceiling'], fn: genCeiling },
  { id: 'Metal_Dark', sets: ['Metal_Dark'], fn: genMetalDark },
  { id: 'Engine_Metal', sets: ['Engine_Metal'], fn: genEngine },
  { id: 'Metal_Painted', sets: ['Metal_Painted'], fn: genMetalPainted },
  { id: 'Metal_Brushed', sets: ['Metal_Brushed'], fn: genMetalBrushed },
  { id: 'Wood', sets: ['Wood'], fn: genWood },
  { id: 'Hazard', sets: ['Hazard'], fn: genHazard },
  { id: 'Fabric', sets: ['Fabric'], fn: genFabric },
  { id: 'Plastic_White', sets: ['Plastic_White'], fn: genPlastic },
  { id: 'Rubber', sets: ['Rubber'], fn: genRubber },
  { id: 'LightPanel', sets: ['LightPanel'], fn: genLightPanel },
];
const ALL_SETS = TASKS.flatMap((t) => t.sets);

// ============================================================ preview
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
async function thumb(file, size) {
  const sharp = await getSharp();
  return sharp(file).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: '#7a7a7a' }).removeAlpha().raw().toBuffer();
}
function litImage(b, n, o, e, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const L = [-0.45, 0.55, 0.7], ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const Hh = [L[0], L[1], L[2] + 1], hl = Math.hypot(...Hh); Hh[0] /= hl; Hh[1] /= hl; Hh[2] /= hl;
  for (let i = 0; i < size * size; i++) {
    let nx = n[i * 3] / 127.5 - 1, ny = n[i * 3 + 1] / 127.5 - 1, nz = n[i * 3 + 2] / 127.5 - 1; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const ao = o[i * 3] / 255, r = Math.max(0.05, o[i * 3 + 1] / 255), m = o[i * 3 + 2] / 255;
    const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), ndh = Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]);
    const sh = 2 / (r ** 4) - 2, spec = ((sh + 2) / 8) * ndh ** sh * ndl;
    for (let c = 0; c < 3; c++) {
      const a = s2l(b[i * 3 + c] / 255), f0 = lerp(0.04, a, m);
      let v = a * (1 - m) * (ndl * 1.2 + 0.12 * ao) + f0 * (Math.min(spec, 30) + 0.3 * ao * (1 - r * 0.6));
      if (e) v += s2l(e[i * 3 + c] / 255);
      out[i * 4 + c] = Math.round(clamp(l2s(v)) * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}
function rgbToRGBA(buf, size) { const o = new Uint8ClampedArray(size * size * 4); for (let i = 0; i < size * size; i++) { o[i * 4] = buf[i * 3]; o[i * 4 + 1] = buf[i * 3 + 1]; o[i * 4 + 2] = buf[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; }
async function buildPreview(outDir, manifest) {
  registerFonts();
  const sharp = await getSharp();
  if (!sharp) { console.warn('sharp unavailable: preview skipped'); return; }
  const names = ALL_SETS.filter((n) => manifest.sets[n]);
  const T0 = 220, GAP = 8, LAB = 24, cols = 2, blockW = 4 * T0 + 3 * GAP, rowsN = Math.ceil(names.length / cols);
  const Wd = cols * blockW + (cols + 1) * 24, Hd = rowsN * (T0 + LAB + 18) + 40;
  const cv = createCanvas(Wd, Hd), g = cv.getContext('2d');
  g.fillStyle = '#16181c'; g.fillRect(0, 0, Wd, Hd);
  g.font = '16px VSansBold'; g.fillStyle = '#ccc'; g.fillText('VESPER Explorer textures — BaseColor | Normal | ORM | lit preview (emission added)', 24, 26);
  for (let k = 0; k < names.length; k++) {
    const n = names[k], e = manifest.sets[n], cx = 24 + (k % cols) * (blockW + 24), cy = 40 + Math.floor(k / cols) * (T0 + LAB + 18);
    const f = (m) => path.join(outDir, e.maps[m]);
    const [b, nn, o] = await Promise.all([thumb(f('baseColor'), T0), thumb(f('normal'), T0), thumb(f('orm'), T0)]);
    const em = e.maps.emission ? await thumb(f('emission'), T0) : null;
    const imgs = [rgbToRGBA(b, T0), rgbToRGBA(nn, T0), rgbToRGBA(o, T0), litImage(b, nn, o, em, T0)];
    imgs.forEach((im, q) => { const id = g.createImageData(T0, T0); id.data.set(im); g.putImageData(id, cx + q * (T0 + GAP), cy + LAB); });
    g.font = '15px VSansBold'; g.fillStyle = '#e8e8e8'; g.textAlign = 'left';
    g.fillText(`${n}  ${e.size[0]}²  ${e.tileMeters ? `tile ${e.tileMeters[0]} m` : 'atlas'}${e.maps.emission ? '  +emission' : ''}${e.alpha ? '  +alpha' : ''}`, cx, cy + 17);
  }
  fs.writeFileSync(path.join(outDir, '_preview.jpg'), await cv.encode('jpeg', 88));
  // 2x2 tiling check: crop around the tile corner (full resolution) for tiling sets — base + lit
  const check = names.filter((n) => manifest.sets[n].tileMeters).slice(0, 18);
  const C = 256, per = 6, rows2 = Math.ceil(check.length / per);
  const cv2 = createCanvas(per * (C * 2 + 12) + 12, rows2 * (C + 30) + 12), g2 = cv2.getContext('2d');
  g2.fillStyle = '#16181c'; g2.fillRect(0, 0, cv2.width, cv2.height);
  for (let k = 0; k < check.length; k++) {
    const e = manifest.sets[check[k]], [w, h] = e.size, hc = C / 2;
    const ox = 12 + (k % per) * (C * 2 + 12), oy = 12 + Math.floor(k / per) * (C + 30);
    for (const [mi, map] of [[0, 'baseColor'], [1, 'normal']].map(([a, b]) => [a, b])) {
      const file = path.join(outDir, e.maps[map]);
      const pieces = [[w - hc, h - hc, 0, 0], [0, h - hc, hc, 0], [w - hc, 0, 0, hc], [0, 0, hc, hc]];
      for (const [l, t, dx, dy] of pieces) {
        const buf = await sharp(file).extract({ left: l, top: t, width: hc, height: hc }).flatten({ background: '#7a7a7a' }).removeAlpha().raw().toBuffer();
        const id = g2.createImageData(hc, hc); id.data.set(rgbToRGBA(buf, hc)); g2.putImageData(id, ox + mi * C + dx, oy + dy);
      }
    }
    g2.font = '13px VSans'; g2.fillStyle = '#ddd'; g2.fillText(`${check[k]} (seam at centre)`, ox, oy + C + 18);
  }
  fs.writeFileSync(path.join(outDir, '_tiles.jpg'), await cv2.encode('jpeg', 90));
}

// ============================================================ CLI
function parseArgs(a) {
  const o = {};
  for (let k = 0; k < a.length; k++) {
    if (!a[k].startsWith('--')) continue;
    const key = a[k].slice(2);
    if (k + 1 < a.length && !a[k + 1].startsWith('--')) o[key] = a[++k]; else o[key] = true;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(typeof args.out === 'string' ? args.out : 'build/Textures');
const SCALE = parseFloat(args.scale ?? '1');
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',').map((s) => s.trim()).filter(Boolean)) : null;

async function runTask(id) {
  const t = TASKS.find((x) => x.id === id);
  const want = new Set(t.sets.filter((s) => !ONLY || ONLY.has(s)));
  const job = { scale: SCALE, want, write: (name, s) => writeSet(OUT, name, s) };
  return t.fn(job);
}

if (args.task) {
  const t0 = Date.now();
  const res = await runTask(args.task);
  process.stdout.write(`@@RESULT ${JSON.stringify({ task: args.task, ms: Date.now() - t0, sets: res })}\n`);
} else {
  const t0 = Date.now();
  if (ONLY) for (const n of ONLY) if (!ALL_SETS.includes(n)) { console.error(`Unknown set "${n}". Known: ${ALL_SETS.join(', ')}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const tasks = TASKS.filter((t) => !ONLY || t.sets.some((s) => ONLY.has(s)));
  const jobsN = Math.max(1, Math.min(parseInt(args.jobs ?? '0', 10) || (os.availableParallelism?.() ?? os.cpus().length), 8, tasks.length));
  const results = {};
  let next = 0, failed = false;
  const runOne = () => new Promise((resolve) => {
    if (next >= tasks.length) return resolve();
    const t = tasks[next++];
    const cargs = [SELF, '--task', t.id, '--out', OUT, '--scale', String(SCALE)];
    if (ONLY) cargs.push('--only', [...ONLY].join(','));
    const cp = spawn(process.execPath, ['--max-old-space-size=6144', ...cargs], { stdio: ['ignore', 'pipe', 'inherit'] });
    let so = '';
    cp.stdout.on('data', (d) => { so += d; });
    cp.on('close', (code) => {
      const line = so.split('\n').find((l) => l.startsWith('@@RESULT '));
      if (code !== 0 || !line) { console.error(`task ${t.id} failed (exit ${code})`); failed = true; }
      else { const r = JSON.parse(line.slice(9)); Object.assign(results, r.sets); console.log(`  ${t.id.padEnd(14)} ${(r.ms / 1000).toFixed(1)}s  [${Object.keys(r.sets).join(', ')}]`); }
      resolve(runOne());
    });
  });
  console.log(`Generating ${tasks.length} task(s) with ${jobsN} worker(s), scale ${SCALE} → ${OUT}`);
  await Promise.all(Array.from({ length: jobsN }, runOne));
  const mfPath = path.join(OUT, 'manifest.json');
  let manifest = { sets: {} };
  if (ONLY && fs.existsSync(mfPath)) { try { manifest = JSON.parse(fs.readFileSync(mfPath, 'utf8')); } catch { /* rebuild */ } }
  const merged = { ...manifest.sets, ...results };
  const sets = {};
  for (const n of ALL_SETS) if (merged[n]) sets[n] = merged[n];
  manifest = {
    generator: 'ship/src/textures.mjs',
    conventions: {
      baseColor: 'sRGB', orm: 'R=ambient occlusion, G=roughness, B=metallic (linear, glTF)', normal: 'tangent space, OpenGL (+Y up; glTF / Unity)',
      metallicSmoothness: 'Unity: RGB=metallic, A=smoothness (1-roughness)', tileMeters: 'surface meters covered by one texture repeat (UV = world meters / tileMeters)',
      cells: 'atlas pixel rects [x,y,w,h], origin top-left', walls: 'Wall_*: image bottom edge = floor line (kick plate in bottom 0.15 m)',
    },
    sets,
  };
  fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2));
  if (!args['no-preview']) await buildPreview(OUT, manifest);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s${failed ? ' (with failures)' : ''}`);
  if (failed) process.exit(1);
}
