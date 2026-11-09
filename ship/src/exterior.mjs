// Экстерьер VESPER Explorer. Система координат построения: нос → +X, правый борт → +Z, верх → +Y, метры.
import { THREE, V, PI, TAU, rand, rr, pick, clamp, lerp, vnoise2, hash2, polysToGeo, chamferBox, quadGeo, SNode, Frame } from './geom.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- профили корпуса ---------- */
const P = (x, w, yT, yB, hT, cT, hB, cB) => ({ x, w, yT, yB, hT, cT, hB, cB });
export const MAIN = [P(-49.2, 5.2, 3.8, -4.4, 1.6, 1.8, 1.4, 1.6), P(-46.5, 7.0, 5.4, -5.8, 2.0, 2.2, 1.8, 2.1),
  P(-41, 8.2, 6.2, -6.4, 2.0, 2.3, 2.0, 2.3), P(-35, 8.5, 6.4, -6.6, 2.0, 2.3, 2.0, 2.4), P(26, 8.5, 6.4, -6.6, 2.0, 2.3, 2.0, 2.4)];
export const FRONT = [P(26, 8.5, 2.0, -6.6, 0, 0, 2.0, 2.4), P(34, 8.3, 2.0, -6.4, 0, 0, 2.0, 2.4), P(40, 7.4, 2.0, -5.9, 0, 0, 2.0, 2.4),
  P(45, 5.8, 2.0, -5.0, 0, 0, 1.8, 2.2), P(49.2, 4.0, 1.2, -3.6, 0, 0, 1.4, 1.8)];
const CAN = (x, w, yT, hT, cT, base) => ({ x, w, yT, hT, cT, base });
export const CANOPY = [CAN(26, 8.5, 6.4, 2.0, 2.3, 2.0), CAN(31, 8.4, 6.3, 2.0, 2.4, 2.0), CAN(36, 7.9, 5.8, 1.9, 2.5, 2.0),
  CAN(40.5, 6.9, 4.9, 1.6, 2.3, 2.0), CAN(44, 5.6, 3.7, 1.2, 1.9, 2.0), CAN(46.5, 4.4, 2.5, 0.5, 1.3, 1.714)];
export const POD = [P(-47.5, 3.0, 0.6, -4.8, 1.0, 1.0, 1.0, 1.0), P(-45.5, 3.2, 0.9, -5.1, 1.1, 1.1, 1.1, 1.1),
  P(-12, 3.2, 0.9, -5.1, 1.1, 1.1, 1.1, 1.1), P(-6.5, 2.9, 0.5, -4.7, 1.0, 1.0, 1.0, 1.0), P(-4.0, 2.3, -0.2, -4.0, 0.9, 0.8, 0.9, 0.8)];
export const POD_Z = 13.15;
const DORSAL = [P(-26, 2.6, 7.2, 6.3, 0.6, 0.9, 0, 0), P(-22.5, 4.2, 7.9, 6.3, 0.9, 1.3, 0, 0),
  P(8, 4.2, 7.9, 6.3, 0.9, 1.3, 0, 0), P(12, 2.6, 7.2, 6.3, 0.6, 0.9, 0, 0)];

function interp(list, x) {
  if (x <= list[0].x) return list[0];
  if (x >= list[list.length - 1].x) return list[list.length - 1];
  let i = 0; while (x > list[i + 1].x) i++;
  const a = list[i], b = list[i + 1], t = (x - a.x) / (b.x - a.x), o = {};
  for (const k in a) o[k] = lerp(a[k], b[k], t);
  return o;
}
const octa = (p) => [[p.yT, p.w - p.cT], [p.yT - p.hT, p.w], [p.yB + p.hB, p.w], [p.yB, p.w - p.cB],
  [p.yB, -(p.w - p.cB)], [p.yB + p.hB, -p.w], [p.yT - p.hT, -p.w], [p.yT, -(p.w - p.cT)]];
const canProf = (c) => [[c.base, -c.w], [c.yT - c.hT, -c.w], [c.yT, -(c.w - c.cT)], [c.yT, c.w - c.cT], [c.yT - c.hT, c.w], [c.base, c.w]];
function octW(p, y) {
  if (y > p.yT || y < p.yB) return 0;
  if (p.hT > 0.01 && y > p.yT - p.hT) return p.w - p.cT * (y - (p.yT - p.hT)) / p.hT;
  if (p.hB > 0.01 && y < p.yB + p.hB) return p.w - p.cB * ((p.yB + p.hB) - y) / p.hB;
  return p.w;
}
// Полуширина корпуса в точке (x, y)
export function hullW(x, y) {
  if (x <= 26) return octW(interp(MAIN, x), y);
  const f = interp(FRONT, x);
  if (y <= f.yT) return octW(f, y);
  if (x > 46.5) return 0;
  const c = interp(CANOPY, x);
  return octW({ w: c.w, yT: c.yT, yB: c.base, hT: c.hT, cT: c.cT, hB: 0, cB: 0 }, y);
}

const hullPodW = (x) => interp(POD, x).w;

/* ---------- аккумулятор полигонов с явными UV ---------- */
class Acc {
  constructor() { this.m = new Map(); }
  buf(mat) { if (!this.m.has(mat)) this.m.set(mat, { p: [], n: [], uv: [] }); return this.m.get(mat); }
  // pts: Vector3[], uvs: [u,v][], out: вектор «наружу» для ориентации
  poly(mat, pts, uvs, out) {
    const b = this.buf(mat);
    const n = V().subVectors(pts[1], pts[0]).cross(V().subVectors(pts[2], pts[0]));
    if (n.lengthSq() < 1e-14 && pts.length > 3) n.subVectors(pts[2], pts[0]).cross(V().subVectors(pts[3], pts[0]));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    let idx = pts.map((_, i) => i);
    if (out && n.dot(out) < 0) { idx = idx.reverse(); n.negate(); }
    for (let i = 1; i < idx.length - 1; i++) for (const j of [idx[0], idx[i], idx[i + 1]]) {
      b.p.push(pts[j].x, pts[j].y, pts[j].z); b.n.push(n.x, n.y, n.z); b.uv.push(uvs[j][0], uvs[j][1]);
    }
  }
  flush(node) {
    for (const [mat, b] of this.m) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      node.part.add(mat, g, 'keep');
    }
    this.m.clear();
  }
}

/* ---------- камуфляж: тон панели ---------- */
const DECAL_ZONES = []; // {x0,x1,y0,y1,z0,z1,mat} — под декалями: ровные панели фиксированной толщины
function camoTone(x, y, z, kind) {
  for (const d of DECAL_ZONES) if (x > d.x0 && x < d.x1 && y > d.y0 && y < d.y1 && z > d.z0 && z < d.z1) return { mat: d.mat || 'M_Hull_Light', d: 0.08 };
  let n = vnoise2(x / 11 + 3.1, (y + Math.abs(z) * 0.6) / 7 + (z > 0 ? 0 : 17)) * 0.75 + vnoise2(x / 4.5, y / 3 + z / 3) * 0.25;
  if (kind === 'bottom' || kind === 'lowch') n += 0.16;
  if (kind === 'top' && x > -30 && x < 14) n += 0.12;
  if (x > 26) n += 0.1;
  if (kind === 'pod') n += 0.08;
  const r = rand();
  let mat = n > 0.6 ? 'M_Hull_Dark' : n > 0.5 ? 'M_Hull_Mid' : 'M_Hull_Light';
  if (r < 0.07) mat = 'M_Hull_Mid';
  const dark = mat === 'M_Hull_Dark';
  const d = dark ? pick([0.1, 0.13, 0.16]) : pick([0.05, 0.07, 0.09, 0.09]);
  return { mat, d };
}

/* ---------- лофт с разбивкой на панели ---------- */
const TILE_HULL = 8, TILE_SEAM = 2;
function loftPanels(ctx, stations, prof, opt) {
  const { zOff = 0, nodeFor, kindOf, sideRows = null, sideEdges = [], rowTarget = 2.3, gap = 0.045, windows = [] } = opt;
  const rings = stations.map((s) => prof(s).map(([y, z]) => V(s.x, y, z + zOff)));
  const n = rings[0].length;
  // накопленная длина профиля для V-координаты
  const arc = [0]; { const r = rings[rings.length - 1]; for (let k = 0; k < n; k++) arc.push(arc[k] + r[k].distanceTo(r[(k + 1) % n])); }
  const accs = new Map();
  const accFor = (k) => { const node = nodeFor(k); if (!accs.has(node)) accs.set(node, new Acc()); return accs.get(node); };
  for (let s = 0; s < rings.length - 1; s++) {
    const R0 = rings[s], R1 = rings[s + 1];
    const cy0 = (stations[s].yT + stations[s].yB) / 2, cy1 = (stations[s + 1].yT + stations[s + 1].yB) / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const A0 = R0[k], A1 = R0[k2], B0 = R1[k], B1 = R1[k2];
      const Le = (A0.distanceTo(A1) + B0.distanceTo(B1)) / 2;
      if (Le < 0.05) continue;
      const acc = accFor(k), kind = kindOf(k);
      const Pt = (a, t) => V().lerpVectors(V().lerpVectors(A0, A1, t), V().lerpVectors(B0, B1, t), a);
      const axisC = (a) => V(lerp(A0.x, B0.x, a), lerp(cy0, cy1, a), zOff);
      const zs = (A0.z + A1.z) / 2 - zOff;
      const su = Math.abs(zs) < 0.5 ? 1 : Math.sign(zs);
      const uvOf = (a, t, tile) => [lerp(A0.x, B0.x, a) * su / tile, (arc[k] + t * Le) / tile];
      const xA = A0.x, xB = B0.x, lx = Math.hypot(xB - xA, B0.y - A0.y, B0.z - A0.z);
      // строки
      let tc = [];
      if (sideRows && sideEdges.includes(k)) {
        const yAt = (t) => lerp(lerp(A0.y, A1.y, t), lerp(B0.y, B1.y, t), 0.5);
        const y0 = yAt(0), y1 = yAt(1);
        tc = sideRows.map((y) => (y - y0) / (y1 - y0)).filter((t) => t > 0.03 && t < 0.97);
      } else { const nr = Math.max(1, Math.round(Le / rowTarget)); for (let i = 1; i < nr; i++) tc.push(i / nr); }
      tc = [0, ...tc.sort((a, b) => a - b), 1];
      for (let r = 0; r < tc.length - 1; r++) {
        const t0 = tc[r], t1 = tc[r + 1];
        // окна в этой строке
        const wins = [];
        if (sideEdges.includes(k)) for (const w of windows) {
          if (Math.sign(zs) !== w.side || w.x0 < Math.min(xA, xB) - 1e-6 || w.x1 > Math.max(xA, xB) + 1e-6) continue;
          const ac = ((w.x0 + w.x1) / 2 - xA) / (xB - xA);
          const yy = (t) => lerp(lerp(A0.y, A1.y, t), lerp(B0.y, B1.y, t), ac);
          const tw = (y) => (y - yy(0)) / (yy(1) - yy(0));
          const ta = Math.min(tw(w.y0), tw(w.y1)), tb = Math.max(tw(w.y0), tw(w.y1));
          if (ta > t0 && tb < t1) wins.push({ w, a0: (w.x0 - xA) / (xB - xA), a1: (w.x1 - xA) / (xB - xA), ta, tb });
        }
        wins.sort((p, q) => p.a0 - q.a0);
        const fa = 0.1 / lx, ft = 0.1 / Le;
        let cur = 0;
        const solid = (a0, a1) => {
          if (a1 - a0 < 1e-4) return;
          const L = (a1 - a0) * lx;
          let cuts = [a0], acc_ = a0;
          if (L > 6.5) { let left = L; while (left > 6.5) { const seg = rr(2.4, 5.6); acc_ += seg / lx; left -= seg; cuts.push(acc_); } }
          cuts.push(a1);
          for (let i = 0; i < cuts.length - 1; i++) panelCell(acc, Pt, axisC, uvOf, cuts[i], cuts[i + 1], t0, t1, lx, Le, gap, kind, opt.toneOverride);
        };
        for (const W of wins) {
          solid(cur, W.a0 - fa);
          const A = W.a0 - fa, B = W.a1 + fa;
          // полосы над/под окном
          if (W.ta - ft - t0 > 0.05 / Le) panelCell(acc, Pt, axisC, uvOf, A, B, t0, W.ta - ft, lx, Le, gap, kind, opt.toneOverride);
          if (t1 - (W.tb + ft) > 0.05 / Le) panelCell(acc, Pt, axisC, uvOf, A, B, W.tb + ft, t1, lx, Le, gap, kind, opt.toneOverride);
          // рама вокруг проёма
          for (const [a0, a1, ta, tb] of [[A, B, W.ta - ft, W.ta], [A, B, W.tb, W.tb + ft], [A, W.a0, W.ta, W.tb], [W.a1, B, W.ta, W.tb]])
            plate(acc, 'M_Metal_Dark', Pt, axisC, uvOf, a0, a1, ta, tb, lx, Le, 0, 0.12, 0.03, TILE_SEAM);
          const hole = [Pt(W.a0, W.ta), Pt(W.a1, W.ta), Pt(W.a1, W.tb), Pt(W.a0, W.tb)];
          ctx.holes.set(W.w.id, { pts: hole, normal: V().subVectors(hole[0], axisC(W.a0)).setY(0).normalize() });
          cur = B;
        }
        solid(cur, 1);
      }
    }
  }
  for (const [node, acc] of accs) acc.flush(node);
  return rings;
}
// одна ячейка: тёмная подложка (шов) + рельефная панель
function panelCell(acc, Pt, axisC, uvOf, a0, a1, t0, t1, lx, Le, gap, kind, override) {
  const ac = (a0 + a1) / 2, tcen = (t0 + t1) / 2, c = Pt(ac, tcen);
  const tone = override ? override(c, kind) || camoTone(c.x, c.y, c.z, kind) : camoTone(c.x, c.y, c.z, kind);
  plate(acc, tone.mat, Pt, axisC, uvOf, a0, a1, t0, t1, lx, Le, gap, tone.d, Math.min(0.05, tone.d * 0.7), TILE_HULL);
}
function plate(acc, mat, Pt, axisC, uvOf, a0, a1, t0, t1, lx, Le, gap, d, bev, tile) {
  const ia = gap / lx, it = gap / Le;
  const ac = (a0 + a1) / 2, tc = (t0 + t1) / 2;
  const nrm = V().subVectors(Pt(Math.min(ac + 0.01, 1), tc), Pt(Math.max(ac - 0.01, 0), tc))
    .cross(V().subVectors(Pt(ac, Math.min(tc + 0.01, 1)), Pt(ac, Math.max(tc - 0.01, 0)))).normalize();
  const C = Pt(ac, tc);
  if (nrm.dot(V().subVectors(C, axisC(ac))) < 0) nrm.negate();
  // подложка ячейки (видна в шве)
  const bq = [[a0, t0], [a1, t0], [a1, t1], [a0, t1]];
  acc.poly('M_Hull_Seam', bq.map(([a, t]) => Pt(a, t)), bq.map(([a, t]) => uvOf(a, t, TILE_SEAM)), nrm);
  if (d <= 0) return;
  const pa0 = a0 + ia, pa1 = a1 - ia, pt0 = t0 + it, pt1 = t1 - it;
  if (pa1 <= pa0 || pt1 <= pt0) return;
  const ba = Math.min(bev / lx, (pa1 - pa0) * 0.3), bt = Math.min(bev / Le, (pt1 - pt0) * 0.3);
  const base = [[pa0, pt0], [pa1, pt0], [pa1, pt1], [pa0, pt1]];
  const top = [[pa0 + ba, pt0 + bt], [pa1 - ba, pt0 + bt], [pa1 - ba, pt1 - bt], [pa0 + ba, pt1 - bt]];
  const B3 = base.map(([a, t]) => Pt(a, t)), T3 = top.map(([a, t]) => Pt(a, t).addScaledVector(nrm, d));
  const bu = base.map(([a, t]) => uvOf(a, t, tile)), tu = top.map(([a, t]) => uvOf(a, t, tile));
  acc.poly(mat, T3, tu, nrm);
  const inner = C.clone().addScaledVector(nrm, d * 0.5);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const q = [B3[i], B3[j], T3[j], T3[i]];
    const cen = q.reduce((s, p) => s.add(p), V()).multiplyScalar(0.25);
    acc.poly(mat, q, [bu[i], bu[j], tu[j], tu[i]], cen.sub(inner));
  }
}

function capGeo(ring, wantN) {
  const c = ring.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / ring.length);
  const polys = [];
  for (let i = 0; i < ring.length; i++) polys.push([c, ring[i], ring[(i + 1) % ring.length]]);
  const g = polysToGeo(polys);
  const nn = g.attributes.normal;
  if (V(nn.getX(0), nn.getY(0), nn.getZ(0)).dot(wantN) < 0) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) for (const a of [p, nn]) { const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1); a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x, y, z); }
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
  }
  return g;
}
function strutGeo(p, q, t) {
  const d = V().subVectors(q, p), len = d.length();
  const g = chamferBox(t, len, t, t * 0.2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(p.x, p.y, p.z);
  return g;
}
// Простой лофт без панелей (для коллайдеров)
function loftPlain(stations, prof, zOff = 0) {
  const rings = stations.map((s) => prof(s).map(([y, z]) => V(s.x, y, z + zOff)));
  const polys = [];
  for (let s = 0; s < rings.length - 1; s++) for (let k = 0; k < rings[s].length; k++) {
    const k2 = (k + 1) % rings[s].length;
    polys.push([rings[s][k], rings[s][k2], rings[s + 1][k2], rings[s + 1][k]]);
  }
  polys.push(rings[0]); polys.push([...rings[rings.length - 1]].reverse());
  return polysToGeo(polys);
}

/* ---------- окна: список стёкол по отсекам ---------- */
export const WIN_BANDS = { 0: [3.05, 4.2], 1: [-0.7, 0.75] };
const STATION_X = [...new Set([...MAIN, ...FRONT].map((p) => p.x))];
export function planWindows(ROOMS) {
  const out = [];
  let id = 0;
  for (const r of ROOMS) {
    if (!r.win) continue;
    const sides = r.s === 'F' ? [-1, 1] : [r.sg];
    const [y0, y1] = WIN_BANDS[r.d];
    for (const side of sides) {
      const ranges = r.winX || [[r.x0 + 0.75, r.x1 - 0.75]];
      for (let [a, b] of ranges) {
        // разрезать по станциям лофта (окно не должно пересекать стык полос)
        const segs = [];
        let s0 = a;
        for (const sx of STATION_X) if (sx > a + 0.3 && sx < b - 0.3) { segs.push([s0, sx - 0.2]); s0 = sx + 0.2; }
        segs.push([s0, b]);
        for (const [c0, c1] of segs) {
          const L = c1 - c0; if (L < 0.6) continue;
          const n = Math.max(1, Math.round(L / 1.9)), mull = 0.28, pw = (L - mull * (n - 1)) / n;
          for (let i = 0; i < n; i++) {
            const x0 = c0 + i * (pw + mull);
            out.push({ id: id++, room: r.code, deck: r.d, side, x0, x1: x0 + pw, y0, y1 });
          }
        }
      }
    }
  }
  return out;
}

/* ---------- построение экстерьера ---------- */
export function buildExterior(root, ctx, windows) {
  const ext = root.child('Exterior');
  const N = {};
  for (const n of ['Hull_Upper', 'Hull_Sides', 'Hull_Lower', 'Hull_Front', 'Cockpit', 'Antenna_Module', 'Engine_Pod_L', 'Engine_Pod_R', 'Engines_Main', 'Hull_Details', 'Decals', 'Nav_Lights', 'Windows_Glass'])
    N[n] = ext.child(n);
  const F = (node) => new Frame(node, new THREE.Matrix4(), ctx, {});
  const kindOct = (k) => ({ 0: 'upch', 1: 'side', 2: 'lowch', 3: 'bottom', 4: 'lowch', 5: 'side', 6: 'upch', 7: 'top' })[k];
  const SIDE_ROWS = [4.4, 2.85, 1.7, 0.95, -0.9, -2.75];

  // декали на боках: зоны с ровными светлыми панелями
  for (const s of [-1, 1]) {
    const zr = s > 0 ? [7.5, 9.5] : [-9.5, -7.5], pr = s > 0 ? [POD_Z + 2.5, POD_Z + 3.6] : [-POD_Z - 3.6, -POD_Z - 2.5];
    const zone = (x0, x1, y0, y1, z, mat) => DECAL_ZONES.push({ x0, x1, y0, y1, z0: z[0], z1: z[1], mat });
    zone(10.6, 21.6, 0.95, 2.85, zr);                   // логотип
    zone(-33.5, -27.5, -2.75, -0.9, zr);                // бортовой номер
    zone(-23.5, -16.5, -2.75, -0.9, zr);                // регистрация
    zone(30.5, 36.5, -2.75, -0.9, zr, 'M_Hull_Dark');   // номер на носу (светлый текст)
    zone(-10.2, -6.8, -2.4, -0.2, pr);                   // предупреждение у воздухозаборника
  }

  // основной корпус
  const mainNode = (k) => (k === 1 || k === 5) ? N.Hull_Sides : (k === 0 || k === 6 || k === 7) ? N.Hull_Upper : N.Hull_Lower;
  const mainRings = loftPanels(ctx, MAIN, octa, { nodeFor: mainNode, kindOf: kindOct, sideRows: SIDE_ROWS, sideEdges: [1, 5], windows });
  N.Hull_Lower.part.add('M_Hull_Dark', capGeo(mainRings[0], V(-1, 0, 0)));
  // нос
  const frontRings = loftPanels(ctx, FRONT, octa, { nodeFor: () => N.Hull_Front, kindOf: kindOct, sideRows: [0.95, -0.9, -2.75], sideEdges: [1, 5], windows });
  N.Hull_Front.part.add('M_Hull_Dark', capGeo(frontRings[frontRings.length - 1], V(1, 0, 0)));
  // кабина: гранёное стекло с каркасом
  {
    const rings = CANOPY.map((c) => canProf(c).map(([y, z]) => V(c.x, y, z)));
    const glass = [], solid = [], edges = new Map();
    const key = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
    const edge = (a, b) => { const k = [key(a), key(b)].sort().join('|'); if (!edges.has(k)) edges.set(k, [a, b]); };
    for (let s = 0; s < rings.length - 1; s++) {
      const A = rings[s], B = rings[s + 1];
      for (let k = 0; k < A.length - 1; k++) {
        const a0 = A[k], a1 = A[k + 1], b0 = B[k], b1 = B[k + 1];
        const tris = (s + k) % 2 ? [[a0, a1, b0], [a1, b1, b0]] : [[a0, a1, b1], [a0, b1, b0]];
        const opaque = s === 0 && k >= 1 && k <= 3;
        for (const t of tris) (opaque ? solid : glass).push(t);
        edge(a0, a1); edge(a0, b0); edge(b0, b1);
        if ((s + k) % 2) edge(a1, b0); else edge(a0, b1);
      }
    }
    const last = rings[rings.length - 1];
    const cc = last.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / last.length); cc.x += 0.9;
    for (let i = 0; i < last.length - 1; i++) { glass.push([last[i + 1], last[i], cc]); edge(last[i], cc); }
    const orientOut = (tris) => tris.map((t) => { const n = V().subVectors(t[1], t[0]).cross(V().subVectors(t[2], t[0])); const c = t[0].clone().add(t[1]).add(t[2]).multiplyScalar(1 / 3); return n.dot(V(c.x - 36, c.y - 1.2, c.z)) < 0 ? [t[0], t[2], t[1]] : t; });
    N.Cockpit.part.add('M_Glass_Canopy', polysToGeo(orientOut(glass)));
    N.Cockpit.part.add('M_Hull_Dark', polysToGeo(orientOut(solid)));
    const struts = [];
    for (const [a, b] of edges.values()) struts.push(strutGeo(a, b, 0.2));
    N.Cockpit.part.add('M_Metal_Dark', mergeGeometries(struts.map((g) => g.index ? g.toNonIndexed() : g)));
  }
  // антенный модуль
  {
    const dorsalNode = () => N.Antenna_Module;
    const rings = loftPanels(ctx, DORSAL, octa, { nodeFor: dorsalNode, kindOf: () => 'top', rowTarget: 1.6 });
    N.Antenna_Module.part.add('M_Hull_Mid', capGeo(rings[0], V(-1, 0, 0))).add('M_Hull_Mid', capGeo(rings[rings.length - 1], V(1, 0, 0)));
    const f = F(N.Antenna_Module);
    for (const [x, z, h] of [[-20, 2.2, 4.4], [-20, -2.2, 3.0], [-6, 0, 6.8], [4, 1.8, 3.8], [4, -1.8, 2.6]]) {
      f.box('M_Metal_Dark', x, 7.9, z, 0.8, 0.45, 0.8);
      f.cyl('M_Metal_Brushed', x, 8.35, z, 0.12, h, 10, 0.05);
      for (let k = 1; k < 3; k++) f.cyl('M_Metal_Dark', x, 8.35 + h * k / 3, z, 0.24, 0.08, 10);
      f.sph('M_Nav_Red', x, 8.4 + h, z, 0.1, 10);
    }
    // тарелка сенсора
    const dishPts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; dishPts.push(new THREE.Vector2(0.05 + 1.45 * t, 0.42 * t * t)); }
    for (let i = 10; i >= 0; i--) { const t = i / 10; dishPts.push(new THREE.Vector2(0.05 + 1.45 * t, 0.42 * t * t + 0.06)); }
    const dish = new THREE.LatheGeometry(dishPts, 32); dish.rotateX(-0.5); dish.translate(-12, 9.0, 0);
    N.Antenna_Module.part.add('M_Plastic_White', dish);
    f.cyl('M_Metal_Dark', -12, 7.9, 0, 0.3, 1.0, 12, 0.14); f.cyl('M_Metal_Brushed', -12, 9.0, 0.25, 0.04, 0.9, 6);
    for (const z of [-2.6, 2.6]) N.Antenna_Module.part.add('M_Plastic_White', new THREE.SphereGeometry(0.75, 24, 12, 0, TAU, 0, PI / 2).translate(-0.5, 7.9, z));
    for (const z of [-3.2, 3.2]) N.Hull_Upper.part.add('M_Plastic_White', new THREE.SphereGeometry(0.6, 24, 12, 0, TAU, 0, PI / 2).translate(21, 6.5, z));
    F(N.Hull_Upper).cyl('M_Metal_Brushed', 22.5, 6.5, 0, 0.1, 2.3, 8, 0.05);
    F(N.Hull_Upper).sph('M_Nav_Red', 22.5, 8.85, 0, 0.1, 10);
  }
  // гондолы двигателей
  for (const [name, s] of [['Engine_Pod_L', -1], ['Engine_Pod_R', 1]]) {
    const node = N[name], zc = s * POD_Z, f = F(node);
    const rings = loftPanels(ctx, POD, octa, { zOff: zc, nodeFor: () => node, kindOf: (k) => (k === 7 || k === 0 || k === 6) ? 'top' : 'pod', rowTarget: 1.8 });
    node.part.add('M_Hull_Dark', capGeo(rings[0], V(-1, 0, 0))).add('M_Hull_Dark', capGeo(rings[rings.length - 1], V(1, 0, 0)));
    // пилоны
    for (const [x0, x1] of [[-40, -33], [-21, -14]]) {
      const xm = (x0 + x1) / 2;
      f.box('M_Hull_Mid', xm, -3.1, s * 9.0, x1 - x0, 2.2, 2.4, 0, 0, 0.12);
      f.box('M_Metal_Dark', xm, -3.25, s * 9.0, x1 - x0 + 0.3, 0.32, 2.45, 0, 0, 0.05);
      f.box('M_Greeble', xm, -2.4, s * 9.0, x1 - x0 - 1.4, 0.5, 2.5, 0, 0, 0.04);
    }
    // сопла
    for (const dz of [-1.45, 1.45]) nozzle(node, ctx, -47.5, -2.1, zc + dz, 1.18, 1.7);
    // воздухозаборники спереди
    for (const dz of [-1.0, 1.0]) intake(node, -4.02, -2.1, zc + dz, 0.62);
    f.sph('M_Nav_' + (s < 0 ? 'Red' : 'Green'), -7.2, -1.4, s * (POD_Z + 3.12), 0.16, 12);
    f.sph('M_Nav_White', -47.56, -0.1, zc, 0.13, 10);
    // детали гондол
    for (let i = 0; i < 10; i++) { const x = rr(-44, -9); f.box(pick(['M_Greeble', 'M_Metal_Dark']), x, rr(-4.4, -1.6), s * (POD_Z + 3.3), rr(0.6, 2.4), rr(0.25, 0.7), 0.3); }
    for (const x of [-30, -27.8, -25.6]) f.box('M_Greeble', x, -0.1, zc, 1.6, 0.18, 2.2);
    f.box('M_Strip_Ext', -26, -5.18, zc, 14, 0.06, 0.08);
  }
  // кормовые двигатели
  for (const dz of [-2.3, 2.3]) nozzle(N.Engines_Main, ctx, -49.2, -0.6, dz, 1.55, 2.0);
  { const f = F(N.Engines_Main);
    f.box('M_Metal_Dark', -49.5, 2.0, 0, 0.9, 1.6, 3.4); f.box('M_Greeble', -49.5, -3.9, 0, 0.8, 1.2, 5.6);
    for (const z of [-4.2, 4.2]) { f.box('M_Metal_Dark', -49.4, -0.6, z, 0.9, 2.2, 0.9); f.cylx('M_Engine', -49.95, 0.2, z, 0.28, 0.4, 16); f.cylx('M_Engine_Glow', -50.16, 0.2, z, 0.2, 0.02, 16); }
    f.sph('M_Nav_White', -49.3, 3.45, 0, 0.14, 10);
  }
  // детали корпуса
  hullDetails(F(N.Hull_Details), F(N.Nav_Lights));
  decals(N.Decals, ctx);
  // стёкла окон
  for (const w of windows) {
    const h = ctx.holes.get(w.id);
    if (!h) { console.warn('no hull hole for window', w); continue; }
    const pts = h.pts.map((p) => p.clone().addScaledVector(h.normal, -0.04));
    N.Windows_Glass.part.add('M_Glass_Window', polysToGeo([pts]));
  }
  // коллайдеры корпуса
  ctx.colGeos.push(loftPlain(MAIN, octa), loftPlain(FRONT, octa), loftPlain(POD, octa, POD_Z), loftPlain(POD, octa, -POD_Z), loftPlain(DORSAL, octa));
  {
    const can = CANOPY.map((c) => canProf(c).map(([y, z]) => [y, z]));
    ctx.colGeos.push(loftPlain(CANOPY.map((c, i) => ({ x: c.x })), (st) => { const i = CANOPY.findIndex((c) => c.x === st.x); return can[i]; }));
    for (const s of [-1, 1]) for (const [x0, x1] of [[-40, -33], [-21, -14]]) { const g = chamferBox(x1 - x0, 2.2, 2.4, 0); g.translate((x0 + x1) / 2, -2.0, s * 9); ctx.colGeos.push(g); }
  }
  return N;
}

function nozzle(node, ctx, x, y, z, R, len) {
  const pts = [[0.84, 0], [0.92, -0.12], [1.0, -0.55], [1.13, -1.0], [1.06, -1.0], [0.96, -0.62], [0.82, -0.25], [0.66, -0.12], [0.6, -0.02]]
    .map(([r, l]) => new THREE.Vector2(r * R, l * len));
  const shell = new THREE.LatheGeometry(pts.reverse(), 32); shell.rotateZ(-PI / 2); shell.translate(x, y, z);
  // LatheGeometry после поворота: ось вдоль X, раструб к −X
  node.part.add('M_Engine', shell);
  const lip = new THREE.TorusGeometry(R * 1.1, 0.06 * R, 8, 32); lip.rotateY(PI / 2); lip.translate(x - len, y, z);
  node.part.add('M_Metal_Dark', lip);
  const cone = new THREE.LatheGeometry([new THREE.Vector2(0.001, -0.65 * len), new THREE.Vector2(0.18 * R, -0.45 * len), new THREE.Vector2(0.32 * R, -0.15 * len), new THREE.Vector2(0.62 * R, -0.12 * len)], 24);
  cone.rotateZ(-PI / 2); cone.translate(x, y, z); node.part.add('M_Metal_Dark', cone);
  const glow = new THREE.RingGeometry(0.34 * R, 0.62 * R, 32); glow.rotateY(-PI / 2); glow.translate(x - 0.13 * len, y, z);
  node.part.add('M_Engine_Glow', glow);
  const core = new THREE.CircleGeometry(0.3 * R, 24); core.rotateY(-PI / 2); core.translate(x - 0.5 * len, y, z);
  node.part.add('M_Engine_Core', core);
  // кольцо-обойма на корпусе
  const f = new Frame(node, new THREE.Matrix4(), ctx, {});
  f.cylx('M_Metal_Dark', x + 0.15, y, z, R * 1.0, 0.3, 32);
}
function intake(node, x, y, z, R) {
  const f = new Frame(node, new THREE.Matrix4(), null, {});
  f.tor('M_Metal_Dark', x, y, z, R, 0.11, 0, 32, PI / 2);
  f.tor('M_Intake_Glow', x - 0.02, y, z, R * 0.9, 0.035, 0, 32, PI / 2);
  const disc = new THREE.CircleGeometry(R * 0.86, 32); disc.rotateY(PI / 2); disc.translate(x + 0.12, y, z); node.part.add('M_Engine', disc);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, g = chamferBox(0.03, R * 0.75, 0.12, 0.005);
    g.translate(0, R * 0.42, 0); g.rotateX(a); g.rotateY(0); g.translate(x + 0.08, y, z);
    node.part.add('M_Metal_Dark', g);
  }
  f.cylx('M_Metal_Dark', x + 0.1, y, z, R * 0.18, 0.2, 16);
  f.cylx('M_Intake_Glow', x - 0.005, y, z, R * 0.1, 0.02, 16);
}

function hullDetails(f, nav) {
  // верх: грибли
  let placed = 0;
  for (let t = 0; t < 3000 && placed < 70; t++) {
    const sx = rr(0.8, 3.6), sz = rr(0.6, 2.2), h = rr(0.12, 0.5), x = rr(-34, 24), z = rr(-5.6, 5.6);
    if (x > -27.5 && x < 13 && Math.abs(z) < 4.6) continue;
    if (x > 19.5 && x < 23.5 && Math.abs(z) > 2.0 && Math.abs(z) < 4.2) continue;
    if (Math.abs(x - 22.5) < 0.6 && Math.abs(z) < 0.6) continue;
    f.box(pick(['M_Greeble', 'M_Greeble', 'M_Metal_Dark', 'M_Hull_Mid']), x, 6.48, z, sx, h, sz, 0, 0, 0.04); placed++;
  }
  // низ: створки шасси, рампа, блистеры
  for (const [x, z] of [[-30, 3.8], [-30, -3.8], [16, 0]]) {
    f.box('M_Hull_Dark', x, -6.86, z, 3.4, 0.12, 2.2, 0, 0, 0.03);
    for (const s of [-1, 1]) f.box('M_Hazard', x + s * 1.75, -6.83, z, 0.12, 0.06, 2.2, 0, 0, 0.01);
  }
  f.box('M_Hull_Dark', 7, -6.84, 0, 9, 0.1, 5.2, 0, 0, 0.03);
  for (const s of [-1, 1]) f.box('M_Hazard', 7, -6.82, s * 2.65, 9, 0.06, 0.14, 0, 0, 0.01);
  for (let i = 0; i < 40; i++) { const x = rr(-34, 25), z = rr(-5.8, 5.8); if (Math.abs(x - 7) < 5 && Math.abs(z) < 3) continue; f.box(pick(['M_Greeble', 'M_Metal_Dark']), x, -6.95 - 0.0, z, rr(0.8, 3.2), rr(0.12, 0.3), rr(0.5, 2)); }
  for (const x of [-20, 2, 30]) f.sph('M_Plastic_White', x, -6.75, 0, 0.55, 20, 0.5);
  // борта: РСУ, вентиляция, трубопроводы
  for (const s of [-1, 1]) {
    const zs = s * 8.5;
    for (const [x, y] of [[-43, 3.2], [-43, -4.0], [23.5, 3.5], [23.5, -4.1], [-10, -3.9]]) {
      const g = f.sub(x, y, s * hullW(x, y), 0);
      g.box('M_Metal_Dark', 0, 0, s * 0.25, 1.3, 0.9, 0.5);
      for (const dy of [0.25, 0.65]) g.cylz('M_Engine', 0.35, dy, s * 0.55, 0.11, 0.25, 12);
      g.cylx('M_Engine', 0.72, 0.45, s * 0.25, 0.1, 0.25, 12);
    }
    for (const x of [-12, 2]) { f.box('M_Metal_Dark', x + 1.0, -3.7, zs + s * 0.2, 2.6, 1.05, 0.14, 0, 0, 0.02); for (let i = 0; i < 7; i++) f.box('M_Greeble', x + i * 0.34, -3.6, zs + s * 0.3, 0.16, 0.85, 0.08, 0, 0, 0.01); }
    f.cylx('M_Metal_Dark', -6, -4.05, zs + s * 0.3, 0.12, 62, 10);
    f.cylx('M_Metal_Brushed', -6, -4.33, zs + s * 0.26, 0.07, 62, 8);
    for (let x = -36; x < 24; x += 3.5) f.box('M_Greeble', x, -4.45, zs + s * 0.22, 0.3, 0.62, 0.28, 0, 0, 0.02);
    // световая полоса по низу борта
    f.box('M_Strip_Ext', -4, -4.56, zs + s * 0.12, 54, 0.06, 0.06, 0, 0, 0.005);
    // носовые огни и полосы
    for (const [x0, x1, y] of [[41, 46, -3.0], [44, 48.6, -1.2]]) {
      const xm = (x0 + x1) / 2, w0 = hullW(x0, y), w1 = hullW(x1, y);
      f.box('M_Strip_Ext', xm, y, s * ((w0 + w1) / 2 + 0.06), x1 - x0, 0.09, 0.06, -s * Math.atan2(w1 - w0, x1 - x0), 0, 0.005);
    }
    nav.sph(s < 0 ? 'M_Nav_Red' : 'M_Nav_Green', 26, -0.1, s * 8.75, 0.14, 12);
    // стыковочный люк по борту носа
    { const g = f.sub(33, -2.5, s * (hullW(33, -2.5) + 0.02), s > 0 ? 0 : PI);
      g.add('M_Metal_Dark', new THREE.CylinderGeometry(1.15, 1.15, 0.2, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 0, 0.1));
      g.add('M_Hazard', new THREE.CylinderGeometry(0.98, 0.98, 0.24, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 0, 0.1));
      g.add('M_Hull_Mid', new THREE.CylinderGeometry(0.82, 0.82, 0.3, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 0, 0.1));
      g.box('M_Strip_Red', 1.25, -0.5, 0.15, 0.08, 1.0, 0.06); }
  }
  nav.box('M_Strip_Ext', 49.24, -0.6, 0, 0.06, 0.12, 5.4, 0, 0, 0.005);
}

function decals(node, ctx) {
  const atlas = ctx.manifest.sets.Decals, [AW, AH] = atlas.size;
  const rect = (cell) => { const c = atlas.cells[cell]; if (!c) throw new Error('decal cell missing: ' + cell); const [x, y, w, h] = c; return [x / AW, y / AH, (x + w) / AW, (y + h) / AH]; };
  const add = (cell, x, y, z, w, h, side) => {
    const g = quadGeo(w, h, rect(cell));
    if (side < 0) g.rotateY(PI);
    g.translate(x, y, z);
    g.userData.decal = cell;
    node.part.add('M_Decals', g, 'keep');
    (node.decals ||= []).push({ geo: g, cell });
  };
  for (const s of [-1, 1]) {
    const z = s * (8.5 + 0.095);
    add('logo', 16.1, 1.9, z, 7.4, 1.85, s);
    add('hullnum', -30.5, -1.82, z, 4.5, 1.5, s);
    add('hullnum_white', 33.5, -1.82, s * (hullW(33.5, -1.8) + 0.095), 4.5, 1.5, s);
    add('reg', -20, -1.85, z, 6.5, 0.36, s);
    add('intake', -8.6, -1.3, s * (POD_Z + hullPodW(-8.6) + 0.095), 2.4, 0.6, s);
  }
  // NO STEP на верхней палубе
  for (const [x, z] of [[-31, 3.2], [18, -3.4], [-31, -3.2]]) {
    const g = quadGeo(1.6, 0.8, rect('nostep')); g.rotateX(-PI / 2); g.translate(x, 6.4 + 0.175, z);
    node.part.add('M_Decals', g, 'keep'); (node.decals ||= []).push({ geo: g, cell: 'nostep' });
  }
}
