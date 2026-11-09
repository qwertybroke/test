// Генерирует список ракурсов интерьера (координаты glTF) для tools/shot.mjs
import { prepareRooms, DECKS, CORR, WT } from '../src/interior.mjs';
const ROOMS = prepareRooms();
const want = (process.argv[2] || '').split(',').filter(Boolean);
const g = (sx, sy, sz) => [-sz, sy, sx];
const shots = [];
for (const r of ROOMS) {
  if (want.length && !want.includes(r.type) && !want.includes(r.code)) continue;
  if (r.type === 'lift' || r.type === 'bridge') continue;
  const D = DECKS[r.d], ey = D.floor + 1.65;
  let cam, tgt;
  if (r.s === 'L' || r.s === 'R') {
    const zin = r.sg * (CORR + WT + 0.35), zout = r.sg * (r.lim - 0.3);
    cam = g(r.doorX, ey, zin); tgt = g(r.cx + (r.cx - r.doorX) * 0.6, D.floor + 0.9, zout);
  } else {
    const xa = r.door0 ? r.x0 + 0.5 : r.x1 - 0.5, xb = r.door0 ? r.x1 : r.x0;
    cam = g(xa, ey + 0.4, r.lim * 0.55); tgt = g((xa + xb) / 2, D.floor + 0.6, -r.lim * 0.2);
  }
  shots.push({ name: `${r.code}_${r.type}`, q: `cam=${[...cam, ...tgt].map((v) => v.toFixed(2)).join(',')}&fov=80&lights=near&nl=10&exp=1.1` });
}
console.log(JSON.stringify(shots));
