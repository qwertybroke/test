// Общие примитивы: ГПСЧ, шум, геометрия с фасками, контейнеры «материал → геометрия», UV в метрах.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };
export const TAU = Math.PI * 2, PI = Math.PI;
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

let SEED = 98412;
export function reseed(s) { SEED = s | 0; }
export function rand() {
  SEED = (SEED + 0x6D2B79F5) | 0;
  let t = Math.imul(SEED ^ (SEED >>> 15), 1 | SEED);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rr = (a, b) => a + (b - a) * rand();
export const pick = (a) => a[Math.floor(rand() * a.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

const hash2 = (x, y) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
export { hash2 };

/* ---------- геометрия ---------- */
// Полигоны → треугольники с плоскими нормалями; orient: развернуть грани наружу от начала координат (для выпуклых тел)
export function polysToGeo(polys, orient = false) {
  const pos = [], nrm = [];
  const a = V(), b = V(), n = V(), c = V();
  for (const p of polys) {
    for (let i = 1; i < p.length - 1; i++) {
      let p0 = p[0], p1 = p[i], p2 = p[i + 1];
      n.crossVectors(a.subVectors(p1, p0), b.subVectors(p2, p0));
      if (n.lengthSq() < 1e-14) continue;
      n.normalize();
      if (orient) { c.copy(p0).add(p1).add(p2); if (n.dot(c) < 0) { [p1, p2] = [p2, p1]; n.negate(); } }
      for (const q of [p0, p1, p2]) { pos.push(q.x, q.y, q.z); nrm.push(n.x, n.y, n.z); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// Параллелепипед со скошенными рёбрами (44 треугольника)
export function chamferBox(sx, sy, sz, bevel) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const b = Math.max(0, Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45));
  if (b < 0.002) return polysToGeo(boxPolys(hx, hy, hz), true);
  const P = (x, y, z) => V(x, y, z), S = [-1, 1], polys = [];
  const xb = hx - b, yb = hy - b, zb = hz - b;
  for (const a of S) {
    polys.push([P(a * hx, -yb, -zb), P(a * hx, yb, -zb), P(a * hx, yb, zb), P(a * hx, -yb, zb)]);
    polys.push([P(-xb, a * hy, -zb), P(xb, a * hy, -zb), P(xb, a * hy, zb), P(-xb, a * hy, zb)]);
    polys.push([P(-xb, -yb, a * hz), P(xb, -yb, a * hz), P(xb, yb, a * hz), P(-xb, yb, a * hz)]);
  }
  for (const i of S) for (const j of S) {
    polys.push([P(i * hx, j * yb, -zb), P(i * hx, j * yb, zb), P(i * xb, j * hy, zb), P(i * xb, j * hy, -zb)]);
    polys.push([P(i * hx, -yb, j * zb), P(i * hx, yb, j * zb), P(i * xb, yb, j * hz), P(i * xb, -yb, j * hz)]);
    polys.push([P(-xb, i * hy, j * zb), P(xb, i * hy, j * zb), P(xb, i * yb, j * hz), P(-xb, i * yb, j * hz)]);
  }
  for (const i of S) for (const j of S) for (const k of S) polys.push([P(i * hx, j * yb, k * zb), P(i * xb, j * hy, k * zb), P(i * xb, j * yb, k * hz)]);
  return polysToGeo(polys, true);
}
function boxPolys(hx, hy, hz) {
  const P = (x, y, z) => V(x, y, z), polys = [];
  for (const a of [-1, 1]) {
    polys.push([P(a * hx, -hy, -hz), P(a * hx, hy, -hz), P(a * hx, hy, hz), P(a * hx, -hy, hz)]);
    polys.push([P(-hx, a * hy, -hz), P(hx, a * hy, -hz), P(hx, a * hy, hz), P(-hx, a * hy, hz)]);
    polys.push([P(-hx, -hy, a * hz), P(hx, -hy, a * hz), P(hx, hy, a * hz), P(-hx, hy, a * hz)]);
  }
  return polys;
}
export const plainBox = (sx, sy, sz) => polysToGeo(boxPolys(sx / 2, sy / 2, sz / 2), true);

// Квадрат с явными UV (0..1 или прямоугольник атласа [u0,v0,u1,v1] в glTF-координатах: v=0 сверху)
export function quadGeo(w, h, uv = [0, 0, 1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv;
  // PlaneGeometry: uv.y = 1 вверху → переводим в glTF (v вниз)
  for (let i = 0; i < a.count; i++) a.setXY(i, lerp(uv[0], uv[2], a.getX(i)), lerp(uv[3], uv[1], a.getY(i)));
  return g;
}

/* ---------- контейнер геометрии узла ---------- */
// Хранит геометрию по ключам материалов. uv: 'box' — проекция в метрах мира по доминирующей оси; 'keep' — свои UV.
export class Part {
  constructor() { this.items = new Map(); }
  add(mat, geo, uv = 'box') {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (uv === 'box') g.deleteAttribute('uv');
    if (!this.items.has(mat)) this.items.set(mat, []);
    this.items.get(mat).push({ g, uv });
    return this;
  }
  get empty() { return this.items.size === 0; }
  tris() { let n = 0; for (const l of this.items.values()) for (const { g } of l) n += g.attributes.position.count / 3; return n; }
}

// UV проекцией по доминирующей оси, «картинка вверх» = мировой верх; offset — положение узла в мире
export function boxUV(g, tile, offset, vOrigin = 0) {
  const p = g.attributes.position, n = g.attributes.normal, cnt = p.count;
  const uv = new Float32Array(cnt * 2);
  const [tu, tv] = tile;
  const a = V(), b = V(), c = V(), fn = V();
  for (let i = 0; i < cnt; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    fn.crossVectors(V().subVectors(b, a), V().subVectors(c, a));
    if (fn.lengthSq() < 1e-16) fn.fromBufferAttribute(n, i);
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k) + offset.x, y = p.getY(i + k) + offset.y, z = p.getZ(i + k) + offset.z;
      let u, v;
      if (ay >= ax && ay >= az) { u = x / tu; v = (fn.y > 0 ? z : -z) / tv; }
      else if (ax >= az) { u = (fn.x > 0 ? -z : z) / tu; v = (vOrigin - y) / tv; }
      else { u = (fn.z > 0 ? x : -x) / tu; v = (vOrigin - y) / tv; }
      uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Слить геометрию узла по материалам; tileOf(mat) → [tu,tv] | null
export function finalizePart(part, tileOf, offset, vOrigin) {
  const out = [];
  for (const [mat, list] of part.items) {
    const geos = list.map(({ g, uv }) => {
      if (uv === 'box' || !g.attributes.uv) boxUV(g, tileOf(mat) || [1, 1], offset, vOrigin);
      return g;
    });
    out.push({ mat, geo: mergeGeometries(geos, false) });
  }
  return out;
}

/* ---------- узлы сцены ---------- */
export class SNode {
  constructor(name, pos = V()) { this.name = name; this.pos = pos.clone(); this._world = pos.clone(); this.children = []; this.part = new Part(); this.extras = null; this.light = null; this.vOrigin = 0; }
  child(name, pos) { const c = new SNode(name, pos || V()); c._world = this._world.clone().add(c.pos); c.vOrigin = this.vOrigin; this.children.push(c); return c; }
  find(name) { if (this.name === name) return this; for (const c of this.children) { const f = c.find(name); if (f) return f; } return null; }
}

/* ---------- построитель с локальной системой координат ---------- */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = V(1, 1, 1);
export class Frame {
  // m — матрица в координатах узла; ctx — общие данные (огни, коллайдеры)
  constructor(node, m, ctx, info = {}) { this.node = node; this.m = m; this.ctx = ctx; this.info = info; }
  sub(x, y, z, ry = 0, rx = 0, rz = 0) {
    const t = new THREE.Matrix4().compose(V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _one);
    return new Frame(this.node, this.m.clone().multiply(t), this.ctx, this.info);
  }
  add(mat, g, uv = 'box') { g.applyMatrix4(this.m); this.node.part.add(mat, g, uv); return this; }
  // корпусные детали с фаской; anchored at bottom
  box(mat, x, y, z, sx, sy, sz, ry = 0, rx = 0, bevel = null) {
    const b = bevel ?? Math.min(0.025, Math.min(sx, sy, sz) * 0.18);
    const g = chamferBox(sx, sy, sz, b);
    if (rx || ry) g.applyQuaternion(_q.setFromEuler(_e.set(rx, ry, 0, 'YXZ')));
    g.translate(x, y + sy / 2, z); return this.add(mat, g);
  }
  slab(mat, x, y, z, sx, sy, sz) { const g = plainBox(sx, sy, sz); g.translate(x, y + sy / 2, z); return this.add(mat, g); }
  cyl(mat, x, y, z, r, h, seg = 16, rTop = r, open = false, ts = 0, tl = TAU) { const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, open, ts, tl); g.translate(x, y + h / 2, z); return this.add(mat, g); }
  cylx(mat, x, y, z, r, len, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(PI / 2); g.translate(x, y, z); return this.add(mat, g); }
  cylz(mat, x, y, z, r, len, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(PI / 2); g.translate(x, y, z); return this.add(mat, g); }
  sph(mat, x, y, z, r, seg = 12, sy = 1) { const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6 | 0)); g.scale(1, sy, 1); g.translate(x, y, z); return this.add(mat, g); }
  tor(mat, x, y, z, R, r, rx = PI / 2, seg = 32, ry = 0, arc = TAU) { const g = new THREE.TorusGeometry(R, r, 8, seg, arc); g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(mat, g); }
  quad(mat, x, y, z, w, h, ry = 0, uv = null, rx = 0) {
    const g = quadGeo(w, h, uv || [0, 0, 1, 1]);
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z);
    return this.add(mat, g, uv ? 'keep' : 'box');
  }
  screen(x, y, z, w, h, ry = 0, cell = 0, rx = 0) {
    const cx = cell % 4, cy = Math.floor(cell / 4);
    return this.quad('M_Screens', x, y, z, w, h, ry, [cx / 4, cy / 4, (cx + 1) / 4, (cy + 1) / 4], rx);
  }
  wpos(x, y, z) { return V(x, y, z).applyMatrix4(this.m); }
  light(x, y, z, col, I, range) { this.ctx.lights.push({ deck: this.info.deck, room: this.info.code, p: this.wpos(x, y, z).add(this.node.worldPos()), col, I, range }); }
  block(x0, z0, x1, z1, h = 1.0) {
    const a = this.wpos(x0, 0, z0), b = this.wpos(x1, 0, z1), c = this.wpos(x0, 0, z1), d = this.wpos(x1, 0, z0);
    const o = this.node.worldPos();
    const mn = V(Math.min(a.x, b.x, c.x, d.x), a.y, Math.min(a.z, b.z, c.z, d.z)).add(o), mx = V(Math.max(a.x, b.x, c.x, d.x), a.y + h, Math.max(a.z, b.z, c.z, d.z)).add(o);
    this.ctx.colliders.push({ min: mn, max: mx, kind: 'furniture' });
  }
}
SNode.prototype.worldPos = function () { return this._world ? this._world.clone() : V(); };

// Проставить мировые позиции узлов (нужно для огней/коллайдеров до экспорта)
export function computeWorld(node, parent = V()) { node._world = parent.clone().add(node.pos); for (const c of node.children) computeWorld(c, node._world); }
