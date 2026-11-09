# Библиотека интерьерных объектов. Локальные координаты: начало — центр основания на полу,
# «спина» объекта смотрит в +Y (к стене), лицевая сторона — в −Y. XF поворачивает и переносит.
import math
from .geo import box, boxc, bbox, cyl, beam, tube, prism

ROT = {"+y": 0, "+x": -90, "-y": 180, "-x": 90}


class XF:
    """Обёртка над MB: поворот вокруг Z (кратно 90°) + перенос."""
    def __init__(self, mb, x, y, z=0.0, back="+y"):
        self.mb, self.o = mb, (x, y, z)
        a = math.radians(ROT[back] if isinstance(back, str) else back)
        self.c, self.s = round(math.cos(a), 9), round(math.sin(a), 9)
        self.v = mb.v

    def vert(self, p):
        x, y, z = p
        return self.mb.vert((self.o[0] + x * self.c - y * self.s, self.o[1] + x * self.s + y * self.c, self.o[2] + z))

    def verts(self, ps):
        return [self.vert(p) for p in ps]

    def face(self, idx, mat, uv=None):
        return self.mb.face(idx, mat, uv)

    def poly(self, ps, mat, uv=None):
        return self.mb.face(self.verts(ps), mat, uv)


def screen_uv(i):
    c, r = i % 4, (i // 4) % 4
    u0, u1 = c / 4 + 0.004, (c + 1) / 4 - 0.004
    v1, v0 = 1 - r / 4 - 0.004, 1 - (r + 1) / 4 + 0.004
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def screen(m, x0, x1, z0, z1, y, i, frame=True):
    """Экран в плоскости XZ на глубине y, лицом к −Y."""
    if frame:
        box(m, x0 - 0.04, y, z0 - 0.04, x1 + 0.04, y + 0.04, z1 + 0.04, "M_Plastic_Black")
    m.poly([(x0, y - 0.005, z0), (x1, y - 0.005, z0), (x1, y - 0.005, z1), (x0, y - 0.005, z1)], "M_Screens", screen_uv(i))


# ------------------------------------------------------------------ жильё
def bed(m, w=1.6, l=2.1, fabric="M_Fabric_Beige", blanket="M_Fabric_Navy"):
    box(m, -w / 2, -l / 2, 0, w / 2, l / 2, 0.32, "M_Wood")
    box(m, -w / 2 + 0.04, -l / 2 + 0.04, 0.32, w / 2 - 0.04, l / 2 - 0.04, 0.55, "M_Fabric_Beige")
    box(m, -w / 2 + 0.02, -l / 2 + 0.02, 0.52, w / 2 - 0.02, l / 2 - 0.62, 0.6, blanket)
    for sx in ((-w / 4, ), (w / 4, )) if w > 1.2 else ((0,),):
        boxc(m, sx[0], l / 2 - 0.35, 0.64, min(0.62, w / 2 - 0.1), 0.38, 0.16, "M_Fabric_Grey")
    box(m, -w / 2 - 0.05, l / 2, 0, w / 2 + 0.05, l / 2 + 0.1, 1.15, "M_Leather")
    # тумбочки и бра
    for sx in (-1, 1):
        x = sx * (w / 2 + 0.3)
        box(m, x - 0.24, l / 2 - 0.45, 0, x + 0.24, l / 2 + 0.05, 0.5, "M_Wood")
        cyl(m, x, l / 2 - 0.2, 0.5, 0.07, 0.25, "M_Metal_Brushed", seg=8)
        cyl(m, x, l / 2 - 0.2, 0.75, 0.14, 0.16, "M_Light_Warm", seg=10, r2=0.09)


def wardrobe(m, w=1.2, d=0.6, h=2.3):
    box(m, -w / 2, -d / 2, 0, w / 2, d / 2, h, "M_Wood")
    box(m, -0.01, -d / 2 - 0.01, 0.1, 0.01, -d / 2, h - 0.1, "M_Wood_Dark")
    for sx in (-1, 1):
        box(m, sx * 0.06 - 0.015, -d / 2 - 0.04, 1.0, sx * 0.06 + 0.015, -d / 2, 1.3, "M_Metal_Brushed")


def desk(m, w=1.4, d=0.65, chair=True, screens=1, si=0):
    box(m, -w / 2, -d / 2, 0.72, w / 2, d / 2, 0.76, "M_Wood")
    for sx in (-1, 1):
        box(m, sx * (w / 2 - 0.05) - 0.03, -d / 2 + 0.05, 0, sx * (w / 2 - 0.05) + 0.03, d / 2 - 0.05, 0.72, "M_Metal_Dark")
    for k in range(screens):
        x = (k - (screens - 1) / 2) * 0.62
        box(m, x - 0.03, d / 2 - 0.2, 0.76, x + 0.03, d / 2 - 0.14, 1.0, "M_Metal_Dark")
        screen(m, x - 0.28, x + 0.28, 1.0, 1.32, d / 2 - 0.17, si + k)
    boxc(m, 0.0, -0.05, 0.775, 0.45, 0.15, 0.02, "M_Plastic_Black")
    if chair:
        office_chair(m, 0, -d / 2 - 0.35)


def office_chair(m, x=0.0, y=0.0, mat="M_Fabric_Navy"):
    cyl(m, x, y, 0, 0.3, 0.05, "M_Metal_Dark", seg=10)
    cyl(m, x, y, 0.05, 0.03, 0.4, "M_Metal_Brushed", seg=6)
    box(m, x - 0.25, y - 0.25, 0.45, x + 0.25, y + 0.22, 0.55, mat)
    box(m, x - 0.23, y - 0.3, 0.55, x + 0.23, y - 0.24, 1.05, mat)


def chair(m, x=0.0, y=0.0, back="+y", mat="M_Fabric_Beige"):
    c = XF(m, x, y, 0, back)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(c, sx * 0.2 - 0.02, sy * 0.2 - 0.02, 0, sx * 0.2 + 0.02, sy * 0.2 + 0.02, 0.45, "M_Wood_Dark")
    box(c, -0.23, -0.23, 0.45, 0.23, 0.23, 0.52, mat)
    box(c, -0.23, 0.19, 0.52, 0.23, 0.24, 0.95, "M_Wood_Dark")


def sofa(m, w=2.2, d=0.9, mat="M_Fabric_Blue"):
    box(m, -w / 2, -d / 2, 0.08, w / 2, d / 2, 0.42, mat)
    box(m, -w / 2, d / 2 - 0.22, 0.42, w / 2, d / 2, 0.85, mat)
    for sx in (-1, 1):
        box(m, sx * w / 2 - (0.18 if sx > 0 else 0), -d / 2, 0.42, sx * w / 2 + (0.18 if sx < 0 else 0), d / 2, 0.62, mat)
    n = max(2, int(w / 0.8))
    for k in range(n):
        x0 = -w / 2 + 0.2 + k * (w - 0.4) / n
        box(m, x0 + 0.02, -d / 2 + 0.04, 0.42, x0 + (w - 0.4) / n - 0.02, d / 2 - 0.24, 0.52, mat)
        box(m, x0 + 0.08, d / 2 - 0.36, 0.52, x0 + (w - 0.4) / n - 0.08, d / 2 - 0.22, 0.82, "M_Fabric_Beige")
    for sx in (-1, 1):
        box(m, sx * (w / 2 - 0.1) - 0.03, -d / 2 + 0.05, 0, sx * (w / 2 - 0.1) + 0.03, -d / 2 + 0.1, 0.08, "M_Metal_Dark")


def armchair(m, mat="M_Leather"):
    sofa(m, 0.95, 0.85, mat)


def coffee_table(m, w=1.1, d=0.6, h=0.42):
    box(m, -w / 2, -d / 2, h - 0.04, w / 2, d / 2, h, "M_Wood")
    box(m, -w / 2 + 0.06, -d / 2 + 0.06, 0, w / 2 - 0.06, d / 2 - 0.06, h - 0.04, "M_Wood_Dark")
    cyl(m, w / 4, 0, h, 0.06, 0.1, "M_Ceramic", seg=8)


def rug(m, w, l, mat="M_Carpet"):
    box(m, -w / 2, -l / 2, 0, w / 2, l / 2, 0.012, mat)


def bookshelf(m, w=1.6, d=0.35, h=2.1, seed=0):
    box(m, -w / 2, d / 2 - 0.03, 0, w / 2, d / 2, h, "M_Wood_Dark")
    for sx in (-1, 1):
        box(m, sx * w / 2 - (0.03 if sx > 0 else 0), -d / 2, 0, sx * w / 2 + (0.03 if sx < 0 else 0), d / 2, h, "M_Wood_Dark")
    cols = ["M_Fabric_Red", "M_Fabric_Navy", "M_Fabric_Green", "M_Fabric_Beige", "M_Leather", "M_Paint_Teal"]
    r = seed * 7 + 3
    nsh = 5
    for k in range(nsh + 1):
        z = k * h / nsh
        box(m, -w / 2, -d / 2, z, w / 2, d / 2, z + 0.03, "M_Wood_Dark")
        if k == nsh:
            break
        x = -w / 2 + 0.05
        while x < w / 2 - 0.12:
            r = (r * 1103515245 + 12345) & 0x7FFFFFFF
            bw = 0.03 + (r % 5) * 0.012
            bh = h / nsh * (0.55 + (r % 7) * 0.05)
            if r % 11 == 0:
                x += 0.12
                continue
            box(m, x, -d / 2 + 0.04, z + 0.03, x + bw, d / 2 - 0.05, z + 0.03 + bh, cols[r % len(cols)])
            x += bw + 0.004


def plant(m, h=1.2, pot=0.25, mat="M_Plant_Leaf", seed=0):
    cyl(m, 0, 0, 0, pot, pot * 1.5, "M_Ceramic", seg=12, r2=pot * 1.15)
    cyl(m, 0, 0, pot * 1.45, pot * 1.05, 0.02, "M_Soil", seg=12)
    cyl(m, 0, 0, pot * 1.45, 0.025, h * 0.5, "M_Wood_Dark", seg=5)
    r = seed + 1
    for k in range(7):
        r = (r * 1103515245 + 12345) & 0x7FFFFFFF
        a = k * 2.4 + seed
        rr = 0.1 + (r % 100) / 400
        zz = pot * 1.5 + h * (0.35 + (r % 60) / 100)
        s = 0.16 + (r % 50) / 400
        cx, cy = math.cos(a) * rr, math.sin(a) * rr
        # лист-«капля» из октаэдра
        pts = [(cx + s, cy, zz), (cx - s, cy, zz), (cx, cy + s, zz), (cx, cy - s, zz), (cx, cy, zz + s * 1.3), (cx, cy, zz - s * 0.6)]
        v = m.verts(pts)
        mm = mat if k % 2 else "M_Plant_Leaf2"
        for a1, b1 in ((0, 2), (2, 1), (1, 3), (3, 0)):
            m.face([v[a1], v[b1], v[4]], mm)
            m.face([v[b1], v[a1], v[5]], mm)


def floor_lamp(m):
    cyl(m, 0, 0, 0, 0.18, 0.03, "M_Metal_Dark", seg=10)
    cyl(m, 0, 0, 0.03, 0.02, 1.45, "M_Metal_Brushed", seg=6)
    cyl(m, 0, 0, 1.4, 0.24, 0.3, "M_Light_Warm", seg=12, r2=0.17)


def wall_screen(m, w, h, z0, i):
    screen(m, -w / 2, w / 2, z0, z0 + h, 0.0, i)


def kitchen(m, w=4.0, d=0.65, island=True):
    """Кухонный ряд вдоль стены (+Y) + верхние шкафы, плита, мойка, холодильник."""
    box(m, -w / 2, -d / 2, 0.1, w / 2, d / 2, 0.88, "M_Wall_White")
    box(m, -w / 2, -d / 2 + 0.05, 0, w / 2, d / 2, 0.1, "M_Plastic_Black")
    box(m, -w / 2 - 0.02, -d / 2 - 0.03, 0.88, w / 2 + 0.02, d / 2, 0.92, "M_Wood")
    n = int(w / 0.6)
    for k in range(n):
        x = -w / 2 + (k + 0.5) * w / n
        box(m, x - 0.01, -d / 2 - 0.012, 0.15, x + 0.01, -d / 2, 0.85, "M_Metal_Dark")
        box(m, x - 0.2, -d / 2 - 0.03, 0.76, x + 0.2, -d / 2, 0.78, "M_Metal_Brushed")
    box(m, -w / 2, d / 2 - 0.35, 1.5, w / 2, d / 2, 2.2, "M_Wall_White")
    box(m, -w / 2, d / 2 - 0.36, 1.46, w / 2, d / 2 - 0.34, 1.5, "M_Strip_Warm")
    boxc(m, -w / 4, 0, 0.925, 0.6, 0.45, 0.01, "M_Plastic_Black")   # плита
    boxc(m, w / 6, 0.02, 0.9, 0.5, 0.38, 0.06, "M_Metal_Brushed")    # мойка
    cyl(m, w / 6, 0.2, 0.92, 0.02, 0.3, "M_Metal_Brushed", seg=6)
    box(m, w / 2 + 0.05, -d / 2, 0, w / 2 + 0.85, d / 2, 2.1, "M_Metal_Brushed")   # холодильник
    box(m, w / 2 + 0.44, -d / 2 - 0.01, 0.2, w / 2 + 0.46, -d / 2, 1.9, "M_Metal_Dark")
    if island:
        box(m, -w / 3, -2.2, 0, w / 3, -1.3, 0.9, "M_Wood_Dark")
        box(m, -w / 3 - 0.15, -2.35, 0.9, w / 3 + 0.15, -1.15, 0.95, "M_Wood")
        for k in range(4):
            x = -w / 3 + 0.3 + k * (2 * w / 3 - 0.6) / 3
            cyl(m, x, -2.75, 0, 0.18, 0.05, "M_Metal_Dark", seg=10)
            cyl(m, x, -2.75, 0.05, 0.03, 0.65, "M_Metal_Brushed", seg=6)
            cyl(m, x, -2.75, 0.7, 0.2, 0.07, "M_Leather", seg=12)


def dining_table(m, w=1.8, d=0.9, seats=6):
    box(m, -w / 2, -d / 2, 0.72, w / 2, d / 2, 0.76, "M_Wood")
    for sx in (-1, 1):
        box(m, sx * (w / 2 - 0.25) - 0.05, -d / 2 + 0.15, 0, sx * (w / 2 - 0.25) + 0.05, d / 2 - 0.15, 0.72, "M_Wood_Dark")
    per = seats // 2
    for k in range(per):
        x = -w / 2 + (k + 0.5) * w / per
        chair(m, x, -d / 2 - 0.35, "-y")
        chair(m, x, d / 2 + 0.35, "+y")
    cyl(m, 0, 0, 0.76, 0.1, 0.2, "M_Ceramic", seg=10)
    plant_small(m, 0, 0, 0.96)


def plant_small(m, x, y, z):
    for k in range(5):
        a = k * 1.26
        pts = [(x + math.cos(a) * 0.12, y + math.sin(a) * 0.12, z + 0.05), (x, y, z + 0.22), (x + math.cos(a + 0.4) * 0.05, y + math.sin(a + 0.4) * 0.05, z)]
        m.poly(pts, "M_Plant_Leaf2")
        m.poly(pts[::-1], "M_Plant_Leaf2")


def pendant(m, x, y, z_ceil, drop=0.8, r=0.22):
    cyl(m, x, y, z_ceil - drop, 0.008, drop, "M_Metal_Dark", seg=4, cap=False)
    cyl(m, x, y, z_ceil - drop - 0.18, r, 0.18, "M_Metal_Dark", seg=14, r2=0.05)
    cyl(m, x, y, z_ceil - drop - 0.19, r * 0.9, 0.01, "M_Light_Warm", seg=14)


def ceiling_panel(m, x, y, z, w, l, mat="M_Light_White"):
    box(m, x - w / 2 - 0.04, y - l / 2 - 0.04, z - 0.03, x + w / 2 + 0.04, y + l / 2 + 0.04, z, "M_Metal_Dark")
    box(m, x - w / 2, y - l / 2, z - 0.04, x + w / 2, y + l / 2, z - 0.03, mat)


# ------------------------------------------------------------------ техника и рабочие места
def console(m, w=1.4, d=0.8, si=0, tilt=True, mat="M_Metal_Dark"):
    box(m, -w / 2, -d / 2 + 0.15, 0, w / 2, d / 2, 0.75, mat)
    if tilt:
        v = m.verts([(-w / 2, -d / 2, 0.75), (w / 2, -d / 2, 0.75), (w / 2, d / 2, 1.05), (-w / 2, d / 2, 1.05),
                     (-w / 2, -d / 2 + 0.15, 0.55), (w / 2, -d / 2 + 0.15, 0.55)])
        m.face([v[0], v[1], v[2], v[3]], "M_Plastic_Black")
        m.face([v[4], v[5], v[1], v[0]], mat)
        m.face([v[0], v[3], v[4]], mat)
        m.face([v[1], v[5], v[2]], mat)
        a, b, c = (-w / 2 + 0.06, -d / 2 + 0.06, 0.765), (w / 2 - 0.06, -d / 2 + 0.06, 0.765), (w / 2 - 0.06, d / 2 - 0.06, 1.035)
        dd = (-w / 2 + 0.06, d / 2 - 0.06, 1.035)
        m.poly([a, b, c, dd], "M_Screens", screen_uv(si))
    box(m, -w / 2 + 0.1, d / 2 - 0.08, 1.05, w / 2 - 0.1, d / 2 - 0.02, 1.55, "M_Plastic_Black")
    m.poly([(-w / 2 + 0.14, d / 2 - 0.085, 1.09), (w / 2 - 0.14, d / 2 - 0.085, 1.09), (w / 2 - 0.14, d / 2 - 0.085, 1.51),
            (-w / 2 + 0.14, d / 2 - 0.085, 1.51)], "M_Screens", screen_uv(si + 1))


def pilot_seat(m, mat="M_Leather"):
    cyl(m, 0, 0, 0, 0.32, 0.08, "M_Metal_Dark", seg=12)
    cyl(m, 0, 0, 0.08, 0.06, 0.38, "M_Metal_Brushed", seg=8)
    box(m, -0.3, -0.3, 0.46, 0.3, 0.28, 0.6, mat)
    box(m, -0.3, 0.2, 0.6, 0.3, 0.32, 1.35, mat)
    boxc(m, 0, 0.28, 1.45, 0.3, 0.1, 0.2, mat)
    for sx in (-1, 1):
        box(m, sx * 0.34 - 0.05, -0.25, 0.6, sx * 0.34 + 0.05, 0.25, 0.7, "M_Metal_Dark")


def holo_table(m, r=0.9):
    cyl(m, 0, 0, 0, r * 0.7, 0.85, "M_Metal_Dark", seg=24, r2=r * 0.85)
    cyl(m, 0, 0, 0.85, r, 0.08, "M_Plastic_Black", seg=24)
    cyl(m, 0, 0, 0.93, r * 0.9, 0.01, "M_Hologram", seg=24)
    cyl(m, 0, 0, 1.15, r * 0.45, 0.02, "M_Hologram", seg=20)
    cyl(m, 0, 0, 1.4, r * 0.25, 0.02, "M_Hologram", seg=16)


def locker_row(m, w=2.4, d=0.5, h=2.0, mat="M_Paint_Grey"):
    n = int(w / 0.5)
    for k in range(n):
        x0 = -w / 2 + k * w / n
        box(m, x0 + 0.01, -d / 2, 0, x0 + w / n - 0.01, d / 2, h, mat)
        box(m, x0 + w / n - 0.1, -d / 2 - 0.02, h * 0.45, x0 + w / n - 0.07, -d / 2, h * 0.6, "M_Metal_Dark")
        for z in (h - 0.25, h - 0.3):
            box(m, x0 + 0.08, -d / 2 - 0.01, z, x0 + w / n - 0.08, -d / 2, z + 0.02, "M_Metal_Dark")


def eva_suit(m):
    box(m, -0.3, -0.05, 0.0, 0.3, 0.25, 0.3, "M_Metal_Dark")
    bbox(m, -0.28, -0.18, 0.85, 0.28, 0.2, 1.55, "M_Plastic_White", c=0.08)
    for sx in (-1, 1):
        bbox(m, sx * 0.14 - 0.1, -0.12, 0.05, sx * 0.14 + 0.1, 0.12, 0.88, "M_Plastic_White", c=0.04)
        bbox(m, sx * 0.38 - 0.08, -0.1, 0.8, sx * 0.38 + 0.08, 0.1, 1.5, "M_Plastic_White", c=0.03)
    cyl(m, 0, 0.0, 1.55, 0.17, 0.32, "M_Plastic_White", seg=12)
    m.poly([(-0.12, -0.175, 1.6), (0.12, -0.175, 1.6), (0.12, -0.175, 1.8), (-0.12, -0.175, 1.8)], "M_Glass_Interior")
    box(m, -0.25, 0.2, 0.9, 0.25, 0.42, 1.5, "M_Paint_Orange")


def med_bed(m):
    box(m, -0.45, -1.05, 0, 0.45, 1.05, 0.12, "M_Metal_Dark")
    cyl(m, 0, 0, 0.12, 0.12, 0.45, "M_Metal_Brushed", seg=10)
    bbox(m, -0.45, -1.05, 0.57, 0.45, 1.05, 0.78, "M_Plastic_White", c=0.05)
    box(m, -0.4, -1.0, 0.78, 0.4, 1.0, 0.86, "M_Fabric_Blue")
    box(m, -0.3, 0.55, 0.86, 0.3, 0.95, 0.96, "M_Fabric_Grey")
    # дуга сканера
    for sx in (-1, 1):
        box(m, sx * 0.62 - 0.06, -0.3, 0, sx * 0.62 + 0.06, -0.1, 1.6, "M_Plastic_White")
    box(m, -0.68, -0.3, 1.6, 0.68, -0.1, 1.72, "M_Plastic_White")
    box(m, -0.5, -0.31, 1.56, 0.5, -0.29, 1.6, "M_Light_Blue")
    box(m, 0.75, 0.7, 0, 0.95, 0.9, 1.4, "M_Metal_Dark")
    screen(m, 0.6, 1.1, 1.4, 1.75, 0.82, 6)


def cabinet(m, w=1.0, d=0.5, h=1.0, mat="M_Plastic_White"):
    box(m, -w / 2, -d / 2, 0, w / 2, d / 2, h, mat)
    for k in range(int(h / 0.3)):
        z = 0.15 + k * 0.3
        box(m, -w / 2 + 0.05, -d / 2 - 0.012, z, w / 2 - 0.05, -d / 2, z + 0.01, "M_Metal_Dark")


def treadmill(m):
    box(m, -0.45, -1.0, 0, 0.45, 1.0, 0.2, "M_Plastic_Black")
    box(m, -0.38, -0.95, 0.2, 0.38, 0.95, 0.22, "M_Rubber")
    for sx in (-1, 1):
        box(m, sx * 0.42 - 0.03, -1.0, 0.2, sx * 0.42 + 0.03, -0.9, 1.3, "M_Metal_Dark")
    box(m, -0.45, -1.05, 1.25, 0.45, -0.85, 1.4, "M_Plastic_Black")
    screen(m, -0.2, 0.2, 1.3, 1.5, -0.95, 5, frame=False)


def weight_bench(m):
    box(m, -0.18, -0.7, 0.4, 0.18, 0.6, 0.5, "M_Leather")
    for y in (-0.6, 0.5):
        box(m, -0.05, y - 0.05, 0, 0.05, y + 0.05, 0.4, "M_Metal_Dark")
    for sx in (-1, 1):
        box(m, sx * 0.5 - 0.03, 0.45, 0, sx * 0.5 + 0.03, 0.55, 1.3, "M_Metal_Dark")
    cyl(m, -0.9, 0.5, 1.1, 0.02, 1.8, "M_Metal_Brushed", axis="x", seg=8)
    for x in (-0.75, 0.75):
        cyl(m, x - 0.05, 0.5, 1.1, 0.22, 0.1, "M_Plastic_Black", axis="x", seg=14)


def weight_rack(m, w=1.8):
    box(m, -w / 2, -0.25, 0, w / 2, 0.25, 0.05, "M_Metal_Dark")
    for z in (0.35, 0.8):
        box(m, -w / 2, -0.25, z, w / 2, 0.25, z + 0.04, "M_Metal_Dark")
        for k in range(6):
            x = -w / 2 + 0.15 + k * (w - 0.3) / 5
            cyl(m, x - 0.1, 0, z + 0.12, 0.07, 0.2, "M_Plastic_Black", axis="x", seg=10)
    for sx in (-1, 1):
        box(m, sx * w / 2 - 0.04, -0.25, 0, sx * w / 2 + 0.04, 0.25, 1.0, "M_Metal_Dark")


def punching_bag(m, z_ceil):
    cyl(m, 0, 0, z_ceil - 0.9, 0.01, 0.9, "M_Metal_Dark", seg=4)
    cyl(m, 0, 0, z_ceil - 2.0, 0.18, 1.1, "M_Leather", seg=12)


def shower(m):
    box(m, -0.5, -0.5, 0, 0.5, 0.5, 0.08, "M_Ceramic")
    for sx in (-1, 1):
        box(m, sx * 0.5 - 0.02, -0.5, 0, sx * 0.5 + 0.02, 0.5, 2.1, "M_Glass_Interior")
    box(m, -0.5, -0.52, 0.0, 0.5, -0.48, 2.1, "M_Glass_Interior")
    cyl(m, 0, 0.42, 2.0, 0.12, 0.02, "M_Metal_Brushed", seg=10)


def vanity(m, w=1.6):
    box(m, -w / 2, -0.28, 0.6, w / 2, 0.28, 0.85, "M_Wood")
    for k in range(int(w / 0.8)):
        x = -w / 2 + 0.4 + k * 0.8
        cyl(m, x, 0, 0.82, 0.2, 0.06, "M_Ceramic", seg=14)
        cyl(m, x, 0.2, 0.85, 0.015, 0.2, "M_Metal_Brushed", seg=6)
    box(m, -w / 2, 0.27, 1.05, w / 2, 0.29, 1.95, "M_Mirror")
    box(m, -w / 2, 0.25, 1.95, w / 2, 0.29, 2.0, "M_Strip_White")


def washer(m):
    box(m, -0.3, -0.3, 0, 0.3, 0.3, 0.85, "M_Plastic_White")
    cyl(m, 0, -0.3, 0.42, 0.2, -0.02, "M_Metal_Dark", axis="y", seg=16)
    cyl(m, 0, -0.32, 0.42, 0.16, -0.005, "M_Glass_Interior", axis="y", seg=16)


def rack(m, w=2.0, d=0.6, h=2.4, crates=True, seed=0):
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(m, sx * w / 2 - 0.03, sy * d / 2 - 0.03, 0, sx * w / 2 + 0.03, sy * d / 2 + 0.03, h, "M_Paint_Orange")
    r = seed + 5
    for k in range(4):
        z = 0.1 + k * (h - 0.2) / 3
        box(m, -w / 2, -d / 2, z, w / 2, d / 2, z + 0.04, "M_Paint_Blue")
        if crates and k < 3:
            x = -w / 2 + 0.05
            while x < w / 2 - 0.35:
                r = (r * 1103515245 + 12345) & 0x7FFFFFFF
                cw = 0.35 + (r % 4) * 0.1
                ch = 0.25 + (r % 3) * 0.12
                if x + cw > w / 2 - 0.05:
                    break
                mat = ("M_Paint_Grey", "M_Paint_Teal", "M_Paint_Yellow", "M_Wood")[r % 4]
                box(m, x, -d / 2 + 0.05, z + 0.04, x + cw, d / 2 - 0.05, z + 0.04 + ch, mat)
                x += cw + 0.05


def crate(m, s=1.0, mat="M_Paint_Grey"):
    bbox(m, -s / 2, -s / 2, 0, s / 2, s / 2, s, mat, c=0.04)
    box(m, -s / 2 - 0.005, -0.06, 0.05, s / 2 + 0.005, 0.06, s - 0.05, "M_Metal_Dark")


def pallet_stack(m, n=2):
    box(m, -0.6, -0.5, 0, 0.6, 0.5, 0.14, "M_Wood")
    for k in range(n):
        crate_ = XF(m, -0.3 + k * 0.6, 0, 0.14)
        crate(crate_, 0.55, ("M_Paint_Teal", "M_Paint_Yellow", "M_Paint_Grey")[k % 3])


def workbench(m, w=2.0):
    box(m, -w / 2, -0.4, 0.88, w / 2, 0.4, 0.94, "M_Wood")
    box(m, -w / 2, -0.35, 0, w / 2, 0.35, 0.86, "M_Paint_Red")
    for k in range(int(w / 0.5)):
        x = -w / 2 + 0.25 + k * 0.5
        box(m, x - 0.2, -0.37, 0.1, x + 0.2, -0.35, 0.8, "M_Metal_Dark")
    box(m, -w / 2, 0.38, 0.94, w / 2, 0.42, 2.0, "M_Wall_Industrial")
    # инструменты на перфопанели
    for k in range(9):
        x = -w / 2 + 0.2 + k * (w - 0.4) / 8
        box(m, x - 0.02, 0.33, 1.3 + (k % 3) * 0.2, x + 0.02, 0.38, 1.55 + (k % 3) * 0.2, "M_Metal_Brushed")
    boxc(m, w / 4, 0, 1.05, 0.3, 0.25, 0.2, "M_Paint_Yellow")


def printer3d(m):
    box(m, -0.5, -0.5, 0, 0.5, 0.5, 0.8, "M_Metal_Dark")
    box(m, -0.5, -0.5, 0.8, 0.5, 0.5, 1.8, "M_Glass_Interior")
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(m, sx * 0.48 - 0.02, sy * 0.48 - 0.02, 0.8, sx * 0.48 + 0.02, sy * 0.48 + 0.02, 1.8, "M_Metal_Dark")
    box(m, -0.5, -0.5, 1.8, 0.5, 0.5, 1.9, "M_Metal_Dark")
    box(m, -0.3, -0.3, 0.9, 0.3, 0.3, 0.95, "M_Plastic_White")
    box(m, -0.45, -0.52, 0.5, -0.15, -0.5, 0.7, "M_Screens", )


def server_rack(m):
    box(m, -0.3, -0.5, 0, 0.3, 0.5, 2.0, "M_Plastic_Black")
    for k in range(10):
        z = 0.15 + k * 0.18
        box(m, -0.28, -0.51, z, 0.28, -0.5, z + 0.012, "M_Strip_Blue" if k % 3 else "M_Strip_Orange")


def planter(m, l=6.0, w=1.0, seed=0, grow=True, z_ceil=3.4):
    box(m, -w / 2, -l / 2, 0, w / 2, l / 2, 0.75, "M_Wood")
    box(m, -w / 2 + 0.06, -l / 2 + 0.06, 0.75, w / 2 - 0.06, l / 2 - 0.06, 0.78, "M_Soil")
    n = int(l / 0.5)
    for k in range(n):
        y = -l / 2 + 0.25 + k * (l - 0.5) / max(n - 1, 1)
        for sx in (-0.22, 0.22):
            p = XF(m, sx, y, 0.78)
            sprout(p, seed + k * 3 + (1 if sx > 0 else 0))
    if grow:
        box(m, -w / 2, -l / 2, z_ceil - 0.9, w / 2, l / 2, z_ceil - 0.84, "M_Metal_Dark")
        box(m, -w / 2 + 0.08, -l / 2 + 0.1, z_ceil - 0.905, w / 2 - 0.08, l / 2 - 0.1, z_ceil - 0.9, "M_Light_Grow")
        for sy in (-1, 1):
            cyl(m, 0, sy * (l / 2 - 0.2), z_ceil - 0.84, 0.01, 0.84, "M_Metal_Dark", seg=4)


def sprout(m, seed):
    r = seed * 2654435761 & 0xFFFF
    h = 0.25 + (r % 30) / 100
    for k in range(4):
        a = k * 1.57 + (r % 10) * 0.1
        pts = [(math.cos(a) * 0.04, math.sin(a) * 0.04, 0), (math.cos(a) * 0.18, math.sin(a) * 0.18, h * 0.8),
               (math.cos(a + 0.5) * 0.1, math.sin(a + 0.5) * 0.1, h)]
        mm = "M_Plant_Leaf" if (r + k) % 3 else "M_Plant_Leaf2"
        m.poly(pts, mm)
        m.poly(pts[::-1], mm)


def tank(m, r=0.6, h=2.2, mat="M_Metal_Brushed"):
    cyl(m, 0, 0, 0, r, h, mat, seg=18)
    cyl(m, 0, 0, h, r * 0.6, 0.15, mat, seg=14)
    m2 = XF(m, 0, -r - 0.02, 0)
    box(m2, -0.08, -0.02, 0.3, 0.08, 0.0, h - 0.3, "M_Liquid_Blue")


def railing(m, p0, p1, h=1.1, mat="M_Paint_Yellow", post=1.5):
    """Перила по отрезку на полу p0→p1 (x, y, z)."""
    x0, y0, z0 = p0
    x1, y1, z1 = p1
    L_ = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(L_ / post))
    for k in range(n + 1):
        t = k / n
        x, y, z = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t
        box(m, x - 0.03, y - 0.03, z, x + 0.03, y + 0.03, z + h, mat)
    beam(m, (x0, y0, z0 + h), (x1, y1, z1 + h), 0.06, 0.06, mat)
    beam(m, (x0, y0, z0 + h * 0.5), (x1, y1, z1 + h * 0.5), 0.03, 0.03, "M_Metal_Dark")
    beam(m, (x0, y0, z0 + 0.06), (x1, y1, z1 + 0.06), 0.02, 0.12, "M_Hazard")


def spiral_stair(m, cx, cy, z0, z1, r=1.6, step=0.19, start=0.0, mat="M_Floor_Grate", rail=True):
    n = max(4, int(round((z1 - z0) / step)))
    rise = (z1 - z0) / n
    da = math.radians(24)
    cyl(m, cx, cy, z0, 0.12, z1 - z0 + 1.0, "M_Metal_Brushed", seg=10)
    for k in range(n):
        a0 = start + k * da
        a1 = a0 + da * 1.05
        z = z0 + (k + 1) * rise
        pts = [(0.12, a0), (r, a0), (r, a1), (0.12, a1)]
        poly = [(cx + rr * math.cos(a), cy + rr * math.sin(a)) for rr, a in pts]
        prism(m, poly, z - 0.05, z, mat, side_mat="M_Metal_Dark")
    if rail:
        pts = []
        for k in range(n + 1):
            a = start + k * da
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z0 + k * rise + 1.0))
        tube(m, pts, 0.03, "M_Metal_Brushed", seg=6)
        for k in range(0, n + 1, 2):
            a = start + k * da
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            box(m, x - 0.015, y - 0.015, z0 + k * rise, x + 0.015, y + 0.015, z0 + k * rise + 1.0, "M_Metal_Dark")
    return start + n * da


def utility_pillar(m):
    """Точка подключения линий для игроков: силовая (жёлтая), вода/хладагент (синяя), данные (зелёная)."""
    box(m, -0.45, -0.18, 0, 0.45, 0.18, 1.6, "M_Paint_Grey")
    box(m, -0.45, -0.19, 1.45, 0.45, -0.18, 1.6, "M_Hazard")
    for x, mat in ((-0.25, "M_Paint_Yellow"), (0.0, "M_Paint_Blue"), (0.25, "M_Paint_Green")):
        box(m, x - 0.09, -0.24, 0.8, x + 0.09, -0.18, 1.1, mat)
        cyl(m, x, -0.24, 0.95, 0.045, -0.05, "M_Plastic_Black", axis="y", seg=8)
    box(m, -0.12, -0.2, 1.2, 0.12, -0.18, 1.35, "M_Strip_Blue")
    box(m, -0.3, -0.18, 1.6, 0.3, 0.18, 2.6, "M_Metal_Dark")    # кабельный стояк


def gate_frame(m, x0, x1, z0, z1, y, t=0.4):
    """Обрамление ворот с полосами опасности в плоскости XZ на глубине y."""
    box(m, x0 - 0.35, y - t / 2, z0, x0, y + t / 2, z1 + 0.35, "M_Metal_Dark")
    box(m, x1, y - t / 2, z0, x1 + 0.35, y + t / 2, z1 + 0.35, "M_Metal_Dark")
    box(m, x0, y - t / 2, z1, x1, y + t / 2, z1 + 0.35, "M_Metal_Dark")
    for s in (-1, 1):
        box(m, x0 - 0.36, y + s * t / 2 - 0.01, z0, x0 - 0.2, y + s * t / 2 + 0.01, z1, "M_Hazard")
        box(m, x1 + 0.2, y + s * t / 2 - 0.01, z0, x1 + 0.36, y + s * t / 2 + 0.01, z1, "M_Hazard")
