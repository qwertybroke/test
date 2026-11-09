# Внешние агрегаты: двигательные гондолы (цельная оболочка со швами), пилоны, маршевые двигатели,
# антенны и сенсоры хребта, РСУ, навигационные огни, светящиеся полосы, надписи (декали).
import math
from . import layout as L
from .geo import MB, box, boxc, bbox, cyl, beam, tube

POD_X, POD_Z = 15.3, -0.9
GW, GD = 0.04, 0.035


# ------------------------------------------------------------------ лофт гондолы
def _oct(a, b, c, ch=0.06):
    """Восьмигранное сечение с фасками ch на всех рёбрах и тройками линий швов посередине боков и верха.
    Возвращает [(x, z, tag)], tag = 'g' для средней линии шва."""
    corners = [(a - c, -b), (a, -b + c), (a, b - c), (a - c, b), (-a + c, b), (-a, b - c), (-a, -b + c), (-a + c, -b)]
    out = [(0.0, -b, "")]
    n = len(corners)
    for i in range(n):
        p = corners[i]
        prv = corners[i - 1] if i > 0 else (0.0, -b)
        nxt = corners[(i + 1) % n]
        for q, s in ((prv, ch), (nxt, ch)):
            dx, dz = q[0] - p[0], q[1] - p[1]
            l = math.hypot(dx, dz) or 1
            out.append((p[0] + dx / l * s, p[1] + dz / l * s, ""))
        # швы на середине правого бока (i=1), верха (i=3) и левого бока (i=5)
        if i in (1, 3, 5):
            m = ((p[0] + nxt[0]) / 2, (p[1] + nxt[1]) / 2)
            dx, dz = nxt[0] - p[0], nxt[1] - p[1]
            l = math.hypot(dx, dz) or 1
            out.append((m[0] - dx / l * GW, m[1] - dz / l * GW, ""))
            out.append((m[0], m[1], "g"))
            out.append((m[0] + dx / l * GW, m[1] + dz / l * GW, ""))
    # точки у угла с индексом 1 вставлены после угла 1 — порядок обхода сохраняется (против часовой при взгляде с +y)
    return out


def pod(mb, side):
    cx = POD_X * side
    # (y, полуширина, полувысота, срез угла)
    st = [(3.2, 1.7, 1.6, 0.6), (4.0, 2.5, 2.3, 0.9), (5.6, 3.0, 2.8, 1.1), (7.0, 3.1, 2.9, 1.15),
          (44.0, 3.1, 2.9, 1.15), (47.5, 2.9, 2.7, 1.1), (50.0, 2.5, 2.3, 0.95)]
    seams = [10.0, 15.5, 21.0, 27.0, 33.0, 38.5, 44.6]
    ys = sorted(set([s[0] for s in st] + [y + d for y in seams for d in (-GW, 0, GW)] +
                    [9.0, 12.0, 18.0, 24.0, 30.0, 36.0, 41.0]))

    def at(y):
        for a, b in zip(st, st[1:]):
            if a[0] <= y <= b[0]:
                t = (y - a[0]) / (b[0] - a[0])
                return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, 4))
        return st[-1][1:]

    rings = []
    tags = None
    for y in ys:
        a, b, c = at(y)
        prof = _oct(a, b, c)
        tags = [t for _, _, t in prof]
        seam = any(abs(y - s) < 1e-6 for s in seams)
        ring = []
        n = len(prof)
        for k, (x, z, t) in enumerate(prof):
            d = 0.0
            if t == "g" or seam:
                d = GD
            if d:
                # вдоль нормали сечения
                px, pz = prof[k - 1][0], prof[k - 1][1]
                qx, qz = prof[(k + 1) % n][0], prof[(k + 1) % n][1]
                tx, tz = qx - px, qz - pz
                l = math.hypot(tx, tz) or 1
                x, z = x - tz / l * d, z + tx / l * d
            ring.append(mb.vert((cx + x * side, y, POD_Z + z)))
        rings.append(ring)
    n = len(tags)
    rnd = [0.37]

    def mat(y, z):
        if z < POD_Z - 0.9:
            return "M_Hull_Dark"
        if y < 7.0 or y > 46.0:
            return "M_Hull_Dark"
        if 21.0 < y < 27.0 and z < POD_Z + 0.4:
            return "M_Hull_Dark"
        return "M_Hull_Light"

    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n):
            k1 = (k + 1) % n
            pa = mb.v[a[k]]
            pb = mb.v[b[k1]]
            m = mat((pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2)
            q = [a[k], a[k1], b[k1], b[k]]
            mb.face(q if side < 0 else q[::-1], m)
    # тёмные световые полосы-щели и огни на боках
    # передний торец: светящееся кольцо воздухозаборника и тёмный конус
    front = rings[0]
    pts = [mb.v[i] for i in front]
    y0 = pts[0][1]
    ring_in = [mb.vert((cx + (p[0] - cx) * 0.82, y0 - 0.05, POD_Z + (p[2] - POD_Z) * 0.82)) for p in pts]
    ring_in2 = [mb.vert((cx + (p[0] - cx) * 0.66, y0 + 0.35, POD_Z + (p[2] - POD_Z) * 0.66)) for p in pts]
    tip = mb.vert((cx, y0 - 0.7, POD_Z))
    for k in range(n):
        k1 = (k + 1) % n
        q1 = [front[k], ring_in[k], ring_in[k1], front[k1]]
        q2 = [ring_in[k], ring_in2[k], ring_in2[k1], ring_in[k1]]
        q3 = [ring_in2[k], tip, ring_in2[k1]]
        for q, m in ((q1, "M_Hull_Dark"), (q2, "M_Intake_Glow"), (q3, "M_Metal_Dark")):
            mb.face(q if side < 0 else q[::-1], m)
    # задний торец + сопло
    back = rings[-1]
    pts = [mb.v[i] for i in back]
    y1 = pts[0][1]
    c = mb.vert((cx, y1 + 0.2, POD_Z))
    for k in range(n):
        k1 = (k + 1) % n
        q = [back[k1], c, back[k]]
        mb.face(q if side < 0 else q[::-1], "M_Metal_Dark")
    nozzle(mb, cx, y1 + 0.15, POD_Z, 1.75, 2.4)
    # тёмные проёмы с огнями по борту гондолы (как на референсе)
    xs = cx + 3.1 * side
    for y0_, y1_ in ((9.0, 12.0), (12.6, 15.0), (16.2, 20.4), (28.0, 32.4), (34.0, 38.0)):
        x0, x1 = sorted((xs, xs + 0.012 * side))
        box(mb, x0, y0_, POD_Z - 0.45, x1, y1_, POD_Z - 0.33, "M_Strip_Ext")


def nozzle(mb, cx, y, cz, r, ln, seg=24):
    """Сопло: раструб, рёбра, светящийся диск и ядро."""
    cyl(mb, cx, y, cz, r * 0.82, ln * 0.35, "M_Engine", axis="y", seg=seg, cap=False)
    cyl(mb, cx, y + ln * 0.35, cz, r * 0.82, ln * 0.65, "M_Engine", axis="y", seg=seg, cap=False, r2=r)
    cyl(mb, cx, y + ln - 0.05, cz, r, 0.08, "M_Metal_Dark", axis="y", seg=seg, cap=False, r2=r * 1.02)
    # внутренняя стенка (видна с кормы)
    cyl(mb, cx, y + ln + 0.03, cz, r * 0.97, -ln * 0.9, "M_Metal_Dark", axis="y", seg=seg, cap=False, r2=r * 0.7)
    cyl(mb, cx, y + ln * 0.15, cz, r * 0.74, 0.05, "M_Engine_Glow", axis="y", seg=seg)
    cyl(mb, cx, y + ln * 0.18, cz, r * 0.3, 0.25, "M_Engine_Core", axis="y", seg=seg)
    for k in range(12):
        a = 2 * math.pi * k / 12
        p0 = (cx + math.cos(a) * r * 0.84, y + ln * 0.36, cz + math.sin(a) * r * 0.84)
        p1 = (cx + math.cos(a) * r * 1.02, y + ln * 0.98, cz + math.sin(a) * r * 1.02)
        beam(mb, p0, p1, 0.12, 0.08, "M_Metal_Dark")


def pylons(mb):
    for side in (1, -1):
        for y0, y1 in ((13.0, 21.0), (29.0, 38.0)):
            xa, xb = sorted((10.7 * side, 12.4 * side))
            bbox(mb, xa, y0, POD_Z - 0.9, xb, y1, POD_Z + 0.7, "M_Hull_Dark", c=0.08)
            xa, xb = sorted((10.9 * side, 12.3 * side))
            bbox(mb, xa, y0 + 0.6, POD_Z + 0.7, xb, y1 - 0.6, POD_Z + 1.0, "M_Metal_Dark", c=0.04)


def main_engines(mb, stern_y, stern_z):
    nozzle(mb, 0, stern_y, stern_z + 0.6, 2.7, 3.2, seg=32)
    for s in (1, -1):
        nozzle(mb, 6.0 * s, stern_y, stern_z - 2.6, 1.7, 2.6)
        nozzle(mb, 6.2 * s, stern_y, stern_z + 3.6, 1.1, 1.8)
    # силовая рама на кормовом торце
    box(mb, -0.25, stern_y - 0.1, stern_z - 5.5, 0.25, stern_y + 0.5, stern_z - 2.2, "M_Metal_Dark")


# ------------------------------------------------------------------ хребет и верх
def topside(mb, H):
    zt = L.MID["zT"]
    zs = zt + L.SPINE_H
    # антенные мачты: пара в корме, одиночная у середины, кластер ближе к носу (как на референсе)
    for x, y, h in ((1.6, 24.0, 6.5), (-1.0, 25.2, 5.2), (2.2, 8.0, 7.5), (-2.8, -14.0, 4.2), (-2.0, -15.4, 5.6)):
        mast(mb, x, y, zs, h)
    # сенсорные купола
    for x, y, r in ((-3.0, 2.0, 0.7), (3.4, -8.0, 0.55), (0.0, 30.0, 0.9)):
        cyl(mb, x, y, zs, r * 1.1, 0.25, "M_Metal_Dark", seg=20)
        dome(mb, x, y, zs + 0.25, r)
    # блоки оборудования и радиаторные решётки (на хребте)
    for y0, y1, x0, x1 in ((-18.0, -12.5, -4.2, -1.0), (-6.0, -1.0, 1.0, 4.2), (12.0, 20.0, -4.2, -1.4), (14.0, 18.5, 1.4, 4.2)):
        bbox(mb, x0, y0, zs, x1, y1, zs + 0.35, "M_Hull_Mid", c=0.06)
        for k in range(int((y1 - y0 - 0.6) / 0.35)):
            yy = y0 + 0.4 + k * 0.35
            box(mb, x0 + 0.25, yy, zs + 0.35, x1 - 0.25, yy + 0.12, zs + 0.42, "M_Metal_Dark")
    # «козырёк» над носовым холлом: технический модуль со светящейся полосой (верх перед хребтом)
    bbox(mb, -3.6, -29.5, zt, 3.6, -25.0, zt + 0.9, "M_Hull_Light", c=0.12)
    box(mb, -3.0, -29.56, zt + 0.42, 3.0, -29.5, zt + 0.58, "M_Strip_Ext")
    bbox(mb, -2.4, -28.9, zt + 0.9, 2.4, -25.6, zt + 1.15, "M_Metal_Dark", c=0.05)
    # люки на верхней палубе
    for x, y in ((-6.6, -6.0), (6.6, 6.0), (-6.6, 38.0), (6.6, 38.0)):
        bbox(mb, x - 0.7, y - 0.7, zt - 0.02, x + 0.7, y + 0.7, zt + 0.06, "M_Hull_Mid", c=0.03)
        box(mb, x - 0.08, y - 0.5, zt + 0.06, x + 0.08, y + 0.5, zt + 0.1, "M_Hazard")
    # кормовой блок: вентиляционные решётки радиаторов реактора
    for s in (1, -1):
        x0, x1 = sorted((2.2 * s, 6.6 * s))
        bbox(mb, x0, 36.0, zt, x1, 43.5, zt + 0.5, "M_Hull_Dark", c=0.08)
        for k in range(18):
            yy = 36.4 + k * 0.38
            box(mb, x0 + 0.3, yy, zt + 0.5, x1 - 0.3, yy + 0.14, zt + 0.58, "M_Greeble")
    # РСУ — блоки маневровых двигателей по углам
    for x, y, z in ((10.4, -27.0, 6.6), (-10.4, -27.0, 6.6), (10.4, 43.0, 6.6), (-10.4, 43.0, 6.6),
                    (9.3, -27.0, -5.6), (-9.3, -27.0, -5.6), (9.3, 43.0, -5.6), (-9.3, 43.0, -5.6)):
        rcs(mb, x, y, z)


def mast(mb, x, y, z0, h):
    cyl(mb, x, y, z0, 0.32, 0.4, "M_Metal_Dark", seg=10)
    cyl(mb, x, y, z0 + 0.4, 0.11, h * 0.55, "M_Metal_Brushed", seg=8)
    cyl(mb, x, y, z0 + 0.4 + h * 0.55, 0.06, h * 0.45, "M_Metal_Brushed", seg=6)
    for k, w in ((0.35, 0.9), (0.62, 0.6)):
        zz = z0 + h * k
        box(mb, x - w / 2, y - 0.03, zz, x + w / 2, y + 0.03, zz + 0.06, "M_Metal_Dark")
    cyl(mb, x, y, z0 + 0.4 + h, 0.09, 0.14, "M_Nav_Red", seg=8)


def dome(mb, cx, cy, cz, r, seg=20, rings=6):
    prev = None
    for i in range(rings + 1):
        a = (math.pi / 2) * i / rings
        rr, zz = r * math.cos(a), cz + r * math.sin(a)
        if i == rings:
            top = mb.vert((cx, cy, zz))
            for k in range(seg):
                mb.face([prev[k], prev[(k + 1) % seg], top], "M_Plastic_White")
            break
        cur = mb.verts([(cx + rr * math.cos(2 * math.pi * k / seg), cy + rr * math.sin(2 * math.pi * k / seg), zz) for k in range(seg)])
        if prev:
            for k in range(seg):
                mb.face([prev[k], prev[(k + 1) % seg], cur[(k + 1) % seg], cur[k]], "M_Plastic_White")
        prev = cur


def rcs(mb, x, y, z):
    s = 1 if x > 0 else -1
    bbox(mb, x - 0.6, y - 0.6, z - 0.35, x + 0.6, y + 0.6, z + 0.35, "M_Metal_Dark", c=0.08)
    for dx, dy in ((0.55, 0), (0, 0.55), (0, -0.55)):
        if dx:
            cyl(mb, x + 0.55 * s, y, z, 0.13, 0.25 * s, "M_Engine", axis="x", seg=10)
        else:
            cyl(mb, x, y + dy, z, 0.13, 0.25 * (1 if dy > 0 else -1), "M_Engine", axis="y", seg=10)


# ------------------------------------------------------------------ огни и полосы
def lights(mb, H):
    nose = H.nose
    # вертикальные светящиеся полосы по углам носового щита и под ним
    ring = nose["ring"]
    xs = [p[0] for p in ring]
    zs = [p[2] for p in ring]
    xm, zm = max(xs), min(zs)
    y = nose["y"] - 0.02
    for s in (1, -1):
        x0, x1 = sorted((s * (xm * 0.82), s * (xm * 0.82 - 0.14)))
        box(mb, x0, y - 0.03, nose["cz"] - 1.2, x1, y, nose["cz"] + 0.9, "M_Strip_Ext")
        x0, x1 = sorted((s * 1.0, s * 3.2))
        box(mb, x0, y - 0.03, zm * 0.78 + nose["cz"] * 0.22, x1, y, zm * 0.78 + nose["cz"] * 0.22 + 0.1, "M_Strip_Ext")
    # навигационные огни: левый борт красный, правый зелёный, стробы
    for s, m in ((1, "M_Nav_Green"), (-1, "M_Nav_Red")):
        boxc(mb, s * 10.9, -31.2, 6.0, 0.12, 0.4, 0.12, m)
        boxc(mb, s * (POD_X + 3.05), 46.0, POD_Z + 2.0, 0.12, 0.4, 0.12, m)
    for p in ((0, 46.2, 10.6), (0, -21.0, 10.85), (0, 44.0, -7.2), (0, -46.0, -5.6)):
        boxc(mb, *p, 0.22, 0.22, 0.12, "M_Nav_White")


# ------------------------------------------------------------------ декали
def _uv(px0, py0, px1, py1, n=2048):
    u0, u1 = px0 / n, px1 / n
    v0, v1 = 1 - py1 / n, 1 - py0 / n
    return u0, v0, u1, v1


DECAL = {
    "vesper": _uv(0, 0, 2048, 420), "explorer": _uv(0, 440, 2048, 620),
    "chev_d": _uv(0, 640, 512, 1152), "chev_l": _uv(512, 640, 1024, 1152),
    "vx_d": _uv(1024, 640, 2048, 900), "vx_l": _uv(1024, 900, 2048, 1160),
    "hazard": _uv(0, 1620, 2048, 1700),
}
for i in range(8):
    DECAL[f"label{i}"] = _uv((i % 4) * 512, 1200 + (i // 4) * 100, (i % 4) * 512 + 512, 1300 + (i // 4) * 100)


def decal(mb, key, y0, y1, z0, z1, xfn, side, off=0.012):
    """Декаль на борту: прямоугольник y0..y1 × z0..z1, x = xfn(y, z) (поверхность корпуса) + отступ."""
    u0, v0, u1, v1 = DECAL[key]
    P = [(y0, z0), (y1, z0), (y1, z1), (y0, z1)]
    pts = [((xfn(y, z) + off) * side, y, z) for y, z in P]
    if side > 0:
        uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        mb.poly(pts, "M_Decals", uv)
    else:
        # левый борт: текст читается с носа к корме справа налево → зеркалим U
        uv = [(u1, v0), (u0, v0), (u0, v1), (u1, v1)]
        mb.poly(pts[::-1], "M_Decals", uv[::-1])


def decals(mb, H):
    xw = lambda y, z: H.outer_x(y, z)
    for s in (1, -1):
        decal(mb, "vesper", -30.3, -25.9, 4.75, 5.65, xw, s)
        decal(mb, "explorer", -30.3, -25.9, 4.2, 4.585, xw, s)
        decal(mb, "chev_l", -25.5, -24.5, 4.5, 5.5, xw, s)
        decal(mb, "vx_d", -29.9, -26.7, -3.45, -2.64, xw, s)
        decal(mb, "label6", 43.0, 45.0, -3.6, -3.2, xw, s)
    decal(mb, "label0", -36.6, -33.4, -2.05, -1.8, xw, 1)
    decal(mb, "hazard", -36.4, -33.6, -4.3, -4.18, xw, 1)
    decal(mb, "label4", 1.5, 3.5, -3.6, -3.2, xw, 1)
    decal(mb, "label5", 1.5, 3.5, -3.6, -3.2, xw, -1)


def build(H):
    mb = MB("Exterior_Details")
    pods = MB("Engine_Pods")
    for s in (1, -1):
        pod(pods, s)
    pylons(pods)
    eng = MB("Engines_Main")
    main_engines(eng, H.stern_y, H.stern_z)
    topside(mb, H)
    nav = MB("Nav_Lights")
    lights(nav, H)
    dec = MB("Decals")
    decals(dec, H)
    return [mb, pods, eng, nav, dec]
