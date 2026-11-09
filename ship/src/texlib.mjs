// Shared helpers for the procedural PBR texture generator.
// All fields are Float32Array (row-major, w*h). Every spatial operation wraps
// around the borders so tiling textures stay seamless.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

let sharpMod = null;
export async function getSharp() {
  if (sharpMod !== null) return sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
    sharpMod.concurrency(1);
  } catch {
    sharpMod = false;
  }
  return sharpMod;
}

// ---------------------------------------------------------------- fonts
let fontsDone = false;
export function registerFonts() {
  if (fontsDone) return;
  fontsDone = true;
  const d = '/usr/share/fonts/truetype/';
  const list = [
    ['dejavu/DejaVuSans.ttf', 'VSans'],
    ['dejavu/DejaVuSans-Bold.ttf', 'VSansBold'],
    ['dejavu/DejaVuSansMono.ttf', 'VMono'],
    ['dejavu/DejaVuSansMono-Bold.ttf', 'VMonoBold'],
    ['freefont/FreeSans.ttf', 'FSans'],
    ['freefont/FreeSansBold.ttf', 'FSansBold'],
  ];
  for (const [f, alias] of list) {
    const p = d + f;
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, alias);
  }
}

// ---------------------------------------------------------------- math
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function ss(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export const mod = (a, n) => ((a % n) + n) % n;
export const rgb = (r, g, b) => [r / 255, g / 255, b / 255];

export class RNG {
  constructor(seed) { this.s = seed >>> 0 || 1; }
  f() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  pick(a) { return a[Math.floor(this.f() * a.length)]; }
  chance(p) { return this.f() < p; }
}

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- noise
// Periodic gradient noise: fx/fy = lattice cells across the texture (integers
// so the lattice wraps exactly). Returns roughly [-1, 1].
function gradOctave(out, w, h, FX, FY, seed, amp) {
  const n = FX * FY;
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let j = 0; j < FY; j++)
    for (let i = 0; i < FX; i++) {
      const a = hash3(i, j, seed) * Math.PI * 2;
      gx[j * FX + i] = Math.cos(a);
      gy[j * FX + i] = Math.sin(a);
    }
  const xi0 = new Int32Array(w), xi1 = new Int32Array(w), xt = new Float32Array(w), xf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) * FX) / w, i = Math.floor(u), t = u - i;
    xi0[x] = i % FX; xi1[x] = (i + 1) % FX; xt[x] = t; xf[x] = t * t * t * (t * (t * 6 - 15) + 10);
  }
  for (let y = 0; y < h; y++) {
    const v = ((y + 0.5) * FY) / h, j = Math.floor(v), ty = v - j;
    const fy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const r0 = (j % FY) * FX, r1 = ((j + 1) % FY) * FX, ty1 = ty - 1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const tx = xt[x], tx1 = tx - 1, a0 = r0 + xi0[x], b0 = r0 + xi1[x], a1 = r1 + xi0[x], b1 = r1 + xi1[x];
      const n00 = gx[a0] * tx + gy[a0] * ty, n10 = gx[b0] * tx1 + gy[b0] * ty;
      const n01 = gx[a1] * tx + gy[a1] * ty1, n11 = gx[b1] * tx1 + gy[b1] * ty1;
      const f = xf[x], nx0 = n00 + f * (n10 - n00), nx1 = n01 + f * (n11 - n01);
      out[row + x] += amp * (nx0 + fy * (nx1 - nx0));
    }
  }
}

export function fbm(w, h, { fx = 4, fy = fx, oct = 4, gain = 0.5, lac = 2, seed = 1 } = {}) {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const FX = Math.max(1, Math.round(fx * Math.pow(lac, o)));
    const FY = Math.max(1, Math.round(fy * Math.pow(lac, o)));
    if (FX > w / 1.5 || FY > h / 1.5) break;
    gradOctave(out, w, h, FX, FY, seed * 7919 + o * 104729, amp);
    tot += amp; amp *= gain;
  }
  const k = 1.45 / (tot || 1);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

export function white(w, h, seed) {
  const o = new Float32Array(w * h);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < o.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    o[i] = (s >>> 0) / 4294967296;
  }
  return o;
}

// Bilinear wrapped sample.
export function sample(f, w, h, x, y) {
  x = mod(x, w); y = mod(y, h);
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
  const a = f[y0 * w + x0], b = f[y0 * w + x1], c = f[y1 * w + x0], d = f[y1 * w + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// ---------------------------------------------------------------- filters
function boxH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + mod(k, w)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = s * inv;
      s += src[row + ((x + r + 1) % w)] - src[row + mod(x - r, w)];
    }
  }
}
function boxV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  const acc = new Float64Array(w);
  for (let k = -r; k <= r; k++) {
    const row = mod(k, h) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w, add = ((y + r + 1) % h) * w, sub = mod(y - r, h) * w;
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc[x] * inv;
      acc[x] += src[add + x] - src[sub + x];
    }
  }
}
// ~Gaussian blur (3 box passes), wrapped. rx/ry in pixels.
export function blur(src, w, h, rx, ry = rx, passes = 3) {
  rx = Math.max(0, Math.round(rx)); ry = Math.max(0, Math.round(ry));
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    if (rx > 0) { boxH(a, b, w, h, Math.min(rx, (w >> 1) - 1)); [a, b] = [b, a]; }
    if (ry > 0) { boxV(a, b, w, h, Math.min(ry, (h >> 1) - 1)); [a, b] = [b, a]; }
  }
  return a;
}

// Tangent-space normal map (OpenGL / glTF: +Y = image up) from a height field
// in pixel units. Sobel with wrap-around sampling.
export function normalFromHeight(hg, w, h, strength = 1) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hg[ym + xp] + 2 * hg[y0 + xp] + hg[yp + xp] - hg[ym + xm] - 2 * hg[y0 + xm] - hg[yp + xm]) * 0.125;
      const dy = (hg[yp + xm] + 2 * hg[yp + x] + hg[yp + xp] - hg[ym + xm] - 2 * hg[ym + x] - hg[ym + xp]) * 0.125;
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const o = (y0 + x) * 3;
      out[o] = Math.round((nx * l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * l * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

// Cavity based AO: terms [{r, k}] where k scales (blur_r(h) - h) in height units.
export function cavityAO(hg, w, h, terms, floor = 0.08) {
  const ao = new Float32Array(w * h).fill(1);
  for (const { r, k } of terms) {
    const b = blur(hg, w, h, r);
    for (let i = 0; i < ao.length; i++) {
      const c = b[i] - hg[i];
      if (c > 0) ao[i] -= c * k;
    }
  }
  for (let i = 0; i < ao.length; i++) ao[i] = clamp(ao[i], floor, 1);
  return ao;
}

// Convexity (positive on raised edges) in height units.
export function convexity(hg, w, h, r) {
  const b = blur(hg, w, h, r);
  const o = new Float32Array(w * h);
  for (let i = 0; i < o.length; i++) o[i] = hg[i] - b[i];
  return o;
}

// Downward accumulation with decay (grime streaks), wraps vertically.
export function dripDown(src, w, h, decay) {
  const out = new Float32Array(w * h), acc = new Float32Array(w);
  for (let pass = 0; pass < 2; pass++)
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const v = Math.max(src[row + x], acc[x] * decay);
        acc[x] = v;
        if (pass) out[row + x] = v;
      }
    }
  return out;
}

// ---------------------------------------------------------------- raster helpers
// Visit pixels of a disk centred at (cx,cy) (wrapped). cb(index, dx, dy, d)
export function forDisk(w, h, cx, cy, r, cb) {
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy, row = mod(y, h) * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r + 1) cb(row + mod(x, w), dx, dy, d);
    }
  }
}
// Visit pixels of rect [x0,x1)x[y0,y1) (wrapped). cb(index, px, py) with pixel centre coords.
export function forRect(w, h, x0, y0, x1, y1, cb) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const row = mod(y, h) * w;
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) cb(row + mod(x, w), x + 0.5, y + 0.5);
  }
}
// Distance from point inside rect to its border, with optional 45° corner chamfer.
export function rectDist(px, py, x0, y0, x1, y1, ch = 0) {
  const dX = Math.min(px - x0, x1 - px), dY = Math.min(py - y0, y1 - py);
  let d = Math.min(dX, dY);
  if (ch > 0) d = Math.min(d, (dX + dY - ch) * 0.70710678);
  return d;
}
// Distance to a rounded rect border (positive inside).
export function roundRectDist(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const outside = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0);
  return r - outside;
}

// Draw into an RGB mask canvas (additive), optionally 3x3 wrapped, return 3 float masks.
export function canvasMasks(w, h, draw, { wrap = true } = {}) {
  registerFonts();
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const offs = wrap ? [-1, 0, 1] : [0];
  for (const oy of offs)
    for (const ox of offs) {
      g.save(); g.translate(ox * w, oy * h); draw(g); g.restore();
    }
  const d = g.getImageData(0, 0, w, h).data, N = w * h;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = d[i * 4] / 255; G[i] = d[i * 4 + 1] / 255; B[i] = d[i * 4 + 2] / 255; }
  return [R, G, B];
}

// Colour layer: three float channels in sRGB 0..1.
export function colorLayer(N, c) {
  return [new Float32Array(N).fill(c[0]), new Float32Array(N).fill(c[1]), new Float32Array(N).fill(c[2])];
}
// base = lerp(base, color, mask*opacity)
export function paint(base, mask, c, op = 1) {
  const [r, g, b] = base;
  for (let i = 0; i < r.length; i++) {
    const t = mask[i] * op;
    if (t <= 0) continue;
    r[i] += (c[0] - r[i]) * t; g[i] += (c[1] - g[i]) * t; b[i] += (c[2] - b[i]) * t;
  }
}
export function mulLayer(base, f, amt = 1) {
  for (const ch of base) for (let i = 0; i < ch.length; i++) ch[i] *= 1 + (f[i] - 1) * amt;
}

// ---------------------------------------------------------------- output
const to8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

async function encode(buf, w, h, ch, file) {
  const sharp = await getSharp();
  if (sharp) {
    let img = sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), { raw: { width: w, height: h, channels: ch } });
    img = file.endsWith('.png') ? img.png({ compressionLevel: 7 }) : img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' });
    await img.toFile(file);
    return;
  }
  // Fallback: canvas encoder (4:2:0 JPEG — lower quality for packed maps).
  const c = createCanvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    id.data[i * 4] = buf[i * ch]; id.data[i * 4 + 1] = buf[i * ch + 1]; id.data[i * 4 + 2] = buf[i * ch + 2];
    id.data[i * 4 + 3] = ch === 4 ? buf[i * ch + 3] : 255;
  }
  g.putImageData(id, 0, 0);
  fs.writeFileSync(file, await c.encode(file.endsWith('.png') ? 'png' : 'jpeg', 90));
}

// set: { w, h, base:[r,g,b], alpha?, ao, rough, metal, normal?:Uint8 rgb | height?, normalStrength?,
//        emission?:[r,g,b], tileMeters, cells? }
export async function writeSet(outDir, name, s) {
  const { w, h } = s, N = w * h;
  const maps = {};
  const hasA = !!s.alpha;
  const ch = hasA ? 4 : 3;
  const bc = new Uint8Array(N * ch);
  for (let i = 0; i < N; i++) {
    bc[i * ch] = to8(s.base[0][i]); bc[i * ch + 1] = to8(s.base[1][i]); bc[i * ch + 2] = to8(s.base[2][i]);
    if (hasA) bc[i * ch + 3] = to8(s.alpha[i]);
  }
  maps.baseColor = `T_${name}_BaseColor.${hasA ? 'png' : 'jpg'}`;
  const orm = new Uint8Array(N * 3), ms = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ao = s.ao ? s.ao[i] : 1, r = s.rough[i], m = s.metal[i];
    orm[i * 3] = to8(ao); orm[i * 3 + 1] = to8(r); orm[i * 3 + 2] = to8(m);
    const m8 = to8(m);
    ms[i * 4] = m8; ms[i * 4 + 1] = m8; ms[i * 4 + 2] = m8; ms[i * 4 + 3] = to8(1 - r);
  }
  maps.orm = `T_${name}_ORM.jpg`;
  maps.normal = `T_${name}_Normal.jpg`;
  maps.metallicSmoothness = `T_${name}_MetallicSmoothness.png`;
  let nrm = s.normal;
  if (!nrm) {
    if (s.height) nrm = normalFromHeight(s.height, w, h, s.normalStrength ?? 1);
    else { nrm = new Uint8Array(N * 3); for (let i = 0; i < N; i++) { nrm[i * 3] = 128; nrm[i * 3 + 1] = 128; nrm[i * 3 + 2] = 255; } }
  }
  const jobs = [
    encode(bc, w, h, ch, path.join(outDir, maps.baseColor)),
    encode(orm, w, h, 3, path.join(outDir, maps.orm)),
    encode(nrm, w, h, 3, path.join(outDir, maps.normal)),
    encode(ms, w, h, 4, path.join(outDir, maps.metallicSmoothness)),
  ];
  if (s.emission) {
    const em = new Uint8Array(N * 3);
    for (let i = 0; i < N; i++) { em[i * 3] = to8(s.emission[0][i]); em[i * 3 + 1] = to8(s.emission[1][i]); em[i * 3 + 2] = to8(s.emission[2][i]); }
    maps.emission = `T_${name}_Emission.jpg`;
    jobs.push(encode(em, w, h, 3, path.join(outDir, maps.emission)));
  }
  await Promise.all(jobs);
  const entry = { size: [w, h], tileMeters: s.tileMeters ?? null, alpha: hasA, maps };
  if (s.cells) entry.cells = s.cells;
  return entry;
}
