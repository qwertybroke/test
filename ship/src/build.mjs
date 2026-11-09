// Сборка ассета: геометрия → glTF (GLB + .gltf с внешними текстурами) + коллайдеры + статистика.
// node src/build.mjs [--dev]   (--dev: без ожидания текстур, заглушки для атласов)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRLightsPunctual, KHRMaterialsEmissiveStrength, Light } from '@gltf-transform/extensions';
import { weld, dedup, prune } from '@gltf-transform/functions';
import { THREE, V, SNode, finalizePart, reseed, chamferBox } from './geom.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATERIALS, LIGHT_COLORS } from './materials.mjs';
import { buildExterior, planWindows } from './exterior.mjs';
import { prepareRooms, buildInterior, signAtlas, DECKS } from './interior.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX = path.join(ROOT, 'build/Textures');
const OUT = path.join(ROOT, 'export');
const DEV = process.argv.includes('--dev');
for (const f of ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']) if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'DejaVu Sans');
fs.mkdirSync(TEX, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

/* ---------- манифест текстур ---------- */
let manifest = fs.existsSync(path.join(TEX, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(TEX, 'manifest.json'), 'utf8')) : null;
if (!manifest) {
  if (!DEV) throw new Error('build/Textures/manifest.json не найден — сначала npm run textures');
  manifest = { sets: { Decals: { size: [2048, 2048], cells: Object.fromEntries(['logo', 'emblem', 'name_white', 'hullnum', 'hullnum_white', 'reg', 'hazard', 'nostep', 'arrow', 'intake'].map((k, i) => [k, [(i % 4) * 512, Math.floor(i / 4) * 256, 512, 256]])) } } };
}
// атлас табличек — генерируем здесь, т.к. зависит от списка отсеков
const ROOMS = prepareRooms();
const signs = signAtlas(createCanvas);
{
  const base = createCanvas(2048, 1024), g = base.getContext('2d');
  g.drawImage(signs.canvas, 0, 0); g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(0, 0, 2048, 1024);
  fs.writeFileSync(path.join(TEX, 'T_Signs_BaseColor.jpg'), base.toBuffer('image/jpeg', 90));
  fs.writeFileSync(path.join(TEX, 'T_Signs_Emission.jpg'), signs.canvas.toBuffer('image/jpeg', 92));
  const flat = (rgb, a, name, type) => { const c = createCanvas(16, 16), q = c.getContext('2d'); q.fillStyle = `rgba(${rgb},${a})`; q.fillRect(0, 0, 16, 16); fs.writeFileSync(path.join(TEX, name), type === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 95)); };
  flat('255,77,0', 1, 'T_Signs_ORM.jpg'); flat('128,128,255', 1, 'T_Signs_Normal.jpg');
  { const c = createCanvas(16, 16), q = c.getContext('2d'), d = q.createImageData(16, 16); for (let i = 0; i < 256; i++) d.data.set([0, 0, 0, 178], i * 4); q.putImageData(d, 0, 0); fs.writeFileSync(path.join(TEX, 'T_Signs_MetallicSmoothness.png'), c.toBuffer('image/png')); }
  manifest.sets.Signs = { size: [2048, 1024], tileMeters: null, alpha: false, maps: { baseColor: 'T_Signs_BaseColor.jpg', orm: 'T_Signs_ORM.jpg', normal: 'T_Signs_Normal.jpg', emission: 'T_Signs_Emission.jpg', metallicSmoothness: 'T_Signs_MetallicSmoothness.png' } };
}
const tileOf = (mat) => { const M = MATERIALS[mat]; if (!M) throw new Error('unknown material ' + mat); if (M.tile) return M.tile; const s = M.set && manifest.sets[M.set]; return (s && s.tileMeters) || [2, 2]; };

/* ---------- геометрия ---------- */
reseed(98412);
const root = new SNode('VESPER_Explorer');
const ctx = { lights: [], colliders: [], holes: new Map(), colGeos: [], manifest };

const windows = planWindows(ROOMS);
buildExterior(root, ctx, windows);
const { DOORS } = buildInterior(root, ctx, windows, signs.cells);
// источники света
{
  const ln = root.child('Lights');
  const decks = DECKS.map((D) => ln.child('Lights_' + D.id));
  const LC = { warm: 'Warm', cool: 'White', neutral: 'White', blue: 'Blue', orange: 'Orange', purple: 'Purple', green: 'Green', red: 'Red', cyan: 'Cyan' };
  ctx.lights.forEach((L, i) => {
    if (!(L.I > 0)) return;
    const parent = decks[L.deck] || ln;
    const n = parent.child(`Light_${L.room || 'X'}_${String(i).padStart(3, '0')}`, L.p.clone().sub(parent._world));
    n.light = { color: LIGHT_COLORS[LC[L.col] || 'White'], intensity: L.I * 12, range: L.range * 1.4 };
  });
}

/* ---------- экспорт ---------- */
// glTF: нос в +Z. Поворот вокруг Y на −90°: (x, y, z) → (−z, y, x)
const ROT = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
const rotV = (v) => v.clone().applyMatrix4(ROT);

function makeDoc() {
  const doc = new Document();
  doc.createBuffer('main');
  const lightsExt = doc.createExtension(KHRLightsPunctual);
  const esExt = doc.createExtension(KHRMaterialsEmissiveStrength);
  return { doc, lightsExt, esExt, mats: new Map(), texs: new Map() };
}
function texture(D, file) {
  if (D.texs.has(file)) return D.texs.get(file);
  const full = path.join(TEX, file);
  const t = D.doc.createTexture(file.replace(/\.\w+$/, '')).setImage(fs.readFileSync(full)).setMimeType(file.endsWith('.png') ? 'image/png' : 'image/jpeg').setURI('Textures/' + file);
  D.texs.set(file, t); return t;
}
function material(D, name) {
  if (D.mats.has(name)) return D.mats.get(name);
  const M = MATERIALS[name], doc = D.doc;
  const m = doc.createMaterial(name).setBaseColorFactor(M.base).setMetallicFactor(M.metal).setRoughnessFactor(M.rough).setDoubleSided(M.double).setAlphaMode(M.alpha);
  if (M.alpha === 'MASK') m.setAlphaCutoff(0.5);
  const S = M.set && manifest.sets[M.set];
  if (S && S.maps && !DEV) {
    m.setBaseColorTexture(texture(D, S.maps.baseColor));
    if (S.maps.orm) { const t = texture(D, S.maps.orm); m.setMetallicRoughnessTexture(t).setOcclusionTexture(t); }
    if (S.maps.normal) m.setNormalTexture(texture(D, S.maps.normal));
    if (S.maps.emission && M.emissive) m.setEmissiveTexture(texture(D, S.maps.emission));
  } else if (M.set) { m.setMetallicFactor(0.3).setRoughnessFactor(0.5); }
  if (M.emissive) {
    m.setEmissiveFactor(M.emissive);
    if (M.strength > 1) m.setExtension('KHR_materials_emissive_strength', D.esExt.createEmissiveStrength().setEmissiveStrength(M.strength));
  }
  D.mats.set(name, m); return m;
}
function accessor(D, type, arr) { return D.doc.createAccessor().setType(type).setArray(arr).setBuffer(D.doc.getRoot().listBuffers()[0]); }
function primFromGeo(D, geo, matName) {
  const g = geo.clone(); g.applyMatrix4(ROT);
  const p = D.doc.createPrimitive()
    .setAttribute('POSITION', accessor(D, 'VEC3', new Float32Array(g.attributes.position.array)))
    .setAttribute('NORMAL', accessor(D, 'VEC3', new Float32Array(g.attributes.normal.array)));
  if (g.attributes.uv) p.setAttribute('TEXCOORD_0', accessor(D, 'VEC2', new Float32Array(g.attributes.uv.array)));
  if (matName) p.setMaterial(material(D, matName));
  return p;
}
const stats = { nodes: 0, tris: 0, byTop: {}, materials: new Set() };
function convert(D, sn, topName) {
  const n = D.doc.createNode(sn.name).setTranslation(rotV(sn.pos).toArray());
  stats.nodes++;
  if (!sn.part.empty) {
    const prims = finalizePart(sn.part, tileOf, sn._world, sn.vOrigin);
    const mesh = D.doc.createMesh(sn.name);
    for (const { mat, geo } of prims) {
      mesh.addPrimitive(primFromGeo(D, geo, mat));
      const t = geo.attributes.position.count / 3;
      stats.tris += t; stats.byTop[topName] = (stats.byTop[topName] || 0) + t; stats.materials.add(mat);
    }
    n.setMesh(mesh);
  }
  if (sn.light) {
    const L = D.lightsExt.createLight(sn.name).setType(Light.Type.POINT).setColor([sn.light.color.r, sn.light.color.g, sn.light.color.b]).setIntensity(sn.light.intensity).setRange(sn.light.range);
    n.setExtension('KHR_lights_punctual', L);
  }
  if (sn.extras) {
    const ex = { ...sn.extras };
    if (ex.slideAxis) ex.slideAxis = rotV(V(...ex.slideAxis)).toArray().map((v) => +v.toFixed(4));
    n.setExtras(ex);
  }
  for (const c of sn.children) n.addChild(convert(D, c, topName || c.name));
  return n;
}

const D = makeDoc();
const scene = D.doc.createScene('VESPER_Explorer');
const rootNode = D.doc.createNode('VESPER_Explorer');
for (const c of root.children) rootNode.addChild(convert(D, c, c.name));
scene.addChild(rootNode);
rootNode.setExtras({ asset: 'VESPER Explorer', units: 'meters', forward: '+Z (glTF)', length_m: 98.4, width_m: 32.7, height_m: 21.3, decks: 3 });
D.doc.getRoot().getAsset().generator = 'vesper-explorer-asset (three.js + glTF-Transform)';
await D.doc.transform(weld(), dedup(), prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }));
const io = new NodeIO().registerExtensions([KHRLightsPunctual, KHRMaterialsEmissiveStrength]);
const glb = await io.writeBinary(D.doc);
fs.writeFileSync(path.join(OUT, 'Vesper_Explorer.glb'), glb);
// .gltf с внешними текстурами (для конвертации в Blender/FBX)
fs.mkdirSync(path.join(ROOT, 'build/gltf'), { recursive: true });
await io.write(path.join(ROOT, 'build/gltf/Vesper_Explorer.gltf'), D.doc);

/* ---------- коллайдеры ---------- */
{
  const C = makeDoc();
  const sc = C.doc.createScene('VESPER_Explorer_Colliders');
  const top = C.doc.createNode('VESPER_Explorer_Colliders');
  const hull = mergeGeometries(ctx.colGeos.map((g) => { const q = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); if (!q.attributes.normal) q.computeVertexNormals(); return q; }));
  const boxes = (kind) => mergeGeometries(ctx.colliders.filter((c) => kind.includes(c.kind)).map((c) => {
    const s = V().subVectors(c.max, c.min), m = V().addVectors(c.max, c.min).multiplyScalar(0.5);
    const g = chamferBox(Math.max(s.x, 0.02), Math.max(s.y, 0.02), Math.max(s.z, 0.02), 0); g.translate(m.x, m.y, m.z); return g;
  }));
  for (const [name, g] of [['COL_Hull', hull], ['COL_Interior_Structure', boxes(['wall', 'floor'])], ['COL_Interior_Furniture', boxes(['furniture'])]]) {
    const mesh = C.doc.createMesh(name).addPrimitive(primFromGeo(C, g, null));
    top.addChild(C.doc.createNode(name).setMesh(mesh));
  }
  sc.addChild(top);
  await C.doc.transform(weld(), dedup());
  fs.writeFileSync(path.join(OUT, 'Vesper_Explorer_Colliders.glb'), await io.writeBinary(C.doc));
  await io.write(path.join(ROOT, 'build/gltf/Vesper_Explorer_Colliders.gltf'), C.doc);
}

/* ---------- статистика ---------- */
const out = {
  tris: Math.round(stats.tris), nodes: stats.nodes, materials: stats.materials.size, lights: ctx.lights.filter((l) => l.I > 0).length,
  rooms: ROOMS.filter((r) => r.type !== 'lift').length, doors: DOORS.length, windows: windows.length, holes: ctx.holes.size,
  byTop: Object.fromEntries(Object.entries(stats.byTop).map(([k, v]) => [k, Math.round(v)])),
  glbMB: +(glb.byteLength / 1048576).toFixed(1), textures: D.texs.size,
};
fs.writeFileSync(path.join(ROOT, 'build/stats.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
