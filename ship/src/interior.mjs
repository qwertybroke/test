// Интерьер: 3 палубы, отсеки с мебелью, коридоры, двери, окна (проёмы + откосы до корпуса), источники света, коллайдеры.
import { THREE, V, PI, TAU, rand, rr, pick, clamp, lerp, chamferBox, plainBox, polysToGeo, quadGeo, SNode, Frame } from './geom.mjs';
import { hullW, MAIN, FRONT, POD, POD_Z } from './exterior.mjs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// старые короткие ключи материалов → материалы ассета
const K = { wall: 'M_Wall_Panel', wallWhite: 'M_Wall_White', wallInd: 'M_Wall_Industrial', floor: 'M_Floor_Deck', floorLight: 'M_Floor_Light', grate: 'M_Floor_Grate',
  ceil: 'M_Ceiling', hazard: 'M_Hazard', metal: 'M_Metal_Brushed', darkMetal: 'M_Metal_Trim', black: 'M_Plastic_Black', white: 'M_Plastic_White',
  yellow: 'M_Paint_Yellow', orange: 'M_Paint_Orange', red: 'M_Paint_Red', fabric: 'M_Fabric_Navy', fabricLight: 'M_Fabric_Beige', fabricRed: 'M_Fabric_Red', fabricBlue: 'M_Fabric_Blue',
  leaf: 'M_Plant_Leaf', soil: 'M_Soil', crate: 'M_Paint_Grey', crateOr: 'M_Paint_Orange', crateGr: 'M_Paint_Green', crateBl: 'M_Paint_Blue', crateTeal: 'M_Paint_Teal',
  wood: 'M_Wood', rubber: 'M_Rubber', mirror: 'M_Mirror', door: 'M_Door', glass: 'M_Glass_Interior', holo: 'M_Hologram', core: 'M_Reactor_Core', liquid: 'M_Liquid_Blue',
  lightW: 'M_Strip_White', lightWarm: 'M_Strip_Warm', lightBlue: 'M_Strip_Blue', lightOrange: 'M_Strip_Orange', lightPurple: 'M_Strip_Purple', lightRed: 'M_Strip_Red',
  lightGreen: 'M_Strip_Green', lightCyan: 'M_Strip_Cyan' };
class IFrame extends Frame {
  sub(...a) { return Object.setPrototypeOf(super.sub(...a), IFrame.prototype); }
  add(mat, g, uv) { return super.add(K[mat] || mat, g, uv); }
}
const LC = { warm: 'Warm', cool: 'White', neutral: 'White', blue: 'Blue', orange: 'Orange', purple: 'Purple', green: 'Green', red: 'Red', cyan: 'Cyan' };

export const DECKS = [
  { id: 'A', name: 'Deck_A_Command', ru: 'Палуба A · Командная', floor: 2.4, ceil: 5.6, x0: -30, x1: 43, corr: [-22, 14] },
  { id: 'B', name: 'Deck_B_Living', ru: 'Палуба B · Жилая', floor: -1.5, ceil: 2.0, x0: -36, x1: 41, corr: [-26, 18] },
  { id: 'C', name: 'Deck_C_Engineering', ru: 'Палуба C · Инженерная', floor: -5.4, ceil: -1.9, x0: -44, x1: 38, corr: [-20, -3] },
];
export const CORR = 1.3, WT = 0.12, DOOR_H = 2.35;
const R = (d, s, x0, x1, type, name, en, extra = {}) => ({ d, s, x0, x1, type, name, en, ...extra });
export const ROOMS = [
  R(0, 'F', -30, -22, 'sensor', 'Сенсорный узел', 'Sensor_Node'),
  R(0, 'L', -22, -14, 'quarters', 'Каюта капитана', 'Captain_Quarters', { win: [-1.6, 3.2] }),
  R(0, 'R', -22, -14, 'quarters', 'Каюта старпома', 'First_Officer_Quarters', { win: [-1.6, 3.2] }),
  R(0, 'L', -14, -7, 'eva', 'Скафандровая', 'EVA_Suit_Room'),
  R(0, 'R', -14, -7, 'server', 'Серверная', 'Server_Room'),
  R(0, 'R', -7, -3, 'lift', 'Лифт', 'Lift_A'),
  R(0, 'L', -7, 4, 'briefing', 'Брифинг-зал', 'Briefing_Room', { win: [-4.0, 4.0] }),
  R(0, 'R', -3, 4, 'nav', 'Астронавигация', 'Astrogation'),
  R(0, 'L', 4, 14, 'office', 'Кабинет капитана', 'Captain_Office', { win: [-3.6, 2.4] }),
  R(0, 'R', 4, 14, 'comms', 'Узел связи', 'Comms'),
  R(0, 'F', 14, 25.5, 'ops', 'Командный центр', 'Operations_Center'),
  R(0, 'B', 25.5, 43.2, 'bridge', 'Командный мостик', 'Command_Bridge'),
  R(1, 'F', -36, -26, 'hydro', 'Гидропоника', 'Hydroponics'),
  R(1, 'L', -26, -12, 'med', 'Медицинский отсек', 'Medical_Bay'),
  R(1, 'R', -26, -17, 'gym', 'Спортзал', 'Gym', { win: [-3.6, 0.6] }),
  R(1, 'R', -17, -7, 'wash', 'Санблок', 'Washroom'),
  R(1, 'R', -7, -3, 'lift', 'Лифт', 'Lift_B'),
  R(1, 'L', -12, -6, 'cabin', 'Каюта 1', 'Crew_Cabin_1', { win: [-1.25, 2.6] }),
  R(1, 'L', -6, 0, 'cabin', 'Каюта 2', 'Crew_Cabin_2', { win: [-1.25, 2.6] }),
  R(1, 'L', 0, 6, 'cabin', 'Каюта 3', 'Crew_Cabin_3', { win: [-1.25, 2.6] }),
  R(1, 'L', 6, 12, 'cabin', 'Каюта 4', 'Crew_Cabin_4', { win: [-1.25, 2.6] }),
  R(1, 'R', -3, 3, 'cabin', 'Каюта 5', 'Crew_Cabin_5', { win: [-1.25, 2.6] }),
  R(1, 'R', 3, 9, 'cabin', 'Каюта 6', 'Crew_Cabin_6', { win: [-1.25, 2.6] }),
  R(1, 'L', 12, 18, 'galley', 'Камбуз', 'Galley'),
  R(1, 'R', 9, 18, 'lounge', 'Зона отдыха', 'Lounge', { win: [-3.6, 3.6] }),
  R(1, 'F', 18, 30, 'mess', 'Кают-компания', 'Mess_Hall', { winF: [24.3, 29.5] }),
  R(1, 'F', 30, 41, 'observe', 'Обзорный салон', 'Observation_Lounge', { winF: [30.7, 39.4] }),
  R(2, 'F', -44, -32, 'engine', 'Машинное отделение', 'Engine_Room'),
  R(2, 'F', -32, -20, 'reactor', 'Реакторный отсек', 'Reactor_Core'),
  R(2, 'L', -20, -8, 'engineering', 'Инженерный пост', 'Engineering'),
  R(2, 'R', -20, -7, 'life', 'Жизнеобеспечение', 'Life_Support'),
  R(2, 'R', -7, -3, 'lift', 'Лифт', 'Lift_C'),
  R(2, 'L', -8, -3, 'storage', 'Склад ЗИП', 'Spare_Parts_Storage'),
  R(2, 'F', -3, 28, 'cargo', 'Грузовой трюм', 'Cargo_Hold'),
  R(2, 'F', 28, 38, 'airlock', 'Шлюзовой отсек', 'Airlock'),
];

function limFor(x0, x1, deck) {
  const D = DECKS[deck]; let m = 99;
  for (let i = 0; i <= 8; i++) { const x = lerp(x0, x1, i / 8); for (let j = 0; j <= 4; j++) m = Math.min(m, hullW(x, lerp(D.floor - 0.35, D.ceil + 0.15, j / 4))); }
  return m - 0.42;
}
const MAT_FLOOR = { med: 'floorLight', wash: 'floorLight', hydro: 'grate', engine: 'grate', reactor: 'grate', server: 'grate', life: 'grate' };
const MAT_WALL = { med: 'wallWhite', wash: 'wallWhite', engine: 'wallInd', reactor: 'wallInd', cargo: 'wallInd', life: 'wallInd', engineering: 'wallInd', storage: 'wallInd', airlock: 'wallInd', server: 'wallInd' };

// подготовить геометрические параметры отсеков (до планирования окон)
export function prepareRooms() {
  const counters = [0, 0, 0];
  for (const r of ROOMS) {
    const D = DECKS[r.d];
    r.L = r.x1 - r.x0; r.H = D.ceil - D.floor; r.cx = (r.x0 + r.x1) / 2;
    r.lim = r.type === 'bridge' ? 8.0 : Math.min(limFor(r.x0, r.x1, r.d), 8.1);
    r.code = `${D.id}-${String(++counters[r.d]).padStart(2, '0')}`;
    if (r.s === 'L' || r.s === 'R') {
      r.sg = r.s === 'R' ? 1 : -1; r.D = r.lim - CORR;
      r.z0 = r.sg > 0 ? CORR : -r.lim; r.z1 = r.sg > 0 ? r.lim : -CORR;
      r.du = r.type === 'lift' ? 0 : r.L / 2 - 1.0;
      r.doorX = r.cx + (r.sg > 0 ? -r.du : r.du);
      if (r.win) { const [l0, l1] = r.win; r.winX = [r.sg < 0 ? [r.cx + l0, r.cx + l1] : [r.cx - l1, r.cx - l0]]; }
    } else { r.z0 = -r.lim; r.z1 = r.lim; if (r.winF) r.winX = [r.winF]; }
    r.win = !!r.winX;
  }
  return ROOMS;
}

/* ---------- атлас табличек ---------- */
export function signAtlas(createCanvas) {
  const W = 2048, H = 1024, cv = createCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#0b1218'; g.fillRect(0, 0, W, H);
  const cells = {};
  let i = 0;
  const cell = (text, code) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 64; i++;
    g.fillStyle = '#0d151c'; g.fillRect(x, y, 512, 64);
    g.strokeStyle = 'rgba(95,208,255,0.35)'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, 506, 58);
    g.fillStyle = '#5fd0ff'; g.fillRect(x + 12, y + 14, 6, 36);
    g.fillStyle = '#e4edf3'; g.font = '500 29px "DejaVu Sans"'; g.textBaseline = 'middle'; g.fillText(text, x + 30, y + 33);
    g.fillStyle = '#5fd0ff'; g.font = 'bold 22px "DejaVu Sans"'; g.textAlign = 'right'; g.fillText(code, x + 496, y + 33); g.textAlign = 'left';
    cells[code] = [x / W, y / H, (x + 512) / W, (y + 64) / H];
  };
  for (const r of ROOMS) cell(r.name, r.code);
  for (const D of DECKS) cell(D.ru, 'DECK-' + D.id);
  return { canvas: cv, cells };
}

/* ---------- построение ---------- */
export function buildInterior(root, ctx, windows, signCells) {
  const intr = root.child('Interior');
  const doorsNode = root.child('Doors');
  const DOORS = [];
  const deckNodes = DECKS.map((D) => { const n = intr.child(D.name); n.vOrigin = D.floor; return n; });
  const colBox = (min, max, kind = 'wall') => ctx.colliders.push({ min, max, kind });

  // узел отсека
  for (const r of ROOMS) {
    const D = DECKS[r.d];
    const pos = (r.s === 'L' || r.s === 'R') ? V(r.cx, D.floor, r.sg * r.lim) : V(r.cx, D.floor, 0);
    r.node = deckNodes[r.d].child(`${r.code}_${r.en}`, pos);
    r.node.vOrigin = D.floor;
    const m = (r.s === 'L' || r.s === 'R') ? new THREE.Matrix4().makeRotationY(r.sg > 0 ? PI : 0) : new THREE.Matrix4();
    r.f = new IFrame(r.node, m, ctx, { deck: r.d, code: r.code });
    // кадр в координатах палубы (x,z корабля, y от пола)
    r.fd = new IFrame(r.node, new THREE.Matrix4().makeTranslation(-pos.x, 0, -pos.z), ctx, { deck: r.d, code: r.code });
  }
  const winsOf = (r) => windows.filter((w) => w.room === r.code);

  function addDoor(deck, x, z, axis, w, code) {
    const D = DECKS[deck];
    const node = doorsNode.child(`Door_${code}`, V(x, D.floor, z));
    const f = new IFrame(node, new THREE.Matrix4().makeRotationY(axis === 'x' ? 0 : PI / 2), ctx, { deck });
    f.box('darkMetal', -w / 2 - 0.08, 0, 0, 0.16, DOOR_H + 0.12, WT + 0.1, 0, 0, 0.03);
    f.box('darkMetal', w / 2 + 0.08, 0, 0, 0.16, DOOR_H + 0.12, WT + 0.1, 0, 0, 0.03);
    f.box('darkMetal', 0, DOOR_H, 0, w + 0.32, 0.16, WT + 0.1, 0, 0, 0.03);
    for (const s of [-1, 1]) f.box('lightCyan', 0, DOOR_H + 0.05, s * (WT / 2 + 0.055), w * 0.6, 0.04, 0.012, 0, 0, 0.003);
    f.box('hazard', 0, 0, 0, w + 0.1, 0.012, WT + 0.25, 0, 0, 0.002);
    const ax = axis === 'x' ? V(1, 0, 0) : V(0, 0, 1);
    for (const [n, s] of [['Leaf_L', -1], ['Leaf_R', 1]]) {
      const leaf = node.child(n, ax.clone().multiplyScalar(s * w / 4));
      const lf = new IFrame(leaf, new THREE.Matrix4().makeRotationY(axis === 'x' ? 0 : PI / 2), ctx, { deck });
      lf.box('door', 0, 0, 0, w / 2 - 0.01, DOOR_H, 0.08, 0, 0, 0.015);
      for (const zz of [-1, 1]) {
        lf.box('darkMetal', 0, 0.9, zz * 0.045, w / 2 - 0.12, 0.08, 0.012, 0, 0, 0.003);
        lf.box('lightCyan', -s * (w / 4 - 0.06), 1.0, zz * 0.045, 0.03, 0.5, 0.012, 0, 0, 0.003);
      }
    }
    node.extras = { type: 'sliding_door', slideAxis: [ax.x, ax.y, ax.z], openDistance: +(w * 0.47).toFixed(3), leaves: ['Leaf_L', 'Leaf_R'], room: code };
    DOORS.push({ deck, x, z, axis, w, code });
  }
  // стена с проёмами: openings [{c, w, y0, y1}] (y — от пола)
  function wallRun(r, k, a0, a1, c, axis, openings, H) {
    const f = r.fd, D = DECKS[r.d];
    const seg = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
      if (axis === 'x') f.slab(k, (s0 + s1) / 2, y0, c, s1 - s0, y1 - y0, WT); else f.slab(k, c, y0, (s0 + s1) / 2, WT, y1 - y0, s1 - s0);
      const mn = axis === 'x' ? V(s0, D.floor + y0, c - WT / 2) : V(c - WT / 2, D.floor + y0, s0);
      const mx = axis === 'x' ? V(s1, D.floor + y1, c + WT / 2) : V(c + WT / 2, D.floor + y1, s1);
      colBox(mn, mx);
    };
    let cur = a0;
    for (const o of [...openings].sort((p, q) => p.c - q.c)) {
      seg(cur, o.c - o.w / 2, 0, H);
      seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0);
      seg(o.c - o.w / 2, o.c + o.w / 2, o.y1, H);
      cur = o.c + o.w / 2;
    }
    seg(cur, a1, 0, H);
  }
  // окно: рама изнутри + откосы до проёма в корпусе
  function windowFrames(r, side, zWallOut) {
    const D = DECKS[r.d], f = r.fd;
    for (const w of winsOf(r).filter((w) => w.side === side)) {
      const y0 = w.y0 - D.floor, y1 = w.y1 - D.floor, zi = zWallOut - side * WT, zt = zi - side * 0.03;
      const xm = (w.x0 + w.x1) / 2, wd = w.x1 - w.x0;
      f.box('darkMetal', xm, y0 - 0.1, zt, wd + 0.24, 0.1, 0.07, 0, 0, 0.015);
      f.box('darkMetal', xm, y1, zt, wd + 0.24, 0.1, 0.07, 0, 0, 0.015);
      for (const s of [-1, 1]) f.box('darkMetal', xm + s * (wd / 2 + 0.06), y0, zt, 0.12, y1 - y0, 0.07, 0, 0, 0.015);
      f.box('white', xm, y0 - 0.05, zi - side * 0.12, wd + 0.1, 0.05, 0.26, 0, 0, 0.01); // подоконник
      const hole = ctx.holes.get(w.id);
      if (!hole) continue;
      const inner = [V(w.x0, w.y0, zWallOut), V(w.x1, w.y0, zWallOut), V(w.x1, w.y1, zWallOut), V(w.x0, w.y1, zWallOut)];
      const outer = inner.map((p) => hole.pts.reduce((b, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? q : b)));
      const cen = V(xm, (w.y0 + w.y1) / 2, 0);
      const polys = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, q = [inner[i], inner[j], outer[j], outer[i]];
        const fc = q.reduce((s, p) => s.add(p), V()).multiplyScalar(0.25);
        const out = V(cen.x - fc.x, cen.y - fc.y, 0);
        const nq = V().subVectors(q[1], q[0]).cross(V().subVectors(q[2], q[0]));
        polys.push(nq.dot(out) < 0 ? [...q].reverse() : q);
      }
      const g = polysToGeo(polys);
      g.translate(-r.node._world.x, -r.node._world.y, -r.node._world.z);
      r.node.part.add('M_Metal_Trim', g);
    }
  }

  // оболочки отсеков
  for (const r of ROOMS) {
    if (r.type === 'bridge') continue;
    const D = DECKS[r.d], H = r.H, wk = MAT_WALL[r.type] || 'wall', f = r.fd;
    f.slab(MAT_FLOOR[r.type] || 'floor', r.cx, -0.3, (r.z0 + r.z1) / 2, r.L, 0.3, r.z1 - r.z0);
    f.slab('ceil', r.cx, H, (r.z0 + r.z1) / 2, r.L, 0.1, r.z1 - r.z0);
    colBox(V(r.x0, D.floor - 0.3, r.z0), V(r.x1, D.floor, r.z1), 'floor');
    const winOpen = (side) => winsOf(r).filter((w) => w.side === side).map((w) => ({ c: (w.x0 + w.x1) / 2, w: w.x1 - w.x0, y0: w.y0 - D.floor, y1: w.y1 - D.floor }));
    if (r.s === 'L' || r.s === 'R') {
      const zi = r.sg * (CORR + WT / 2), zo = r.sg * (r.lim - WT / 2);
      wallRun(r, 'wall', r.x0, r.x1, zi, 'x', [{ c: r.doorX, w: 1.4, y0: 0, y1: DOOR_H }], H);
      wallRun(r, wk, r.x0, r.x1, zo, 'x', winOpen(r.sg), H);
      windowFrames(r, r.sg, r.sg * r.lim);
      wallRun(r, wk, Math.min(r.z0, r.z1) + WT, Math.max(r.z0, r.z1) - WT, r.x0 + WT / 2, 'z', [], H);
      wallRun(r, wk, Math.min(r.z0, r.z1) + WT, Math.max(r.z0, r.z1) - WT, r.x1 - WT / 2, 'z', [], H);
      addDoor(r.d, r.doorX, zi, 'x', 1.4, r.code);
      f.quad('M_Signs', r.doorX, DOOR_H + 0.45, r.sg * (CORR - 0.012), 1.6, 0.2, r.sg > 0 ? PI : 0, signCells[r.code]);
    } else {
      const nb0 = r.x0 <= D.x0 + 0.01 ? null : (ROOMS.find((o) => o.d === r.d && (o.s === 'F' || o.s === 'B') && Math.abs(o.x1 - r.x0) < 0.01) || 'corr');
      const nb1 = r.x1 >= D.x1 - 0.01 ? null : (ROOMS.find((o) => o.d === r.d && (o.s === 'F' || o.s === 'B') && Math.abs(o.x0 - r.x1) < 0.01) || 'corr');
      r.door0 = !!nb0; r.door1 = !!nb1;
      wallRun(r, wk, r.x0, r.x1, r.lim - WT / 2, 'x', winOpen(1), H);
      wallRun(r, wk, r.x0, r.x1, -r.lim + WT / 2, 'x', winOpen(-1), H);
      windowFrames(r, 1, r.lim); windowFrames(r, -1, -r.lim);
      if (!nb0 || nb0 === 'corr') {
        wallRun(r, nb0 ? 'wall' : wk, -r.lim + WT, r.lim - WT, r.x0 + WT / 2, 'z', nb0 ? [{ c: 0, w: 2.0, y0: 0, y1: DOOR_H }] : [], H);
        if (nb0) addDoor(r.d, r.x0 + WT / 2, 0, 'z', 2.0, r.code + '_Aft');
      }
      wallRun(r, nb1 ? 'wall' : wk, -r.lim + WT, r.lim - WT, r.x1 - WT / 2, 'z', nb1 ? [{ c: 0, w: 2.0, y0: 0, y1: DOOR_H }] : [], H);
      if (nb1) addDoor(r.d, r.x1 - WT / 2, 0, 'z', 2.0, r.code + '_Fwd');
      if (nb1 === 'corr') f.quad('M_Signs', r.x1 + 0.012, DOOR_H + 0.45, 0, 1.6, 0.2, PI / 2, signCells[r.code]);
      if (nb0 === 'corr') f.quad('M_Signs', r.x0 - 0.012, DOOR_H + 0.45, 0, 1.6, 0.2, -PI / 2, signCells[r.code]);
    }
  }
  // коридоры
  for (let d = 0; d < 3; d++) {
    const D = DECKS[d], [c0, c1] = D.corr, H = D.ceil - D.floor, L = c1 - c0, cx = (c0 + c1) / 2;
    const node = deckNodes[d].child(`${D.id}-00_Corridor`, V(cx, D.floor, 0)); node.vOrigin = D.floor;
    const f = new IFrame(node, new THREE.Matrix4().makeTranslation(-cx, 0, 0), ctx, { deck: d, code: D.id + '-00' });
    f.slab('floor', cx, -0.3, 0, L, 0.3, CORR * 2); f.slab('ceil', cx, H, 0, L, 0.1, CORR * 2);
    colBox(V(c0, D.floor - 0.3, -CORR), V(c1, D.floor, CORR), 'floor');
    for (const s of [-1, 1]) { f.box('lightCyan', cx, 0.02, s * (CORR - 0.16), L, 0.02, 0.035, 0, 0, 0.004); f.box('darkMetal', cx, 0, s * (CORR - 0.07), L, 0.14, 0.14, 0, 0, 0.02); }
    const doorXs = DOORS.filter((o) => o.deck === d && o.axis === 'x').map((o) => o.x);
    for (let x = c0 + 1.5; x < c1 - 0.5; x += 3) {
      f.box('darkMetal', x, H - 0.24, 0, 0.28, 0.24, CORR * 2, 0, 0, 0.03);
      for (const s of [-1, 1]) if (!doorXs.some((dx) => Math.abs(dx - x) < 1.0)) {
        f.box('darkMetal', x, 0, s * (CORR - 0.06), 0.28, H, 0.12, 0, 0, 0.03);
        f.box('darkMetal', x, H - 0.6, s * (CORR - 0.22), 0.28, 0.36, 0.3, 0, 0, 0.03);
        f.cylx('metal', x + 1.5, H - 0.28, s * (CORR - 0.25), 0.06, 2.7, 10);
        f.cylx('yellow', x + 1.5, H - 0.48, s * (CORR - 0.18), 0.04, 2.7, 8);
      }
      lightPanel(f, x + 1.5, H, 0, 1.4, 0.5, 'cool', 8, 6);
    }
    // табличка палубы у лифта
    f.quad('M_Signs', -5, DOOR_H + 0.45, -CORR + 0.012, 1.6, 0.2, 0, signCells['DECK-' + D.id]);
  }

  // мебель
  for (const r of ROOMS) { if (r.type === 'bridge') buildBridge(r); else FURN[r.type](r.f, r); }
  return { intr, doorsNode, DOORS };
}

/* ---------- мебель и оборудование ---------- */
function lightPanel(f, x, H, z, w, d, col, I, range, rot = 0) {
  const g = f.sub(x, 0, z, rot);
  g.box('darkMetal', 0, H - 0.05, 0, w + 0.1, 0.05, d + 0.1, 0, 0, 0.012);
  g.quad('M_Light_' + LC[col], 0, H - 0.052, 0, w, d, 0, [0, 0, 1, 1], PI / 2);
  g.light(0, H - 0.25, 0, col, I, range);
}
function ceilPanels(f, r, pts, col, I, range, key, size = [1.2, 0.45]) {
  for (const [x, z] of pts) lightPanel(f, x, r.H, z, size[0], size[1], col, I, range);
}
function chair(f, x, z, ry, k = 'fabric') {
  const c = f.sub(x, 0, z, ry);
  c.cyl('darkMetal', 0, 0, 0, 0.27, 0.05, 12); c.cyl('metal', 0, 0.05, 0, 0.04, 0.36, 8);
  c.box(k, 0, 0.41, 0, 0.52, 0.1, 0.5); c.box(k, 0, 0.5, -0.23, 0.5, 0.62, 0.08, 0, -0.12);
  c.box('darkMetal', 0.27, 0.5, 0, 0.05, 0.2, 0.38); c.box('darkMetal', -0.27, 0.5, 0, 0.05, 0.2, 0.38);
  c.block(-0.3, -0.3, 0.3, 0.3);
}
function bigChair(f, x, z, ry, k = 'fabric') {
  const c = f.sub(x, 0, z, ry);
  c.cyl('darkMetal', 0, 0, 0, 0.36, 0.08, 16); c.cyl('metal', 0, 0.08, 0, 0.08, 0.36, 12);
  c.box('darkMetal', 0, 0.42, 0, 0.7, 0.08, 0.66);
  c.box(k, 0, 0.5, 0.02, 0.6, 0.12, 0.6); c.box(k, 0, 0.55, -0.3, 0.6, 0.85, 0.12, 0, -0.15); c.box(k, 0, 1.36, -0.37, 0.36, 0.22, 0.1, 0, -0.15);
  for (const s of [-1, 1]) { c.box('darkMetal', s * 0.36, 0.5, 0, 0.1, 0.3, 0.6); c.box('black', s * 0.36, 0.8, 0.08, 0.14, 0.05, 0.4); c.box('lightBlue', s * 0.36, 0.85, 0.2, 0.08, 0.01, 0.1); }
  c.block(-0.42, -0.42, 0.42, 0.42);
}
function desk(f, x, z, ry, w, d = 0.7, h = 0.76, k = 'white') {
  const c = f.sub(x, 0, z, ry);
  c.box(k, 0, h - 0.05, 0, w, 0.05, d);
  c.box('darkMetal', -w / 2 + 0.06, 0, 0, 0.06, h - 0.05, d - 0.08); c.box('darkMetal', w / 2 - 0.06, 0, 0, 0.06, h - 0.05, d - 0.08);
  c.box('darkMetal', 0, 0.3, -d / 2 + 0.06, w - 0.1, 0.4, 0.03);
  c.block(-w / 2, -d / 2, w / 2, d / 2, h);
}
function monitor(f, x, y, z, ry, w = 0.62, h = 0.38, cell = 2) {
  const c = f.sub(x, y, z, ry);
  c.box('black', 0, 0, -0.05, 0.22, 0.02, 0.16); c.box('black', 0, 0, -0.08, 0.05, 0.22, 0.04);
  c.box('black', 0, 0.16, -0.05, w + 0.04, h + 0.04, 0.03);
  c.screen(0, 0.16 + (h + 0.04) / 2, -0.033, w, h, 0, cell);
}
function consoleUnit(f, x, z, ry, w = 1.6, cells = [2], k = 'darkMetal') {
  const c = f.sub(x, 0, z, ry);
  c.box(k, 0, 0, -0.12, w, 0.72, 0.62);
  c.box('metal', 0, 0.72, -0.05, w + 0.04, 0.05, 0.78);
  const p = c.sub(0, 0.82, -0.08, 0, -1.2);
  p.box('black', 0, 0, 0, w - 0.1, 0.42, 0.04); p.screen(0, 0.21, 0.025, w - 0.18, 0.34, 0, 11);
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const sx = -w / 2 + (w / n) * (i + 0.5);
    const s = c.sub(sx, 0.86, -0.42, 0, -0.18);
    s.box('black', 0, 0, 0, w / n - 0.06, 0.62, 0.05); s.screen(0, 0.31, 0.03, w / n - 0.14, 0.52, 0, cells[i]);
  }
  c.box('lightBlue', 0, 0.74, 0.34, w, 0.012, 0.012);
  for (let i = 0; i < Math.floor(w / 0.25); i++) c.box(pick(['lightCyan', 'lightOrange', 'black', 'black']), -w / 2 + 0.15 + i * 0.25, 0.77, 0.2, 0.06, 0.012, 0.04);
  c.block(-w / 2, -0.45, w / 2, 0.36);
}
function bed(f, x, z, ry, w = 1.0, l = 2.05, k = 'fabricLight', y = 0) {
  const c = f.sub(x, y, z, ry);
  c.box('darkMetal', 0, 0, 0, w, 0.32, l);
  c.box('white', 0, 0.32, 0, w - 0.06, 0.18, l - 0.06);
  c.box(k, 0, 0.5, l * 0.15, w - 0.02, 0.05, l * 0.66);
  c.box('white', 0, 0.5, -l / 2 + 0.3, w * 0.7, 0.1, 0.36);
  c.box('darkMetal', 0, 0.32, -l / 2 - 0.03, w, 0.55, 0.06);
  if (y === 0) c.block(-w / 2, -l / 2, w / 2, l / 2, 0.6);
}
function locker(f, x, z, ry, w, h = 2.1, d = 0.55, k = 'metal', n = 0) {
  const c = f.sub(x, 0, z, ry);
  c.box(k, 0, 0, 0, w, h, d);
  const cnt = n || Math.max(1, Math.round(w / 0.5));
  for (let i = 1; i < cnt; i++) c.box('black', -w / 2 + (w / cnt) * i, 0.05, d / 2, 0.015, h - 0.1, 0.01);
  for (let i = 0; i < cnt; i++) c.box('black', -w / 2 + (w / cnt) * (i + 0.8), h * 0.5, d / 2 + 0.01, 0.03, 0.18, 0.03);
  c.block(-w / 2, -d / 2, w / 2, d / 2, h);
}
function shelf(f, x, z, ry, w, h, d, levels, fill = 0.7) {
  const c = f.sub(x, 0, z, ry);
  for (const sx of [-w / 2 + 0.03, w / 2 - 0.03]) for (const sz of [-d / 2 + 0.03, d / 2 - 0.03]) c.box('darkMetal', sx, 0, sz, 0.05, h, 0.05);
  for (let i = 0; i < levels; i++) {
    const y = 0.12 + i * (h - 0.2) / (levels - 1 || 1);
    c.box('metal', 0, y, 0, w, 0.04, d);
    if (i < levels - 1) for (let bx = -w / 2 + 0.1; bx < w / 2 - 0.25; bx += rr(0.3, 0.6)) if (rand() < fill) {
      const s = rr(0.18, 0.4); c.box(pick(['crate', 'crateOr', 'crateGr', 'crateBl', 'white']), bx + s / 2, y + 0.04, rr(-0.05, 0.05), s, rr(0.15, Math.min(0.45, (h - 0.2) / (levels - 1) - 0.08)), Math.min(d - 0.1, s * 1.2));
    }
  }
  c.block(-w / 2, -d / 2, w / 2, d / 2, h);
}
function crate(f, x, y, z, s, k, ry = 0, block = true) {
  const c = f.sub(x, y, z, ry);
  c.box(k, 0, 0, 0, s[0], s[1], s[2], 0, 0, 0.03);
  for (const yy of [0.04, s[1] - 0.1]) c.box('darkMetal', 0, yy, 0, s[0] + 0.03, 0.06, s[2] + 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('darkMetal', sx * (s[0] / 2 - 0.02), 0, sz * (s[2] / 2 - 0.02), 0.07, s[1], 0.07, 0, 0, 0.01);
  c.box('white', 0, s[1] * 0.45, s[2] / 2 + 0.01, s[0] * 0.4, s[1] * 0.18, 0.01);
  if (block && y < 0.5) c.block(-s[0] / 2, -s[2] / 2, s[0] / 2, s[2] / 2, s[1]);
}
function container(f, x, z, ry, l, w, h, k) {
  const c = f.sub(x, 0, z, ry);
  c.box(k, 0, 0, 0, l, h, w);
  for (let u = -l / 2 + 0.25; u < l / 2; u += 0.42) for (const s of [-1, 1]) c.box(k, u, 0.12, s * (w / 2 + 0.02), 0.12, h - 0.24, 0.04);
  for (const s of [-1, 1]) { c.box('darkMetal', s * (l / 2 - 0.06), 0, 0, 0.14, h, w + 0.08); c.box('darkMetal', 0, s > 0 ? h - 0.1 : 0, 0, l, 0.1, w + 0.08); }
  c.box('white', 0, h * 0.62, w / 2 + 0.05, 1.3, 0.35, 0.01);
  c.block(-l / 2, -w / 2, l / 2, w / 2, h);
}
function sofa(f, x, z, ry, w, k = 'fabric') {
  const c = f.sub(x, 0, z, ry);
  c.box('darkMetal', 0, 0, 0, w, 0.12, 0.85);
  c.box(k, 0, 0.12, 0.05, w - 0.3, 0.3, 0.72, 0, 0, 0.06);
  c.box(k, 0, 0.12, -0.33, w, 0.75, 0.2, 0, 0, 0.06);
  for (const s of [-1, 1]) c.box(k, s * (w / 2 - 0.08), 0.12, 0.02, 0.16, 0.48, 0.82, 0, 0, 0.05);
  for (let i = 0; i < Math.round((w - 0.3) / 0.7); i++) c.box(k, -w / 2 + 0.5 + i * 0.7, 0.42, 0.05, 0.66, 0.08, 0.66, 0, 0, 0.04);
  c.block(-w / 2, -0.45, w / 2, 0.45, 0.9);
}
function table(f, x, z, ry, w, d, h = 0.75, k = 'white', round = false) {
  const c = f.sub(x, 0, z, ry);
  if (round) { c.cyl(k, 0, h - 0.05, 0, w / 2, 0.05, 28); c.cyl('darkMetal', 0, 0, 0, 0.06, h - 0.05, 10); c.cyl('darkMetal', 0, 0, 0, 0.3, 0.04, 16); c.block(-w / 2, -w / 2, w / 2, w / 2, h); return; }
  c.box(k, 0, h - 0.05, 0, w, 0.05, d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.box('darkMetal', sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.06, h - 0.05, 0.06);
  c.block(-w / 2, -d / 2, w / 2, d / 2, h);
}
function plant(f, x, z, h = 1.0, y = 0) {
  const c = f.sub(x, y, z, rr(0, TAU));
  c.cyl('white', 0, 0, 0, 0.2, 0.36, 16, 0.24);
  c.cyl('soil', 0, 0.34, 0, 0.22, 0.02, 16);
  for (let i = 0; i < 9; i++) { const a = rr(0, TAU), rad = rr(0.05, 0.22); c.sph(pick(['leaf', 'M_Plant_Leaf2']), Math.cos(a) * rad, 0.4 + rr(0.1, h - 0.2), Math.sin(a) * rad, rr(0.1, 0.2), 8, rr(1.2, 2.2)); }
  if (y === 0) c.block(-0.25, -0.25, 0.25, 0.25, h);
}
function suit(f, x, z, ry) {
  const c = f.sub(x, 0, z, ry);
  for (const s of [-1, 1]) { c.cyl('white', s * 0.12, 0.08, 0, 0.1, 0.82, 12); c.box('darkMetal', s * 0.12, 0, 0.03, 0.16, 0.1, 0.26); }
  c.cyl('white', 0, 0.88, 0, 0.27, 0.7, 16, 0.3);
  c.box('darkMetal', 0, 0.95, -0.28, 0.42, 0.55, 0.18);
  for (const s of [-1, 1]) c.cyl('white', s * 0.36, 0.9, 0, 0.08, 0.6, 10);
  c.sph('white', 0, 1.82, 0, 0.21, 16); c.sph('black', 0, 1.83, 0.06, 0.17, 16);
  c.box('orange', 0, 1.25, 0.25, 0.18, 0.08, 0.04);
}
function holoOrb(f, x, y, z, r = 0.45) {
  f.sph('holo', x, y, z, r, 20);
  f.tor('holo', x, y, z, r * 1.5, 0.01, PI / 2.3, 48);
  f.tor('holo', x, y, z, r * 1.9, 0.008, PI / 1.8, 48);
}
function holoShip(f, x, y, z, s) {
  const loft = (st, zOff = 0) => {
    const ring = (p) => [[p.yT, p.w - p.cT], [p.yT - p.hT, p.w], [p.yB + p.hB, p.w], [p.yB, p.w - p.cB], [p.yB, -(p.w - p.cB)], [p.yB + p.hB, -p.w], [p.yT - p.hT, -p.w], [p.yT, -(p.w - p.cT)]];
    const rings = st.map((p) => ring(p).map(([yy, zz]) => V(p.x, yy, zz + zOff)));
    const polys = [];
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; polys.push([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]); }
    return polysToGeo(polys);
  };
  const g = mergeGeometries([loft(MAIN), loft(FRONT), loft(POD, POD_Z), loft(POD, -POD_Z)]);
  g.scale(s, s, s); g.translate(x, y, z);
  f.add('holo', g);
}
const FURN = {
  cabin(f, r) {
    const hx = r.L / 2 - WT, D = r.D, H = r.H, b1 = -hx + 0.55;
    bed(f, b1, 1.25, 0); bed(f, b1, 1.25, 0, 1.0, 2.05, 'fabricBlue', 1.25);
    for (const z of [0.2, 2.3]) f.box('darkMetal', b1 + 0.47, 0, z, 0.06, 1.95, 0.06);
    for (let y = 0.4; y < 1.8; y += 0.3) f.box('metal', b1 + 0.52, y, 2.3, 0.03, 0.03, 0.4);
    f.box('lightWarm', -hx + 0.03, 1.05, 1.25, 0.02, 0.04, 1.6);
    desk(f, 0.9, 0.47, 0, 1.7); monitor(f, 0.9, 0.76, 0.4, 0, 0.6, 0.36, pick([2, 5, 8, 14]));
    chair(f, 0.9, 1.25, PI);
    locker(f, hx - 0.3, 3.1, -PI / 2, 1.6, 2.2, 0.6, 'white', 3);
    f.box('fabricRed', -0.3, 0, 3.6, 2.0, 0.012, 2.2, 0, 0, 0.002);
    table(f, -1.6, 4.4, 0, 0.7, 0.7, 0.55, 'white', true);
    chair(f, -1.6, 5.15, PI, 'fabricLight');
    f.box('darkMetal', -hx + 0.02, 1.0, 4.2, 0.04, 0.7, 1.3); f.screen(-hx + 0.05, 1.35, 4.2, 1.2, 0.6, PI / 2, 14);
    ceilPanels(f, r, [[0, D * 0.45]], 'warm', 12, 7.5);
    f.light(b1, 1.0, 1.25, 'warm', 2.5, 2.4);
  },
  quarters(f, r) {
    const hx = r.L / 2 - WT, D = r.D;
    bed(f, -hx + 1.15, 2.2, PI / 2, 1.8, 2.1, 'fabricBlue');
    for (const z of [0.95, 3.45]) { f.box('white', -hx + 0.28, 0, z, 0.45, 0.5, 0.45); f.cyl('lightWarm', -hx + 0.28, 0.5, z, 0.08, 0.25, 12); }
    f.box('darkMetal', -hx + 0.02, 0.6, 2.2, 0.06, 1.2, 2.2); f.box('lightWarm', -hx + 0.06, 1.75, 2.2, 0.02, 0.04, 2.0);
    desk(f, 1.5, 0.47, 0, 1.9, 0.7, 0.76, 'wood'); monitor(f, 1.5, 0.76, 0.4, 0, 0.7, 0.4, 5); chair(f, 1.5, 1.25, PI);
    sofa(f, 0.0, D - 0.62, PI, 2.0, 'fabricLight');
    table(f, 0.0, D - 1.65, 0, 1.0, 0.55, 0.42, 'wood');
    locker(f, hx - 0.3, 2.2, -PI / 2, 1.4, 2.2, 0.6, 'wood', 2);
    f.box('fabricRed', -0.2, 0, 2.6, 2.6, 0.012, 1.8, 0, 0, 0.002);
    plant(f, -hx + 0.4, D - 0.5, 1.1);
    ceilPanels(f, r, [[-1.8, D * 0.45], [1.8, D * 0.45]], 'warm', 10, 6.5);
  },
  eva(f, r) {
    const hx = r.L / 2 - WT, D = r.D;
    for (const x of [-2.4, -0.8, 0.8]) {
      f.box('darkMetal', x, 0, WT + 0.08, 1.4, 2.6, 0.12); f.box('lightCyan', x, 2.45, WT + 0.16, 1.1, 0.03, 0.02);
      f.box('hazard', x, 0, 0.75, 1.3, 0.012, 1.1, 0, 0, 0.002);
      suit(f, x, 0.62, 0); f.block(x - 0.5, 0.1, x + 0.5, 1.1, 2);
    }
    f.box('fabric', -0.8, 0, 2.7, 3.2, 0.42, 0.45); f.block(-2.4, 2.4, 0.8, 3.0, 0.45);
    locker(f, -hx + 0.3, 3.4, PI / 2, 2.4, 2.1, 0.55, 'metal');
    shelf(f, 2.7, 0.55, 0, 1.0, 2.0, 0.6, 4, 0.8);
    for (let i = 0; i < 3; i++) f.sph('white', 2.45 + i * 0.25, 2.05, 0.5, 0.11, 14);
    ceilPanels(f, r, [[-1.5, D * 0.45], [1.5, D * 0.45]], 'cool', 11, 6);
  },
  server(f, r) {
    const hx = r.L / 2 - WT, D = r.D;
    for (const z of [1.1, 3.1]) for (let x = -hx + 0.5; x < 1.9; x += 0.62) {
      f.box('black', x, 0, z, 0.58, 2.1, 0.75);
      for (const s of [-1, 1]) f.screen(x, 1.05, z + s * 0.38, 0.48, 1.9, s > 0 ? 0 : PI, 13);
      f.block(x - 0.3, z - 0.38, x + 0.3, z + 0.38, 2.1);
    }
    for (const z of [1.1, 3.1]) { f.box('darkMetal', -0.6, r.H - 0.35, z, 5.6, 0.08, 0.4); f.box('lightBlue', -0.6, 2.12, z, 5.4, 0.02, 0.05); }
    consoleUnit(f, 2.6, 0.55, 0, 1.2, [9]);
    ceilPanels(f, r, [[-1.5, 2.1], [1.2, 2.1]], 'blue', 8, 6);
  },
  briefing(f, r) {
    const hx = r.L / 2 - WT;
    table(f, -0.6, 2.6, 0, 5.6, 1.4, 0.76, 'darkMetal');
    f.box('lightBlue', -0.6, 0.76, 2.6, 5.2, 0.006, 0.06);
    for (let i = 0; i < 5; i++) { const x = -2.9 + i * 1.15; chair(f, x, 1.55, 0, 'fabricBlue'); chair(f, x, 3.65, PI, 'fabricBlue'); }
    bigChair(f, 2.85, 2.6, -PI / 2);
    f.box('black', -hx + 0.05, 0.7, 2.6, 0.08, 1.9, 3.4); f.screen(-hx + 0.1, 1.65, 2.6, 3.2, 1.7, PI / 2, 3);
    f.cyl('darkMetal', -0.6, 0.76, 2.6, 0.18, 0.06, 16); holoOrb(f, -0.6, 1.35, 2.6, 0.3);
    ceilPanels(f, r, [[-3, 2.6], [0, 2.6], [3, 2.6]], 'neutral', 9, 6);
  },
  nav(f, r) {
    const hx = r.L / 2 - WT;
    f.cyl('darkMetal', -0.3, 0, 2.6, 0.75, 0.82, 20); f.cyl('metal', -0.3, 0.82, 2.6, 1.05, 0.1, 32); f.cyl('lightCyan', -0.3, 0.92, 2.6, 0.95, 0.01, 32);
    f.block(-1.35, 1.55, 0.75, 3.65);
    f.cyl('holo', -0.3, 1.4, 2.6, 0.85, 0.01, 48);
    for (const [rad, y] of [[0.85, 1.42], [0.55, 1.55], [0.3, 1.7]]) f.tor('holo', -0.3, y, 2.6, rad, 0.008, PI / 2, 48);
    holoOrb(f, -0.3, 1.45, 2.6, 0.12);
    consoleUnit(f, -1.7, 0.52, 0, 1.8, [8, 5]); consoleUnit(f, 1.5, 0.52, 0, 1.6, [0]);
    chair(f, -1.7, 1.3, PI); chair(f, 1.5, 1.3, PI);
    f.box('black', hx - 0.04, 0.8, 2.4, 0.06, 1.6, 2.4); f.screen(hx - 0.08, 1.6, 2.4, 2.2, 1.4, -PI / 2, 8);
    ceilPanels(f, r, [[-0.3, 2.6]], 'blue', 7, 6);
  },
  office(f, r) {
    const hx = r.L / 2 - WT, D = r.D;
    desk(f, -0.8, 1.55, 0, 2.3, 0.9, 0.76, 'wood'); monitor(f, -0.8, 0.76, 1.6, PI, 0.7, 0.42, 3);
    bigChair(f, -0.8, 0.8, 0, 'fabricRed');
    chair(f, -1.45, 2.55, PI, 'fabricLight'); chair(f, -0.15, 2.55, PI, 'fabricLight');
    sofa(f, -hx + 0.5, 3.7, PI / 2, 2.2, 'fabricLight'); table(f, -hx + 1.6, 3.7, 0, 0.8, 1.2, 0.42, 'wood');
    shelf(f, hx - 0.25, 2.4, -PI / 2, 2.4, 2.2, 0.4, 5, 0.6);
    f.cyl('metal', 2.0, 0, 3.7, 0.12, 1.0, 12); f.box('black', 2.0, 1.0, 3.7, 0.5, 0.05, 0.5);
    { const m = f.sub(2.0, 1.15, 3.7, 0.5); m.box('white', 0, 0, 0, 0.8, 0.12, 0.18); m.box('white', -0.12, 0.02, 0, 0.3, 0.06, 0.6); m.box('lightBlue', -0.41, 0.04, 0, 0.02, 0.05, 0.12); }
    f.block(1.7, 3.4, 2.3, 4.0);
    plant(f, 2.9, 0.5, 1.3); plant(f, -hx + 0.4, 0.45, 1.0);
    ceilPanels(f, r, [[-2, 2.4], [1.6, 2.4]], 'warm', 10, 6.5);
  },
  comms(f, r) {
    const hx = r.L / 2 - WT;
    for (const x of [-2.8, 0, 2.8]) { consoleUnit(f, x, 0.52, 0, 2.6, [0, 1, 2]); chair(f, x, 1.35, PI); }
    locker(f, -hx + 0.35, 3.0, PI / 2, 2.2, 2.2, 0.65, 'darkMetal', 4);
    for (let i = 0; i < 4; i++) f.screen(-hx + 0.69, 1.6, 2.2 + i * 0.55, 0.35, 0.9, PI / 2, 13);
    f.cyl('darkMetal', 2.6, 0, 3.6, 0.55, 2.2, 20); f.tor('lightCyan', 2.6, 1.0, 3.6, 0.57, 0.03); f.tor('lightCyan', 2.6, 1.6, 3.6, 0.57, 0.03); f.block(2.0, 3.0, 3.2, 4.2, 2.2);
    ceilPanels(f, r, [[-2.5, 2.6], [1.5, 2.6]], 'blue', 9, 6);
  },
  med(f, r) {
    const hx = r.L / 2 - WT, H = r.H;
    for (const x of [-5.3, -3.4, -1.5]) {
      bed(f, x, 1.25, 0, 0.95, 2.0, 'white');
      f.box('black', x, 1.25, WT + 0.03, 0.62, 0.42, 0.04); f.screen(x, 1.46, WT + 0.06, 0.55, 0.36, 0, 7);
      f.cyl('metal', x + 0.65, 0, 0.5, 0.03, 1.8, 8); f.box('glass', x + 0.65, 1.62, 0.5, 0.16, 0.26, 0.07); f.box('liquid', x + 0.65, 1.64, 0.5, 0.12, 0.16, 0.05);
      f.box('darkMetal', x, H - 0.08, 1.25, 0.04, 0.04, 2.2);
    }
    { const c = f.sub(2.6, 0, 3.4, PI / 2);
      c.box('white', 0, 0, 0, 0.7, 0.55, 1.4); c.box('white', 0, 0.55, 0, 0.9, 0.12, 2.2); c.box('fabricLight', 0, 0.67, 0, 0.82, 0.06, 2.0); c.block(-0.55, -1.3, 0.55, 1.3);
      for (const s of [-1, 1]) c.box('white', s * 1.05, 0, 0, 0.15, 0.04, 2.6);
      c.tor('white', 0, 0.05, 0.3, 1.05, 0.09, 0, 48, 0, PI); c.tor('lightBlue', 0, 0.05, 0.3, 0.96, 0.02, 0, 48, 0, PI);
      c.cyl('darkMetal', 0, H - 0.6, 0, 0.05, 0.6, 8); c.cyl('white', 0, H - 0.8, 0, 0.45, 0.2, 28, 0.25); c.cyl('lightW', 0, H - 0.81, 0, 0.36, 0.01, 28);
    }
    f.light(2.6, r.H - 1.0, 3.4, 'cool', 9, 3.5);
    locker(f, hx - 0.3, 1.5, -PI / 2, 2.6, 0.92, 0.6, 'white', 4); f.box('metal', hx - 0.3, 0.92, 1.5, 0.62, 0.04, 2.62);
    f.box('white', hx - 0.2, 1.55, 1.5, 0.4, 0.75, 2.6);
    { const c = f.sub(-hx + 0.75, 0, 4.9, PI / 2);
      c.cyl('white', 0, 0, 0, 0.6, 0.3, 28); c.cyl('glass', 0, 0.3, 0, 0.5, 1.9, 28); c.cyl('liquid', 0, 0.3, 0, 0.47, 1.2, 28); c.cyl('lightBlue', 0, 0.3, 0, 0.42, 0.02, 28); c.cyl('white', 0, 2.2, 0, 0.6, 0.25, 28);
      c.block(-0.6, -0.6, 0.6, 0.6, 2.4); }
    f.light(-hx + 0.75, 1.3, 4.9, 'cyan', 4, 2.5);
    f.box('black', -hx + 0.05, 0.9, 2.5, 0.06, 1.2, 2.0); f.screen(-hx + 0.09, 1.5, 2.5, 1.8, 1.0, PI / 2, 7);
    plant(f, 1.0, 0.5, 0.9);
    ceilPanels(f, r, [[-4.5, 1.6], [-1.5, 1.6], [2.6, 1.6], [-3, 4.6], [0, 4.6]], 'cool', 7.5, 7);
  },
  gym(f, r) {
    const hx = r.L / 2 - WT, D = r.D, H = r.H;
    for (const x of [-2.6, -0.9]) { const c = f.sub(x, 0, 1.3, 0);
      c.box('black', 0, 0, 0, 0.8, 0.22, 1.9); c.box('rubber', 0, 0.22, 0.05, 0.6, 0.02, 1.6);
      for (const s of [-1, 1]) c.box('darkMetal', s * 0.36, 0.22, -0.8, 0.05, 1.1, 0.05);
      c.box('darkMetal', 0, 1.25, -0.8, 0.8, 0.06, 0.25); c.screen(0, 1.42, -0.75, 0.4, 0.25, 0, 1, -0.6); c.block(-0.4, -0.95, 0.4, 0.95, 1.3); }
    { const c = f.sub(1.5, 0, 3.0, PI / 2); c.box('fabric', 0, 0.38, 0, 0.32, 0.1, 1.3); c.box('darkMetal', 0, 0, 0, 0.1, 0.38, 1.0);
      for (const s of [-1, 1]) c.box('darkMetal', s * 0.5, 0, -0.55, 0.06, 1.3, 0.06); c.cylx('metal', 0, 1.25, -0.55, 0.02, 1.8, 8);
      for (const s of [-1, 1]) for (const d of [0.7, 0.78]) c.cylx('black', s * d, 1.25, -0.55, 0.22, 0.05, 24); c.block(-0.9, -0.8, 0.9, 0.7, 1.4); }
    { const c = f.sub(hx - 0.3, 0, 2.2, -PI / 2); c.box('darkMetal', 0, 0, 0, 1.8, 0.05, 0.5); for (const y of [0.35, 0.8]) { c.box('metal', 0, y, 0, 1.8, 0.04, 0.4);
        for (let i = 0; i < 6; i++) c.cylx('black', -0.75 + i * 0.3, y + 0.1, 0, 0.06 + i * 0.01, 0.2, 14); } c.block(-0.9, -0.3, 0.9, 0.3); }
    f.box('rubber', -1.6, 0, 4.8, 2.6, 0.03, 1.8, 0, 0, 0.005);
    f.cyl('darkMetal', 1.2, H - 0.6, 5.3, 0.02, 0.6, 6); f.cyl('red', 1.2, 0.9, 5.3, 0.2, 1.1, 16); f.block(0.95, 5.05, 1.45, 5.55, 2);
    f.quad('mirror', -hx + 0.02, 1.4, 3.8, 2.6, 1.8, PI / 2);
    ceilPanels(f, r, [[-1.5, 2.2], [1.8, 2.2], [0, 4.8]], 'cool', 10, 6.5);
  },
  wash(f, r) {
    const hx = r.L / 2 - WT;
    for (let i = 0; i < 4; i++) {
      const x = -hx + 0.65 + i * 1.3;
      f.box('white', x - 0.65, 0, 0.7, 0.05, 2.1, 1.15); f.box('floorLight', x, 0, 0.6, 1.25, 0.06, 1.0);
      f.cylz('metal', x, 2.0, 0.35, 0.09, 0.3, 14); f.box('glass', x, 0, 1.25, 1.2, 2.0, 0.03, 0, 0, 0.005);
      f.block(x - 0.62, 0.12, x + 0.62, 1.3, 2.1);
    }
    f.box('white', -hx + 0.65 + 4 * 1.3 - 0.65, 0, 0.7, 0.05, 2.1, 1.15);
    { const c = f.sub(2.6, 0, 0.4, 0); c.box('white', 0, 0, 0, 2.6, 0.85, 0.55); c.box('metal', 0, 0.85, 0, 2.7, 0.04, 0.6);
      for (const x of [-0.8, 0.8]) { c.cyl('white', x, 0.89, 0.05, 0.2, 0.08, 20); c.cyl('metal', x, 0.89, -0.2, 0.025, 0.25, 8); }
      c.quad('mirror', 0, 1.6, -0.27, 2.4, 1.0); c.box('lightW', 0, 2.15, -0.25, 2.4, 0.04, 0.04); c.block(-1.3, -0.3, 1.3, 0.3); }
    locker(f, -hx + 0.3, 4.2, PI / 2, 2.6, 2.1, 0.55, 'white');
    f.box('wood', -1.0, 0.35, 3.6, 2.4, 0.08, 0.45); f.box('darkMetal', -1.0, 0, 3.6, 2.2, 0.35, 0.3); f.block(-2.2, 3.35, 0.2, 3.85, 0.45);
    ceilPanels(f, r, [[-2.5, 0.9], [0, 0.9], [-1, 3.8], [2.4, 3.6]], 'cool', 9, 5.5);
  },
  galley(f, r) {
    const hx = r.L / 2 - WT;
    { const c = f.sub(0, 0, 0.42, 0); c.box('white', 0, 0, 0, 2 * hx, 0.88, 0.6); c.box('metal', 0, 0.88, 0, 2 * hx, 0.04, 0.64);
      c.box('black', 0.7, 0.92, 0, 0.7, 0.01, 0.5); for (const [x, z] of [[0.52, -0.1], [0.88, 0.1]]) c.cyl('darkMetal', x, 0.93, z, 0.1, 0.01, 20);
      c.box('darkMetal', -1.2, 0.86, 0, 0.6, 0.04, 0.42); c.cyl('metal', -1.2, 0.92, -0.22, 0.02, 0.3, 8);
      c.box('white', 0, 1.5, -0.12, 2 * hx, 0.7, 0.36); c.box('metal', 0.7, 1.35, 0.05, 0.9, 0.15, 0.6); c.box('lightWarm', 0, 1.47, 0.07, 2 * hx - 0.3, 0.02, 0.02);
      c.block(-hx, -0.32, hx, 0.32); }
    { const c = f.sub(-hx + 0.4, 0, 1.6, PI / 2); c.box('metal', 0, 0, 0, 0.9, 2.1, 0.75); c.box('black', 0, 1.2, 0.38, 0.02, 0.9, 0.01); c.screen(0.25, 1.6, 0.39, 0.25, 0.3, 0, 15); c.block(-0.45, -0.4, 0.45, 0.4, 2.1); }
    { const c = f.sub(0.2, 0, 3.4, 0); c.box('white', 0, 0, 0, 2.4, 0.88, 0.9); c.box('metal', 0, 0.88, 0, 2.5, 0.04, 1.0);
      for (const x of [-0.5, 0.3]) c.cyl('white', x, 0.92, 0, 0.12, 0.18, 14); c.block(-1.25, -0.5, 1.25, 0.5); }
    for (const x of [-0.6, 0.4, 1.4]) { f.cyl('metal', x, 0, 4.25, 0.03, 0.7, 8); f.cyl('fabric', x, 0.7, 4.25, 0.2, 0.06, 16); }
    ceilPanels(f, r, [[0, 1.2], [0, 3.6]], 'neutral', 11, 5.5);
  },
  lounge(f, r) {
    const hx = r.L / 2 - WT, D = r.D;
    f.box('black', -hx + 0.05, 0.6, 3.2, 0.08, 1.7, 3.0); f.screen(-hx + 0.1, 1.45, 3.2, 2.8, 1.55, PI / 2, 4);
    sofa(f, 0.5, 3.2, -PI / 2, 3.0, 'fabricBlue'); sofa(f, -0.9, 5.25, PI, 2.2, 'fabricBlue');
    table(f, -1.1, 3.4, 0, 1.0, 1.6, 0.4, 'wood');
    sofa(f, -2.6, 1.0, PI, 1.6, 'fabricLight');
    table(f, 2.6, 1.7, 0, 1.0, 1.0, 0.75, 'white', true); chair(f, 2.6, 0.9, 0, 'fabricRed'); chair(f, 2.6, 2.5, PI, 'fabricRed');
    f.box('black', 2.6, 0.75, 1.7, 0.5, 0.01, 0.5);
    plant(f, -hx + 0.4, D - 0.5, 1.3); plant(f, hx - 0.4, 0.45, 1.1); plant(f, 1.4, 5.3, 0.9);
    f.box('fabricRed', -0.9, 0, 3.4, 3.0, 0.012, 2.6, 0, 0, 0.002);
    ceilPanels(f, r, [[-2.2, 3.2], [1.8, 3.2]], 'warm', 9, 6.5);
    f.light(-hx + 0.4, 1.2, 3.2, 'blue', 3, 3);
  },
  engineering(f, r) {
    const hx = r.L / 2 - WT, D = r.D, H = r.H;
    for (const x of [-3.6, -0.9, 1.8]) { consoleUnit(f, x, 0.52, 0, 2.4, [9, 6], 'wallInd'); chair(f, x, 1.35, PI); }
    for (let i = 0; i < 4; i++) { f.cyl('yellow', -hx + 0.25, 0, 0.6 + i * 0.75, 0.12, H, 14); f.tor('darkMetal', -hx + 0.25, 1.2, 0.6 + i * 0.75, 0.13, 0.03); }
    f.block(-hx, 0.4, -hx + 0.45, 3.0, H);
    for (const z of [1.2, 1.6, 2.0]) f.cylx(z === 1.6 ? 'orange' : 'yellow', 0, H - 0.35, z, 0.1, 2 * hx, 12);
    for (let x = -hx + 1; x < hx; x += 2.2) f.box('darkMetal', x, H - 0.48, 1.6, 0.1, 0.48, 1.2);
    desk(f, 2.0, D - 0.62, PI, 2.0, 0.9, 0.92, 'darkMetal');
    for (let i = 0; i < 6; i++) f.box(pick(['red', 'yellow', 'metal']), 1.4 + rr(0, 1.2), 0.92, D - 0.62 + rr(-0.3, 0.3), rr(0.08, 0.3), rr(0.04, 0.12), rr(0.06, 0.2), rr(0, PI));
    f.box('darkMetal', 2.0, 0.95, D - 0.15, 2.0, 1.1, 0.05);
    for (let i = 0; i < 8; i++) f.box('metal', 1.2 + i * 0.22, 1.4, D - 0.19, 0.04, 0.35, 0.04);
    locker(f, hx - 0.3, 1.4, -PI / 2, 1.8, 1.9, 0.55, 'red', 3);
    { const c = f.sub(-3.8, 0, 4.4, 0); c.box('wallInd', 0, 0, 0, 2.0, 1.6, 1.2); c.box('black', 0, 0.4, 0.61, 1.6, 0.8, 0.01); c.cylx('orange', 0, 1.7, 0, 0.22, 2.2, 16);
      for (let i = 0; i < 5; i++) c.box('black', -0.8 + i * 0.4, 0.5, 0.62, 0.25, 0.6, 0.01); c.block(-1.0, -0.6, 1.0, 0.6, 1.9); }
    { const c = f.sub(-0.8, 0, 4.4, 0); c.cyl('darkMetal', 0, 0, 0, 0.6, 1.8, 20); c.tor('lightOrange', 0, 0.9, 0, 0.62, 0.03); c.cyl('yellow', 0, 1.8, 0, 0.12, H - 1.8, 12); c.block(-0.6, -0.6, 0.6, 0.6, H); }
    f.box('hazard', 0.6, 0, 4.4, 1.2, 0.012, 1.4, 0, 0, 0.002);
    ceilPanels(f, r, [[-3.5, 3.0], [0, 3.0], [3.5, 3.0]], 'orange', 13, 7);
  },
  storage(f, r) {
    const hx = r.L / 2 - WT;
    shelf(f, -hx + 0.35, 2.4, PI / 2, 3.4, 2.4, 0.6, 5, 0.85);
    shelf(f, 0.2, 0.42, 0, 2.6, 2.4, 0.6, 5, 0.85);
    shelf(f, 0.6, 3.0, PI / 2, 2.2, 1.8, 0.6, 4, 0.8);
    crate(f, hx - 0.5, 0, 1.4, [0.8, 0.7, 0.8], 'crateOr', 0.2); crate(f, hx - 0.5, 0.7, 1.4, [0.6, 0.5, 0.6], 'crateGr', -0.3, false);
    ceilPanels(f, r, [[0, 2.6]], 'neutral', 9, 5.5);
  },
  life(f, r) {
    const hx = r.L / 2 - WT, H = r.H;
    for (const x of [-5.0, -3.3, -1.6]) {
      f.cyl('metal', x, 0, 1.0, 0.72, 0.15, 24); f.cyl('crateGr', x, 0.15, 1.0, 0.68, 2.3, 24); f.sph('crateGr', x, 2.45, 1.0, 0.68, 24, 0.35);
      for (const y of [0.6, 1.5]) f.tor('darkMetal', x, y, 1.0, 0.7, 0.04);
      f.box('black', x, 1.2, 1.7, 0.4, 0.3, 0.02); f.screen(x, 1.35, 1.72, 0.32, 0.22, 0, 15);
      f.cyl('metal', x, 2.6, 1.0, 0.08, H - 2.6, 8);
      f.block(x - 0.75, 0.25, x + 0.75, 1.75, H);
    }
    f.cylx('metal', -2.5, H - 0.3, 1.0, 0.1, 9.6, 12); f.cylx('crateBl', -2.5, H - 0.55, 0.5, 0.14, 9.6, 12);
    { const c = f.sub(2.2, 0, 0.8, 0); c.box('wallInd', 0, 0, 0, 2.4, 2.1, 1.2); for (const x of [-0.6, 0.6]) { c.cylz('darkMetal', x, 1.2, 0.62, 0.45, 0.06, 28); c.tor('metal', x, 1.2, 0.64, 0.45, 0.03, 0, 32);
        for (let k = -2; k <= 2; k++) c.box('metal', x + k * 0.16, 0.78, 0.64, 0.025, 0.84, 0.02); } c.block(-1.2, -0.6, 1.2, 0.6, 2.1); }
    consoleUnit(f, 4.8, 0.52, 0, 1.4, [15]);
    { const c = f.sub(-2.5, 0, 3.6, 0); for (const x of [-1.2, 0, 1.2]) { c.cyl('crateBl', x, 0, 0, 0.35, 0.7, 20); c.cylx('metal', x, 0.45, 0.4, 0.07, 0.4, 10); } c.block(-1.6, -0.4, 1.6, 0.4, 0.8); }
    f.box('hazard', -2.5, 0, 3.6, 3.6, 0.012, 1.2, 0, 0, 0.002);
    ceilPanels(f, r, [[-4, 2.6], [-0.5, 2.6], [3.5, 2.6]], 'green', 10, 6.5);
  },
  lift(f, r) {
    const D = r.D, H = r.H, zc = D * 0.55;
    f.cyl('darkMetal', 0, 0, zc, 1.45, 0.06, 40); f.tor('lightCyan', 0, 0.07, zc, 1.38, 0.02, PI / 2, 64);
    f.cyl('glass', 0, 0.06, zc, 1.5, H - 0.1, 40, 1.5, true, PI * 0.35, PI * 1.3);
    for (let i = 0; i <= 8; i++) { const a = PI * 0.35 + (PI * 1.3) * i / 8; f.cyl('darkMetal', Math.sin(a) * 1.5, 0, zc + Math.cos(a) * 1.5, 0.04, H, 8); }
    f.tor('darkMetal', 0, H - 0.1, zc, 1.5, 0.06, PI / 2, 64); f.tor('lightCyan', 0, H - 0.2, zc, 1.3, 0.025, PI / 2, 64);
    f.box('black', 1.0, 1.1, D - 0.07, 0.35, 0.5, 0.04); f.screen(1.0, 1.35, D - 0.1, 0.28, 0.42, PI, 9);
    f.light(0, H - 0.5, zc, 'cyan', 9, 4);
  },
  sensor(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT, H = r.H;
    for (let y = 0; y < H - 0.1; y += 0.8) { f.cyl(y % 1.6 < 0.1 ? 'darkMetal' : 'metal', -0.6, y, 0, 0.85, 0.7, 24); f.tor('lightBlue', -0.6, y + 0.75, 0, 0.86, 0.03, PI / 2, 40); }
    f.block(-1.5, -0.9, 0.3, 0.9, H);
    for (const s of [-1, 1]) {
      for (let x = -hx + 0.5; x < hx - 1.6; x += 0.65) { f.box('black', x, 0, s * (lim - 0.4), 0.6, 2.1, 0.7); f.screen(x, 1.05, s * (lim - 0.77), 0.5, 1.9, s > 0 ? PI : 0, 13); }
      f.block(-hx, s > 0 ? lim - 0.8 : -lim, hx - 1.5, s > 0 ? lim : -lim + 0.8, 2.1);
      consoleUnit(f, 2.4, s * 3.2, s > 0 ? PI : 0, 1.8, [0, 1]);
      chair(f, 2.4, s * 2.4, s > 0 ? 0 : PI);
    }
    ceilPanels(f, r, [[-2.5, -3], [-2.5, 3], [2, -3], [2, 3]], 'blue', 8, 6);
  },
  ops(f, r) {
    const lim = r.lim - WT, H = r.H;
    f.cyl('darkMetal', 0, 0, 0, 1.3, 0.85, 8); f.cyl('metal', 0, 0.85, 0, 1.75, 0.1, 8); f.cyl('lightCyan', 0, 0.95, 0, 1.6, 0.012, 8);
    f.block(-1.75, -1.75, 1.75, 1.75);
    holoShip(f, 0, 1.75, 0, 0.032);
    for (const deg of [50, 90, 130, -50, -90, -130]) {
      const a = deg * PI / 180, Rr = 4.4, x = Math.cos(a) * Rr * 1.05, z = Math.sin(a) * Rr;
      const ry = Math.atan2(-Math.cos(a), -Math.sin(a));
      consoleUnit(f, x, z, ry, 1.6, [pick([0, 1, 2, 5, 9])]);
      chair(f, x - Math.cos(a) * 0.85, z - Math.sin(a) * 0.85, ry + PI);
    }
    for (const s of [-1, 1]) { f.box('black', 0, 1.1, s * (lim - 0.05), 5.0, 1.8, 0.08); f.screen(0, 2.0, s * (lim - 0.1), 4.8, 1.6, s > 0 ? PI : 0, s > 0 ? 3 : 5); }
    f.tor('lightBlue', 0, H - 0.05, 0, 2.2, 0.04, PI / 2, 64);
    ceilPanels(f, r, [[-3.5, -3.6], [-3.5, 3.6], [3.5, -3.6], [3.5, 3.6]], 'blue', 9, 6.5);
    f.light(0, H - 0.4, 0, 'cyan', 7, 5);
  },
  hydro(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT;
    for (const zc of [-2.6, 2.6, -5.6, 5.6]) {
      if (Math.abs(zc) + 0.55 > lim) continue;
      const x0 = -hx + 1.6, x1 = hx - 1.0, w = x1 - x0, xm = (x0 + x1) / 2;
      for (const x of [x0, xm, x1]) for (const s of [-1, 1]) f.box('darkMetal', x, 0, zc + s * 0.45, 0.06, 2.6, 0.06);
      for (const y of [0.35, 1.15, 1.95]) {
        f.box('metal', xm, y, zc, w, 0.05, 1.0); f.box('soil', xm, y + 0.05, zc, w - 0.1, 0.1, 0.9);
        for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.22) for (const dz of [-0.25, 0.05, 0.3]) {
          const hgt = rr(0.15, 0.4); f.sph(pick(['leaf', 'M_Plant_Leaf2']), x + rr(-0.05, 0.05), y + 0.15 + hgt * 0.4, zc + dz + rr(-0.05, 0.05), rr(0.07, 0.12), 6, hgt * 6);
        }
        f.box('lightPurple', xm, y + 0.72, zc, w - 0.2, 0.025, 0.12);
      }
      f.block(x0 - 0.1, zc - 0.55, x1 + 0.1, zc + 0.55, 2.6);
    }
    for (const s of [-1, 1]) { f.cyl('glass', -hx + 0.65, 0, s * 1.2, 0.5, 2.4, 24); f.cyl('liquid', -hx + 0.65, 0, s * 1.2, 0.46, 1.6, 24); f.cyl('darkMetal', -hx + 0.65, 2.4, s * 1.2, 0.52, 0.15, 24); f.block(-hx, s * 1.2 - 0.55, -hx + 1.2, s * 1.2 + 0.55, 2.5); }
    ceilPanels(f, r, [[-2, -4.1], [-2, 4.1], [2.5, -4.1], [2.5, 4.1], [0, 0]], 'purple', 9, 6.5);
  },
  mess(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT, H = r.H;
    for (const x of [-2.6, 0.9, 4.3]) for (const s of [-1, 1]) {
      const z = s * 3.6;
      table(f, x, z, 0, 2.2, 0.95, 0.75, 'white');
      for (const dz of [-0.82, 0.82]) { f.box('fabricBlue', x, 0.0, z + dz, 2.0, 0.45, 0.42, 0, 0, 0.05); f.block(x - 1.0, z + dz - 0.22, x + 1.0, z + dz + 0.22, 0.45); }
      f.cyl('lightWarm', x, H - 0.6, z, 0.25, 0.08, 20, 0.12); f.cyl('darkMetal', x, H - 0.52, z, 0.01, 0.52, 4);
    }
    { const c = f.sub(-3.0, 0, lim - 0.4, PI); c.box('white', 0, 0, 0, 4.0, 0.95, 0.75); c.box('metal', 0, 0.95, 0, 4.1, 0.04, 0.8);
      c.box('glass', 0, 0.99, -0.1, 3.6, 0.35, 0.4); c.box('lightWarm', 0, 1.0, -0.1, 3.4, 0.02, 0.3); c.block(-2, -0.4, 2, 0.4);
      for (let i = 0; i < 4; i++) c.cyl('metal', -1.4 + i * 0.95, 0.99, 0.0, 0.18, 0.12, 20); }
    for (const s of [-1, 1]) { f.box('black', -5.0, 0.95, s * (lim - 0.05), 1.6, 0.95, 0.06); f.screen(-5.0, 1.42, s * (lim - 0.09), 1.5, 0.85, s > 0 ? PI : 0, s > 0 ? 14 : 4); }
    for (const [x, z] of [[-hx + 0.45, -lim + 0.45], [hx - 0.45, -lim + 0.45], [hx - 0.45, lim - 0.45]]) plant(f, x, z, 1.3);
    ceilPanels(f, r, [[-2.6, -3.6], [0.9, -3.6], [4.3, -3.6], [-2.6, 3.6], [0.9, 3.6], [4.3, 3.6], [1, 0]], 'warm', 8, 6, null, [0.8, 0.8]);
  },
  observe(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT;
    for (const s of [-1, 1]) for (const x of [-2.6, 1.0]) { sofa(f, x, s * (lim - 2.3), s > 0 ? 0 : PI, 2.4, 'fabricLight'); table(f, x, s * (lim - 1.1), 0, 1.6, 0.6, 0.4, 'wood'); }
    { const c = f.sub(hx - 0.6, 0, 0, -PI / 2); c.box('wood', 0, 0, 0, 3.6, 1.05, 0.6); c.box('black', 0, 1.05, 0, 3.7, 0.04, 0.7); c.box('lightWarm', 0, 0.08, 0.31, 3.4, 0.03, 0.01);
      c.box('darkMetal', 0, 1.4, -0.45, 3.4, 0.04, 0.3); for (let i = 0; i < 10; i++) c.cyl(pick(['glass', 'crateGr', 'crateOr']), -1.5 + i * 0.33, 1.44, -0.45, 0.05, 0.28, 10); c.block(-1.8, -0.35, 1.8, 0.35, 1.1); }
    for (const z of [-1.2, 0, 1.2]) { f.cyl('metal', hx - 1.6, 0, z, 0.04, 0.75, 8); f.cyl('fabricRed', hx - 1.6, 0.75, z, 0.2, 0.08, 16); }
    for (const [x, z] of [[-hx + 0.45, lim - 0.45], [-hx + 0.45, -lim + 0.45], [hx - 0.45, lim - 0.45], [hx - 0.45, -lim + 0.45]]) plant(f, x, z, 1.4);
    ceilPanels(f, r, [[-3, 0], [1.5, 0], [-0.8, -3.5], [-0.8, 3.5]], 'warm', 7, 6.5, null, [0.9, 0.9]);
  },
  engine(f, r) {
    const hx = r.L / 2 - WT, H = r.H;
    for (const s of [-1, 1]) {
      const z = s * 3.0, x0 = -hx + 0.3, x1 = 3.0, xm = (x0 + x1) / 2, len = x1 - x0;
      f.cylx('darkMetal', xm, 1.5, z, 1.15, len, 28);
      for (let x = x0 + 0.4; x < x1; x += 1.2) f.cylx('metal', x, 1.5, z, 1.25, 0.18, 28);
      f.cylx('lightOrange', xm, 1.5, z, 1.17, 0.6, 28);
      f.cylx('wallInd', x1 + 0.3, 1.5, z, 0.8, 0.6, 20);
      for (const x of [x0 + 0.8, xm, x1 - 0.8]) f.box('wallInd', x, 0, z, 0.5, 0.5, 1.6);
      for (const x of [x0 + 1.4, x1 - 1.6]) f.cyl('yellow', x, 2.6, z, 0.16, H - 2.6, 12);
      f.cylx('orange', xm, H - 0.3, s * 1.9, 0.12, len, 12);
      f.block(x0, z - 1.3, x1 + 0.6, z + 1.3, H);
      for (let x = -4.5; x <= 2.5; x += 1.0) f.box('yellow', x, 0, s * 1.55, 0.05, 1.05, 0.05);
      f.box('yellow', -1.0, 1.0, s * 1.55, 7.2, 0.05, 0.06); f.box('yellow', -1.0, 0.55, s * 1.55, 7.2, 0.04, 0.05);
      consoleUnit(f, 4.6, s * 3.2, -PI / 2, 1.8, [9, 6]);
    }
    f.box('hazard', -1.0, 0, 0, 7.2, 0.012, 0.2, 0, 0, 0.002);
    ceilPanels(f, r, [[-3, 0], [1.5, 0], [-1, -3], [-1, 3]], 'orange', 13, 7, null, [1.4, 0.3]);
  },
  reactor(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT, H = r.H;
    f.cyl('darkMetal', 0, 0, 0, 2.1, 0.35, 40); f.cyl('metal', 0, 0.35, 0, 1.55, 0.3, 40);
    f.add('hazard', new THREE.RingGeometry(2.15, 2.6, 64).rotateX(-PI / 2).translate(0, 0.012, 0));
    f.cyl('glass', 0, 0.65, 0, 1.0, H - 1.25, 40);
    f.cyl('darkMetal', 0, H - 0.6, 0, 1.6, 0.6, 40, 1.9);
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; f.cyl('metal', Math.cos(a) * 1.3, 0.65, Math.sin(a) * 1.3, 0.09, H - 1.25, 12); }
    f.cyl('core', 0, 0.68, 0, 0.42, H - 1.35, 32);
    for (let i = 0; i < 3; i++) f.tor('lightCyan', 0, 0.9 + i * (H - 1.8) / 2, 0, 0.7, 0.035, PI / 2, 48);
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; f.cyl('yellow', Math.cos(a) * 2.9, 0, Math.sin(a) * 2.9, 0.04, 1.05, 8); }
    for (const y of [0.55, 1.05]) f.tor('yellow', 0, y, 0, 2.9, 0.035, PI / 2, 64);
    f.block(-3.0, -3.0, 3.0, 3.0, 1.1);
    for (const [x, z] of [[-3.8, 4.8], [3.8, 4.8], [-3.8, -4.8], [3.8, -4.8]]) consoleUnit(f, x, z, z > 0 ? PI : 0, 1.6, [6, 9], 'wallInd');
    for (const [x, z] of [[-hx + 0.6, lim - 0.6], [-hx + 0.6, -lim + 0.6], [hx - 0.6, lim - 0.6], [hx - 0.6, -lim + 0.6]]) {
      crate(f, x, 0, z, [1.0, 0.9, 1.0], pick(['crateOr', 'crate'])); crate(f, x, 0.9, z, [0.8, 0.6, 0.8], 'crateGr', 0.3, false);
    }
    for (const s of [-1, 1]) { f.box('black', 0, 1.0, s * (lim - 0.05), 1.4, 1.0, 0.05); f.screen(0, 1.5, s * (lim - 0.09), 1.3, 0.9, s > 0 ? PI : 0, 12); }
    f.light(0, 1.2, 0, 'blue', 20, 7.5); f.light(0, H - 1.0, 0, 'blue', 14, 7);
    ceilPanels(f, r, [[-4.5, -3.5], [-4.5, 3.5], [4.5, -3.5], [4.5, 3.5]], 'neutral', 7, 6);
  },
  cargo(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT, H = r.H;
    for (const s of [-1, 1]) f.box('yellow', 0, 0, s * 2.1, 2 * hx - 1.0, 0.01, 0.12, 0, 0, 0.002);
    for (let x = -hx + 2; x < hx - 1; x += 3) f.box('yellow', x, 0, 0, 0.6, 0.01, 0.12, 0, 0, 0.002);
    const cols = ['crateOr', 'crateGr', 'crateBl', 'crate', 'crateTeal'];
    for (const s of [-1, 1]) {
      const zc = s * (lim - 1.35);
      for (const x of [-11.4, -5.0, 1.4]) container(f, x, zc, 0, 6.0, 2.4, 2.6, pick(cols));
      for (let x = 5.2; x < hx - 0.8; x += 1.4) { const n = 1 + (rand() * 3 | 0); for (let k = 0; k < n; k++) crate(f, x, k * 1.0, zc + rr(-0.3, 0.3), [1.2, 1.0, 1.2], pick(cols), rr(-0.1, 0.1), k === 0); }
      for (const x of [-8.2, -1.8]) { f.box('darkMetal', x, 0, s * 3.1, 1.2, 0.14, 1.0); crate(f, x, 0.14, s * 3.1, [0.9, 0.7, 0.8], pick(cols), 0, false); f.block(x - 0.6, s * 3.1 - 0.5, x + 0.6, s * 3.1 + 0.5, 0.85); }
      f.box('darkMetal', 0, H - 0.35, s * 2.8, 2 * hx, 0.2, 0.25);
    }
    { const c = f.sub(3.2, H - 0.6, 0, 0); c.box('yellow', 0, 0, 0, 0.5, 0.35, 5.8); c.box('darkMetal', 0, -0.4, 0.6, 0.6, 0.4, 0.6); c.cyl('metal', 0, -1.6, 0.6, 0.015, 1.2, 4); c.tor('darkMetal', 0, -1.65, 0.6, 0.08, 0.02, 0); }
    { const c = f.sub(11.0, 0, -3.0, 0.6);
      for (const s of [-1, 1]) { c.cyl('darkMetal', s * 0.4, 0, 0, 0.14, 0.9, 12); c.box('darkMetal', s * 0.4, 0, 0.15, 0.3, 0.12, 0.6); }
      c.box('yellow', 0, 0.9, 0, 1.3, 1.1, 1.0); c.box('glass', 0, 1.3, 0.48, 0.9, 0.6, 0.06); c.box('black', 0, 2.0, 0, 1.2, 0.08, 0.9);
      for (const s of [-1, 1]) { c.box('darkMetal', s * 0.8, 1.2, 0.3, 0.2, 0.2, 1.0); c.box('metal', s * 0.8, 0.9, 0.9, 0.12, 0.4, 0.12); c.box('metal', s * 0.8, 0.85, 1.25, 0.1, 0.06, 0.7); }
      c.block(-0.9, -0.6, 0.9, 1.6, 2.1); }
    for (const s of [-1, 1]) { f.box('black', hx - 0.06, 0.9, s * 1.3, 0.06, 0.9, 1.3); f.screen(hx - 0.1, 1.35, s * 1.3, 1.2, 0.8, -PI / 2, 10); }
    f.box('hazard', hx - 1.0, 0, 0, 1.4, 0.012, 2.4, 0, 0, 0.002);
    // аппарель трюма (в полу)
    f.box('darkMetal', 10, 0, 0, 9, 0.015, 4.8, 0, 0, 0.003); for (const s of [-1, 1]) f.box('hazard', 10, 0, s * 2.5, 9, 0.016, 0.16, 0, 0, 0.002);
    for (let x = -12; x <= 12; x += 6) for (const z of [0, -4.2, 4.2]) {
      if (z === 0) lightPanel(f, x, H, z, 2.0, 0.3, 'neutral', 14, 9); else lightPanel(f, x, H, z, 2.0, 0.3, 'neutral', 0, 0);
    }
  },
  airlock(f, r) {
    const hx = r.L / 2 - WT, lim = r.lim - WT, H = r.H;
    { const c = f.sub(hx - 0.06, 0, 0, -PI / 2);
      c.add('darkMetal', new THREE.CylinderGeometry(1.4, 1.4, 0.3, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 1.5, 0));
      c.add('hazard', new THREE.CylinderGeometry(1.15, 1.15, 0.34, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 1.5, 0));
      c.add('metal', new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8).rotateX(PI / 2).rotateZ(PI / 8).translate(0, 1.5, 0));
      for (const s of [-1, 1]) c.box('lightRed', s * 1.7, 1.0, 0.05, 0.08, 1.0, 0.04);
      c.screen(1.9, 1.4, 0.06, 0.45, 0.45, 0, 12); }
    f.box('hazard', hx - 1.0, 0, 0, 1.6, 0.012, 3.2, 0, 0, 0.002);
    { const c = f.sub(0.8, 0, 0, 0); for (const s of [-1, 1]) c.box('darkMetal', 0, 0, s * 1.6, 0.3, H - 0.4, 0.3); c.box('darkMetal', 0, H - 0.4, 0, 0.3, 0.3, 3.5); c.box('lightBlue', -0.16, H - 0.36, 0, 0.02, 0.05, 3.0);
      for (const s of [-1, 1]) c.box('lightBlue', -0.16, 0.3, s * 1.45, 0.02, H - 0.8, 0.04); c.block(-0.2, 1.4, 0.2, 1.8, H); c.block(-0.2, -1.8, 0.2, -1.4, H); }
    for (const s of [-1, 1]) {
      for (const x of [-3.2, -1.9]) { suit(f, x, s * (lim - 0.55), s > 0 ? PI : 0); f.box('darkMetal', x, 0, s * (lim - 0.12), 1.1, 2.4, 0.1); }
      f.block(-3.9, s > 0 ? lim - 1.0 : -lim, -1.2, s > 0 ? lim : -lim + 1.0, 2);
      f.box('fabric', 2.6, 0, s * (lim - 0.35), 2.4, 0.42, 0.45); f.block(1.4, s > 0 ? lim - 0.6 : -lim, 3.8, s > 0 ? lim : -lim + 0.6, 0.45);
    }
    crate(f, hx - 1.2, 0, lim - 1.0, [0.8, 0.6, 1.2], 'crateOr');
    ceilPanels(f, r, [[-2.6, 0], [2.4, 0]], 'neutral', 10, 6.5);
    f.light(hx - 0.8, 2.6, 0, 'red', 6, 3.5);
  },
};

function buildBridge(r) {
  const D = DECKS[0], f = r.fd;
  const outline = [[25.5, -8.0], [31, -8.0], [36, -7.5], [40.5, -6.5], [43.2, -5.4], [43.2, 5.4], [40.5, 6.5], [36, 7.5], [31, 8.0], [25.5, 8.0]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const top = new THREE.ShapeGeometry(shape); top.rotateX(-PI / 2); f.add('floor', top);
  const bot = new THREE.ShapeGeometry(shape); bot.rotateX(PI / 2); bot.translate(0, -0.32, 0); f.add('darkMetal', bot);
  r.f.ctx.colliders.push({ min: V(25.5, D.floor - 0.3, -8), max: V(43.2, D.floor, 8), kind: 'floor' });
  for (let i = 0; i < outline.length - 1; i++) {
    const [x0, z0] = outline[i], [x1, z1] = outline[i + 1];
    if (Math.abs(x0 - 25.5) < 0.01 && Math.abs(x1 - 25.5) < 0.01) continue;
    const m = f.sub((x0 + x1) / 2, 0, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
    const len = Math.hypot(x1 - x0, z1 - z0);
    m.box('darkMetal', 0, 0, 0, len, 0.55, 0.25); m.box('lightCyan', 0, 0.56, 0, len, 0.012, 0.04, 0, 0, 0.003);
  }
  for (const s of [-1, 1]) f.slab('wall', 25.44, 0, s * 7.2, 0.12, 3.2, 1.65);
  f.slab('wall', 25.44, 3.2, 0, 0.12, 1.0, 16.6);
  f.box('darkMetal', 30.2, 0, 0, 5.2, 0.28, 5.0); f.box('lightBlue', 30.2, 0.28, 2.5, 5.2, 0.012, 0.03); f.box('lightBlue', 30.2, 0.28, -2.5, 5.2, 0.012, 0.03);
  bigChair(f.sub(0, 0.28, 0), 30.2, 0, PI / 2, 'fabric');
  for (const s of [-1, 1]) { const c = f.sub(30.9, 0.28, s * 1.0, -PI / 2); c.box('darkMetal', 0, 0, 0, 0.5, 0.75, 0.5); c.screen(0, 0.9, 0.0, 0.42, 0.3, 0, 2, -1.0); }
  f.cyl('darkMetal', 34.8, 0, 0, 0.7, 0.9, 28); f.cyl('metal', 34.8, 0.9, 0, 1.0, 0.08, 32); f.cyl('lightCyan', 34.8, 0.98, 0, 0.9, 0.01, 32);
  f.block(33.8, -1.0, 35.8, 1.0);
  holoOrb(f, 34.8, 1.75, 0, 0.5);
  for (const s of [-1, 1]) {
    bigChair(f, 39.6, s * 1.6, PI / 2);
    const c = f.sub(41.3, 0, s * 1.6, -PI / 2);
    c.box('darkMetal', 0, 0, -0.1, 2.4, 0.62, 0.7); c.box('metal', 0, 0.62, -0.05, 2.5, 0.05, 0.8);
    const p = c.sub(0, 0.68, -0.1, 0, -0.9); p.box('black', 0, 0, 0, 2.2, 0.5, 0.04); p.screen(-0.55, 0.25, 0.025, 1.0, 0.42, 0, 5); p.screen(0.55, 0.25, 0.025, 1.0, 0.42, 0, 0);
    c.box('black', 0, 0.64, 0.15, 0.3, 0.25, 0.08); c.cyl('darkMetal', 0.6, 0.67, 0.15, 0.05, 0.22, 10);
    c.block(-1.25, -0.5, 1.25, 0.4);
    for (const x of [31.5, 34.5]) { consoleUnit(f, x, s * 6.0, s > 0 ? PI : 0, 2.2, [pick([0, 1, 9]), pick([2, 3, 4])]); chair(f, x, s * 5.2, s > 0 ? 0 : PI); }
    consoleUnit(f, 37.8, s * 5.3, s > 0 ? PI + 0.35 : -0.35, 1.8, [8, 5]);
  }
  for (const [x, z] of [[28, -4], [28, 4], [33, -4], [33, 4], [38, 0]]) f.light(x, 2.6, z, 'blue', 9, 6.5);
  f.light(41.5, 1.2, 0, 'cyan', 6, 4);
}
