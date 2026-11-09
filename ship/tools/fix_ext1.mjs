import fs from 'fs';
const p = '/tmp/hoplite/workspace/ship/src/exterior.mjs';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISSING:', a.slice(0, 100)); process.exitCode = 1; } s = s.replace(a, b); };
rep(`const DECAL_ZONES = []; // {x0,x1,y0,y1,side} — фон под декалями: светлые ровные панели`,
    `const DECAL_ZONES = []; // {x0,x1,y0,y1,z0,z1,mat} — под декалями: ровные панели фиксированной толщины`);
rep(`  for (const d of DECAL_ZONES) if (x > d.x0 && x < d.x1 && y > d.y0 && y < d.y1 && Math.sign(z) === d.side && kind === 'side') return { mat: d.mat || 'M_Hull_Light', d: 0.08 };`,
    `  for (const d of DECAL_ZONES) if (x > d.x0 && x < d.x1 && y > d.y0 && y < d.y1 && z > d.z0 && z < d.z1) return { mat: d.mat || 'M_Hull_Light', d: 0.08 };`);
rep(`    DECAL_ZONES.push({ x0: 10.6, x1: 21.6, y0: 0.95, y1: 2.85, side: s });              // логотип
    DECAL_ZONES.push({ x0: -33.5, x1: -27.5, y0: -2.75, y1: -0.9, side: s });          // бортовой номер
    DECAL_ZONES.push({ x0: 30.5, x1: 36.5, y0: -2.75, y1: -0.9, side: s, mat: 'M_Hull_Dark' }); // номер на носу (светлый текст)`,
    `    const zr = s > 0 ? [7.5, 9.5] : [-9.5, -7.5], pr = s > 0 ? [POD_Z + 2.5, POD_Z + 3.6] : [-POD_Z - 3.6, -POD_Z - 2.5];
    const zone = (x0, x1, y0, y1, z, mat) => DECAL_ZONES.push({ x0, x1, y0, y1, z0: z[0], z1: z[1], mat });
    zone(10.6, 21.6, 0.95, 2.85, zr);                   // логотип
    zone(-33.5, -27.5, -2.75, -0.9, zr);                // бортовой номер
    zone(-23.5, -16.5, -2.75, -0.9, zr);                // регистрация
    zone(30.5, 36.5, -2.75, -0.9, zr, 'M_Hull_Dark');   // номер на носу (светлый текст)
    zone(-9.5, -4.2, -2.4, -0.2, pr);                   // предупреждение у воздухозаборника`);
rep(`0.42 * t * t - 0.06)); }`, `0.42 * t * t + 0.06)); }`);
rep(`    for (let i = 0; i < 10; i++) { const t = i / 10; dishPts.push(new THREE.Vector2(0.05 + 1.45 * t, 0.42 * t * t)); }`,
    `    for (let i = 0; i <= 10; i++) { const t = i / 10; dishPts.push(new THREE.Vector2(0.05 + 1.45 * t, 0.42 * t * t)); }`);
rep(`    // стык кабины с корпусом
    for (const s of [-1, 1]) F(N.Cockpit).box('M_Metal_Dark', 36.2, 1.9, s * 7.95, 20.5, 0.22, 0.25, -s * 0.05);\n`, '');
rep(`    f.sph('M_Nav_' + (s < 0 ? 'Red' : 'Green'), -5.4, 0.75, s * 16.05, 0.16, 12);
    f.sph('M_Nav_White', -47.6, 0.75, zc, 0.13, 10);`,
    `    f.sph('M_Nav_' + (s < 0 ? 'Red' : 'Green'), -7.2, -1.4, s * (POD_Z + 3.12), 0.16, 12);
    f.sph('M_Nav_White', -47.56, -0.1, zc, 0.13, 10);`);
rep(`s * (POD_Z + s * 3.25), rr(0.6, 2.4), rr(0.25, 0.7), 0.18); }`, `s * (POD_Z + 3.3), rr(0.6, 2.4), rr(0.25, 0.7), 0.3); }`);
rep(`    f.sph('M_Nav_White', -49.95, 3.75, 0, 0.14, 10);`, `    f.sph('M_Nav_White', -49.3, 3.45, 0, 0.14, 10);`);
rep(`  const shell = new THREE.LatheGeometry(pts, 32); shell.rotateZ(PI / 2);`, `  const shell = new THREE.LatheGeometry(pts.reverse(), 32); shell.rotateZ(-PI / 2);`);
rep(`  cone.rotateZ(PI / 2); cone.translate(x, y, z);`, `  cone.rotateZ(-PI / 2); cone.translate(x, y, z);`);
rep(`  decals(N.Decals);`, `  decals(N.Decals, ctx);`);
rep(`    const zs = s * 8.5;
    for (const [x, y] of [[-44, 3.4], [-44, -4.1], [23.5, 3.6], [23.5, -4.2], [-10, -3.9]]) {
      const g = f.sub(x, y, zs, 0);`,
    `    const zs = s * 8.5;
    for (const [x, y] of [[-43, 3.2], [-43, -4.0], [23.5, 3.5], [23.5, -4.1], [-10, -3.9]]) {
      const g = f.sub(x, y, s * hullW(x, y), 0);`);
rep(`    for (const x of [-30, -24.5, -12, 2]) for (let i = 0; i < 7; i++) f.box('M_Metal_Dark', x + i * 0.34, -3.6, zs + s * 0.1, 0.16, 0.95, 0.12, 0, 0, 0.01);
    f.cylx('M_Metal_Dark', -10, -5.3, zs + s * 0.18, 0.12, 60, 10);
    f.cylx('M_Metal_Brushed', -10, -5.6, zs + s * 0.14, 0.07, 60, 8);
    for (let x = -38; x < 20; x += 3.5) f.box('M_Greeble', x, -5.85, zs + s * 0.12, 0.3, 0.75, 0.3, 0, 0, 0.02);
    // световые полосы
    f.box('M_Strip_Ext', -4, -6.15, zs + s * 0.04, 40, 0.07, 0.06, 0, 0, 0.005);`,
    `    for (const x of [-12, 2]) { f.box('M_Metal_Dark', x + 1.0, -3.7, zs + s * 0.2, 2.6, 1.05, 0.14, 0, 0, 0.02); for (let i = 0; i < 7; i++) f.box('M_Greeble', x + i * 0.34, -3.6, zs + s * 0.3, 0.16, 0.85, 0.08, 0, 0, 0.01); }
    f.cylx('M_Metal_Dark', -6, -4.05, zs + s * 0.3, 0.12, 62, 10);
    f.cylx('M_Metal_Brushed', -6, -4.33, zs + s * 0.26, 0.07, 62, 8);
    for (let x = -36; x < 24; x += 3.5) f.box('M_Greeble', x, -4.45, zs + s * 0.22, 0.3, 0.62, 0.28, 0, 0, 0.02);
    // световая полоса по низу борта
    f.box('M_Strip_Ext', -4, -4.56, zs + s * 0.12, 54, 0.06, 0.06, 0, 0, 0.005);`);
rep(`function decals(node) {
  // ячейки атласа будут подставлены при экспорте по имени (см. build.mjs → DECAL_RECTS)
  const add = (cell, x, y, z, w, h, side) => {
    const g = quadGeo(w, h, [0, 0, 1, 1]);`,
    `function decals(node, ctx) {
  const atlas = ctx.manifest.sets.Decals, [AW, AH] = atlas.size;
  const rect = (cell) => { const c = atlas.cells[cell]; if (!c) throw new Error('decal cell missing: ' + cell); const [x, y, w, h] = c; return [x / AW, y / AH, (x + w) / AW, (y + h) / AH]; };
  const add = (cell, x, y, z, w, h, side) => {
    const g = quadGeo(w, h, rect(cell));`);
rep(`    const z = s * (8.5 + 0.085);`, `    const z = s * (8.5 + 0.095);`);
rep(`    add('reg', -6, 4.05, z, 6.5, 0.35, s);
    add('intake', -6.8, -1.2, s * (POD_Z + s * 3.25 + 0.04), 2.4, 0.45, s);`,
    `    add('reg', -20, -1.85, z, 6.5, 0.36, s);
    add('intake', -6.9, -1.3, s * (POD_Z + hullPodW(-6.9) + 0.095), 2.4, 0.45, s);`);
rep(`    const g = quadGeo(1.6, 0.6, [0, 0, 1, 1]); g.rotateX(-PI / 2); g.translate(x, 6.4 + 0.175, z);`,
    `    const g = quadGeo(1.6, 0.6, rect('nostep')); g.rotateX(-PI / 2); g.translate(x, 6.4 + 0.175, z);`);
rep(`/* ---------- аккумулятор полигонов с явными UV ---------- */`,
    `const hullPodW = (x) => interp(POD, x).w;

/* ---------- аккумулятор полигонов с явными UV ---------- */`);
fs.writeFileSync(p, s);
