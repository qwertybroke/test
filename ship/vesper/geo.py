# Построитель мешей: накапливает вершины/грани с материалами, ставит UV (box-проекция в метрах мира),
# острые рёбра по углу и создаёт объекты Blender. Плюс примитивы и 2D-отсечение полигонов.
import math
import bpy
import bmesh
from mathutils import Vector

# Размер тайла текстуры (м) по материалу; по умолчанию 2 м
TILE = {}


class MB:
    def __init__(self, name):
        self.name = name
        self.v = []
        self.f = []      # (indices, material)
        self.uv = {}     # face index -> list of uv (явные UV, напр. для декалей)

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def verts(self, ps):
        return [self.vert(p) for p in ps]

    def face(self, idx, mat, uv=None):
        self.f.append((tuple(idx), mat))
        if uv is not None:
            self.uv[len(self.f) - 1] = uv
        return len(self.f) - 1

    def poly(self, ps, mat, uv=None):
        return self.face(self.verts(ps), mat, uv)

    def extend(self, other):
        o = len(self.v)
        self.v += other.v
        base = len(self.f)
        for i, (idx, m) in enumerate(other.f):
            self.f.append((tuple(j + o for j in idx), m))
            if i in other.uv:
                self.uv[base + i] = other.uv[i]

    def tris(self):
        return sum(len(i) - 2 for i, _ in self.f)

    # ------------------------------------------------------------ в Blender
    def build(self, mats, collection, parent=None, sharp_deg=32.0, merge=0.0, loc=(0, 0, 0)):
        if not self.f:
            return None
        names = []
        for _, m in self.f:
            if m not in names:
                names.append(m)
        me = bpy.data.meshes.new(self.name)
        ox, oy, oz = loc
        me.from_pydata([(x - ox, y - oy, z - oz) for x, y, z in self.v], [], [i for i, _ in self.f])
        for n in names:
            me.materials.append(mats[n])
        mi = {n: k for k, n in enumerate(names)}
        me.polygons.foreach_set("material_index", [mi[m] for _, m in self.f])
        uvl = me.uv_layers.new(name="UVMap")
        uvd = [0.0] * (len(me.loops) * 2)
        for k, poly in enumerate(me.polygons):
            idx, m = self.f[k]
            if k in self.uv:
                for li, uv in zip(poly.loop_indices, self.uv[k]):
                    uvd[li * 2], uvd[li * 2 + 1] = uv
                continue
            pts = [self.v[i] for i in idx]
            n = _normal(pts)
            ax = max(range(3), key=lambda a: abs(n[a]))
            s = 1.0 / TILE.get(m, 2.0)
            for li, (x, y, z) in zip(poly.loop_indices, pts):
                if ax == 0:
                    u, w = (y if n[0] > 0 else -y), z
                elif ax == 1:
                    u, w = (-x if n[1] > 0 else x), z
                else:
                    u, w = x, (y if n[2] > 0 else -y)
                uvd[li * 2], uvd[li * 2 + 1] = u * s, w * s
        uvl.data.foreach_set("uv", uvd)
        bm = bmesh.new()
        bm.from_mesh(me)
        if merge > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        # вырожденные грани ломают нормали
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
        lim = math.radians(sharp_deg)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) != 2:
                e.smooth = False
                continue
            a, b = e.link_faces
            if a.material_index != b.material_index or a.normal.angle(b.normal, 0) > lim:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        me.validate()
        ob = bpy.data.objects.new(self.name, me)
        ob.location = loc
        collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob


def _normal(pts):
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % n]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / l, ny / l, nz / l)


# ---------------------------------------------------------------- примитивы
def box(mb, x0, y0, z0, x1, y1, z1, mat, mats=None, skip=()):
    """Параллелепипед. mats: dict стороны -> материал (px,nx,py,ny,pz,nz). skip — пропустить стороны."""
    mats = mats or {}
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    v = mb.verts(P)
    sides = {"nz": (0, 3, 2, 1), "pz": (4, 5, 6, 7), "ny": (0, 1, 5, 4), "py": (2, 3, 7, 6), "nx": (3, 0, 4, 7), "px": (1, 2, 6, 5)}
    for k, q in sides.items():
        if k in skip:
            continue
        mb.face([v[i] for i in q], mats.get(k, mat))


def boxc(mb, cx, cy, cz, sx, sy, sz, mat, **kw):
    box(mb, cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, mat, **kw)


def bbox(mb, x0, y0, z0, x1, y1, z1, mat, c=0.03, top_mat=None):
    """Параллелепипед с фасками c по всем рёбрам (усечённые углы)."""
    c = min(c, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3)
    rings = []
    for z, inset in ((z0, c), (z0 + c, 0), (z1 - c, 0), (z1, c)):
        a0, a1, b0, b1 = x0 + inset, x1 - inset, y0 + inset, y1 - inset
        pts = [(a0 + c - inset, b0), (a1 - c + inset, b0), (a1, b0 + c - inset), (a1, b1 - c + inset),
               (a1 - c + inset, b1), (a0 + c - inset, b1), (a0, b1 - c + inset), (a0, b0 + c - inset)]
        rings.append(mb.verts([(x, y, z) for x, y in pts]))
    for k in range(3):
        r0, r1 = rings[k], rings[k + 1]
        for i in range(8):
            j = (i + 1) % 8
            mb.face([r0[i], r0[j], r1[j], r1[i]], mat)
    mb.face(list(reversed(rings[0])), mat)
    mb.face(rings[3], top_mat or mat)


def cyl(mb, cx, cy, cz, r, h, mat, axis="z", seg=16, cap=True, cap_mat=None, r2=None, open_top=False):
    r2 = r if r2 is None else r2
    A, B = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c, s = math.cos(a), math.sin(a)
        if axis == "z":
            A.append((cx + c * r, cy + s * r, cz)); B.append((cx + c * r2, cy + s * r2, cz + h))
        elif axis == "y":
            A.append((cx + c * r, cy, cz + s * r)); B.append((cx + c * r2, cy + h, cz + s * r2))
        else:
            A.append((cx, cy + c * r, cz + s * r)); B.append((cx + h, cy + c * r2, cz + s * r2))
    a = mb.verts(A)
    b = mb.verts(B)
    flip = axis == "y"
    for i in range(seg):
        j = (i + 1) % seg
        q = [a[i], a[j], b[j], b[i]]
        mb.face(q[::-1] if flip else q, mat)
    if cap:
        mb.face(a if flip else a[::-1], cap_mat or mat)
        if not open_top:
            mb.face(b[::-1] if flip else b, cap_mat or mat)


def prism(mb, poly2d, z0, z1, mat, side_mat=None, plane="xy", top=True, bottom=True, top_mat=None):
    """Призма из 2D-полигона (против часовой). plane xy: (x,y), высота по z; xz: (x,z), глубина по y; yz: (y,z) по x."""
    def P(u, v, w):
        if plane == "xy":
            return (u, v, w)
        if plane == "xz":
            return (u, w, v)
        return (w, u, v)
    n = len(poly2d)
    a = mb.verts([P(u, v, z0) for u, v in poly2d])
    b = mb.verts([P(u, v, z1) for u, v in poly2d])
    flip = plane == "xz"
    for i in range(n):
        j = (i + 1) % n
        q = [a[i], a[j], b[j], b[i]]
        mb.face(q[::-1] if flip else q, side_mat or mat)
    if bottom:
        mb.face(a if flip else a[::-1], mat)
    if top:
        mb.face(b[::-1] if flip else b, top_mat or mat)


def tube(mb, pts, r, mat, seg=8):
    """Труба по ломаной (без торцов)."""
    rings = []
    for k, p in enumerate(pts):
        p = Vector(p)
        d = (Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        w = d.cross(u).normalized()
        rings.append(mb.verts([p + (u * math.cos(2 * math.pi * i / seg) + w * math.sin(2 * math.pi * i / seg)) * r for i in range(seg)]))
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            mb.face([a[i], a[j], b[j], b[i]], mat)


def beam(mb, p0, p1, w, h, mat, up=(0, 0, 1)):
    """Балка прямоугольного сечения между точками (w — ширина поперёк, h — по up)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    upv = Vector(up)
    if abs(d.dot(upv)) > 0.95:
        upv = Vector((1, 0, 0))
    s = d.cross(upv).normalized() * (w / 2)
    t = d.cross(s).normalized() * (h / 2)
    c = [p0 - s - t, p0 + s - t, p0 + s + t, p0 - s + t, p1 - s - t, p1 + s - t, p1 + s + t, p1 - s + t]
    v = mb.verts(c)
    for q in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)):
        mb.face([v[i] for i in q], mat)


# ---------------------------------------------------------------- 2D
def clip_poly(poly, x0, x1, y0, y1):
    """Отсечение полигона прямоугольником (Сазерленд–Ходжман)."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out

    def ix(xv):
        return lambda a, b: (xv, a[1] + (b[1] - a[1]) * (xv - a[0]) / ((b[0] - a[0]) or 1e-9))

    def iy(yv):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (yv - a[1]) / ((b[1] - a[1]) or 1e-9), yv)

    p = list(poly)
    for ins, inter in ((lambda q: q[0] >= x0, ix(x0)), (lambda q: q[0] <= x1, ix(x1)),
                       (lambda q: q[1] >= y0, iy(y0)), (lambda q: q[1] <= y1, iy(y1))):
        if not p:
            return []
        p = clip(p, ins, inter)
    # убрать дубли
    out = []
    for q in p:
        if not out or abs(q[0] - out[-1][0]) > 1e-6 or abs(q[1] - out[-1][1]) > 1e-6:
            out.append(q)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out if len(out) >= 3 else []


def area2(poly):
    return sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly))) / 2
