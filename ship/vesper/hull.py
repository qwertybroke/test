# Корпус VESPER Explorer — единая оболочка.
# Наружная поверхность строится лофтом профиля по шпангоутам. Фаски — парные линии на рёбрах профиля,
# швы — V-канавки (средняя линия тройки утоплена), окна и остекление — проёмы с откосами до внутренней обшивки.
import math
import bisect
from . import layout as L
from .geo import MB, beam

GROOVE_W = 0.04     # полуширина канавки шва
GROOVE_D = 0.035    # глубина канавки
CH = 0.07           # фаска на рёбрах корпуса
SHAPE_KEYS = ("W", "zK", "wK", "zL", "zSh", "wT", "zT")


# ------------------------------------------------------------------ профиль
def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _along(a, b, d):
    dx, dz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dz) or 1.0
    return (a[0] + dx / l * d, a[1] + dz / l * d)


def profile_points(p, inner=False):
    """Полупрофиль (x ≥ 0) снизу вверх: список (имя, x, z)."""
    W, zK, wK, zL, zSh, wT, zT = (p[k] for k in SHAPE_KEYS)
    sh = p["sh"]
    d = 0.0 if inner else p["belt"]
    wz = lambda z: L.wall_z(p, z)
    f = (zL - zK) / 3.6
    zb0 = wz(L.Z_BELT[0])
    wallx = lambda zz: W if zz >= zb0 else W - 0.9 * f * (zb0 - zz) / max(zb0 - zL, 1e-6)
    spB = min(L.SPINE_W + L.SPINE_SLOPE, 0.77 * wT)
    sw = spB - max(0.3, L.SPINE_SLOPE * sh / L.SPINE_H)
    K = {
        "K0": (0.0, zK), "K1": (wK, zK), "K2": (wK + 0.6, zK + 0.4), "K3": (W - 2.6 * f, zL - 1.9 * f), "K4": (W - 0.9 * f, zL),
        "K5": (W, zSh), "K6": (wT, zT), "K7": (spB, zT), "K8": (sw, zT + sh), "K9": (0.0, zT + sh),
    }
    out = []

    def P(name, pt):
        out.append((name, pt[0], pt[1]))

    def C(name, prev, nxt):
        P(name + "a", _along(K[name], K[prev], CH))
        P(name + "b", _along(K[name], K[nxt], CH))

    def G(name, a, b, t):
        """Тройка линий шва на отрезке a→b в доле t."""
        c = _lerp(a, b, t)
        P(name + "_lo", _along(c, a, GROOVE_W))
        P(name, c)
        P(name + "_hi", _along(c, b, GROOVE_W))

    def Wz(name, z, x=None):
        P(name, (wallx(wz(z)) if x is None else x, wz(z)))

    P("K0", K["K0"])
    G("ventral", K["K0"], K["K1"], 0.5)
    C("K1", "K0", "K2")
    C("K2", "K1", "K3")
    G("kf", K["K2"], K["K3"], 0.45)
    P("ks_lo", _lerp(K["K2"], K["K3"], 0.78))
    P("ks_hi", _lerp(K["K2"], K["K3"], 0.84))
    C("K3", "K2", "K4")
    C("K4", "K3", "K5")
    Wz("rowC_lo", L.ROW["C"][0])
    Wz("rowC_hi", L.ROW["C"][1])
    z = L.Z_HSEAM[0]
    Wz("hs1_lo", z - GROOVE_W); Wz("hs1", z); Wz("hs1_hi", z + GROOVE_W)
    Wz("bs_lo", -1.97); Wz("bs_hi", -1.83)
    b0, b1 = L.Z_BELT
    Wz("belt_o0", b0)
    Wz("belt_i0", b0 + max(d, 0.05), W - d)
    Wz("rowB_lo", L.ROW["B"][0], W - d)
    Wz("rowB_hi", L.ROW["B"][1], W - d)
    Wz("belt_i1", b1 - max(d, 0.05), W - d)
    Wz("belt_o1", b1)
    z = L.Z_HSEAM[1]
    Wz("hs2_lo", z - GROOVE_W); Wz("hs2", z); Wz("hs2_hi", z + GROOVE_W)
    dA = 0.0 if inner else p["beltA"]
    a0, a1 = L.Z_BELT_A
    Wz("beltA_o0", a0)
    Wz("beltA_i0", a0 + max(dA, 0.05), W - dA)
    Wz("rowA_lo", L.ROW["A"][0], W - dA)
    Wz("rowA_hi", L.ROW["A"][1], W - dA)
    Wz("beltA_i1", a1 - max(dA, 0.05), W - dA)
    Wz("beltA_o1", a1)
    C("K5", "K4", "K6")
    G("shg", K["K5"], K["K6"], 0.5)
    C("K6", "K5", "K7")
    G("topg", K["K6"], K["K7"], 0.5)
    C("K7", "K6", "K8")
    P("rowS_lo", _lerp(K["K7"], K["K8"], 0.22))
    P("rowS_hi", _lerp(K["K7"], K["K8"], 0.84))
    C("K8", "K7", "K9")
    G("spg", K["K8"], K["K9"], 0.55)
    P("K9", K["K9"])
    return out


NAMES = [n for n, _, _ in profile_points(L.params(0.0))]
IDX = {n: i for i, n in enumerate(NAMES)}
NH = len(NAMES)          # точек в полупрофиле
NR = 2 * NH - 2          # точек в кольце


def ring_index(j, side):
    """Полупрофильный индекс → индекс кольца. side = +1 (правый борт, +X) или −1."""
    return j if side > 0 else (NR - j) % NR


# Пояса профиля для вертикальных швов: (группа, первая линия, последняя линия)
GROUPS = [
    ("keel_bot", "K0", "K1a"), ("kf1", "K2b", "kf_lo"), ("kf2", "kf_hi", "K3a"), ("k3", "K3b", "K4a"),
    ("wall_lo", "K4b", "hs1_lo"), ("belt", "hs1_hi", "hs2_lo"), ("wall_hi", "hs2_hi", "K5a"),
    ("sh1", "K5b", "shg_lo"), ("sh2", "shg_hi", "K6a"), ("top1", "K6b", "topg_lo"), ("top2", "topg_hi", "K7a"),
    ("sp_side", "K7b", "K8a"), ("sp_top", "K8b", "spg_lo"),
]
H_GROOVES = ["ventral", "kf", "hs1", "hs2", "shg", "topg", "spg"]
ROW_LINES = {"A": ("rowA_lo", "rowA_hi"), "B": ("rowB_lo", "rowB_hi"), "C": ("rowC_lo", "rowC_hi"), "S": ("rowS_lo", "rowS_hi")}
ROW_GROUP = {"A": "wall_hi", "B": "belt", "C": "wall_lo", "S": "sp_side"}


# ------------------------------------------------------------------ шпангоуты
SHAPE_Y = [L.Y_NOSE] + L.CANOPY_Y + [-30.0]


def shape_params(y):
    """Форма в носу — линейно между шпангоутами остекления (гранёный нос), остальное — точно."""
    p = L.params(y)
    if y < SHAPE_Y[-1]:
        k = max(1, bisect.bisect_right(SHAPE_Y, y))
        k = min(k, len(SHAPE_Y) - 1)
        ya, yb = SHAPE_Y[k - 1], SHAPE_Y[k]
        t = (y - ya) / (yb - ya)
        pa, pb = L.params(ya), L.params(yb)
        for key in SHAPE_KEYS:
            p[key] = pa[key] + (pb[key] - pa[key]) * t
    return p


def nudge(y, spans, gap=0.35):
    for a, b in spans:
        if a - gap < y < b + gap:
            return a - gap if (y - a) < (b - y) else b + gap
    return y


def build_stations():
    ys = set(SHAPE_Y + [L.Y_STERN, -30.5])
    for _row, a, b, _s in L.WINDOWS:
        ys.update((a, b))
    for a, b in L.BELT_A:
        ys.update((a, a + 0.3, b - 0.3, b))
    for a, b in L.BELT:
        ys.update((a, a + 0.35, b - 0.35, b))
    ys.update(L.SPINE_Y)
    ys.update((-22.6, -22.35))      # световая полоса на «козырьке» хребта
    for a, b in L.DARK_FRAMES + L.STRIPS_BELT + L.STRIPS_KEEL:
        ys.update((a, b))
    ys.update(AIRLOCK)
    seams = {}
    for g, lst in L.SEAMS.items():
        spans = [(a, b) for row, a, b, _s in L.WINDOWS if ROW_GROUP[row] == g]
        spans += [AIRLOCK] if g == "wall_lo" else []
        out = []
        for y in lst:
            y = nudge(y, spans)
            if L.Y_NOSE + 0.5 < y < L.Y_STERN - 0.5:
                out.append(y)
                ys.update((y - GROOVE_W, y, y + GROOVE_W))
        seams[g] = out
    ys = sorted(ys)
    # дробим длинные пролёты
    full = []
    for a, b in zip(ys, ys[1:]):
        full.append(a)
        n = int((b - a) / 2.0)
        for k in range(1, n + 1):
            full.append(a + (b - a) * k / (n + 1))
    full.append(ys[-1])
    merged = []
    for y in full:
        if not merged or y - merged[-1] > 0.012:
            merged.append(y)
    return merged, seams


AIRLOCK = (-36.4, -33.6)   # наружная дверь шлюза C-01 (правый борт)


# ------------------------------------------------------------------ сборка
class Hull:
    def __init__(self):
        self.st, self.seams = build_stations()
        self.S = len(self.st)
        self.half = []     # полупрофили наружные (x, z)
        self.ihalf = []    # внутренние
        for y in self.st:
            p = shape_params(y)
            self.half.append([(x, z) for _, x, z in profile_points(p)])
            self.ihalf.append(_offset([(x, z) for _, x, z in profile_points(p, inner=True)], L.SHELL, p))

    def si(self, y):
        k = min(range(self.S), key=lambda i: abs(self.st[i] - y))
        assert abs(self.st[k] - y) < 0.02, (y, self.st[k])
        return k

    # точка кольца (x, y, z)
    def O(self, s, r):
        j = r if r < NH else NR - r
        x, z = self.half[s][j]
        return (x if r < NH else -x, self.st[s], z)

    def I(self, s, r):
        j = r if r < NH else NR - r
        x, z = self.ihalf[s][j]
        return (x if r < NH else -x, self.st[s], z)

    def inner_halfwidth(self, y, z):
        """Полуширина внутренней обшивки на высоте z в сечении y (линейно между шпангоутами)."""
        k = bisect.bisect_right(self.st, y)
        k = min(max(k, 1), self.S - 1)
        ya, yb = self.st[k - 1], self.st[k]
        t = 0 if yb == ya else min(1, max(0, (y - ya) / (yb - ya)))
        return _hw(self.ihalf[k - 1], z) * (1 - t) + _hw(self.ihalf[k], z) * t

    def outer_x(self, y, z):
        """Полуширина наружной поверхности (без канавок) на высоте z в сечении y."""
        k = bisect.bisect_right(self.st, y)
        k = min(max(k, 1), self.S - 1)
        ya, yb = self.st[k - 1], self.st[k]
        t = 0 if yb == ya else min(1, max(0, (y - ya) / (yb - ya)))
        return _hw(self.half[k - 1], z) * (1 - t) + _hw(self.half[k], z) * t

    def inner_section(self, y):
        """Полный внутренний контур сечения y (x, z), против часовой."""
        k = bisect.bisect_right(self.st, y)
        k = min(max(k, 1), self.S - 1)
        ya, yb = self.st[k - 1], self.st[k]
        t = 0 if yb == ya else min(1, max(0, (y - ya) / (yb - ya)))
        h = [(a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t) for a, b in zip(self.ihalf[k - 1], self.ihalf[k])]
        full = h + [(-x, z) for x, z in reversed(h[1:-1])]
        return full

    # -------------------------------------------------------------- проёмы
    def openings(self):
        ops = []
        for row, a, b, sides in L.WINDOWS:
            lo, hi = ROW_LINES[row]
            for sd in sides:
                side = 1 if sd == "S" else -1
                ops.append(dict(kind="window", row=row, s0=self.si(a), s1=self.si(b), j0=IDX[lo], j1=IDX[hi], side=side))
        ops.append(dict(kind="door", row="D", s0=self.si(AIRLOCK[0]), s1=self.si(AIRLOCK[1]), j0=IDX["K4b"], j1=IDX["hs1_lo"], side=1))
        # остекление мостика: боковые панорамы (до верхнего ребра) и лобовое стекло через верх в носовых пролётах
        c0, c1 = self.si(L.CANOPY_Y[0]), self.si(L.CANOPY_Y[-1])
        cf = self.si(L.CANOPY_Y[2])
        for side in (1, -1):
            ops.append(dict(kind="canopy", row="X", s0=c0, s1=c1, j0=IDX["rowA_lo"], j1=IDX["K6a"], side=side))
        ops.append(dict(kind="canopy", row="X", s0=c0, s1=cf, j0=IDX["K6a"], j1=None, side=0))
        for o in ops:
            if o["kind"] == "canopy" and o["side"] == 0:
                o["r0"], o["r1"] = o["j0"], NR - o["j0"]
            elif o["side"] > 0:
                o["r0"], o["r1"] = o["j0"], o["j1"]
            else:
                o["r0"], o["r1"] = NR - o["j1"], NR - o["j0"]
        return ops

    # -------------------------------------------------------------- геометрия
    def build(self, region_mat):
        """region_mat(x, y, z) → материал внутренней обшивки. Возвращает (outer MB, glass MB, frames MB)."""
        S, st = self.S, self.st
        ops = self.openings()
        cell_op = {}
        protect = set()
        for k, o in enumerate(ops):
            for s in range(o["s0"], o["s1"]):
                for r in range(o["r0"], o["r1"]):
                    cell_op[(s, r)] = k
            for s in range(o["s0"], o["s1"] + 1):
                for r in range(o["r0"], o["r1"] + 1):
                    protect.add((s, r))

        # --- смещения канавок (вдоль нормали профиля, внутрь)
        push = {}

        def add_push(s, j, side):
            r = ring_index(j, side)
            if (s, r) not in protect:
                push[(s, r)] = GROOVE_D

        for g in H_GROOVES:
            j = IDX[g]
            for s in range(S):
                add_push(s, j, 1)
                add_push(s, j, -1)
        gidx = {g: (IDX[a], IDX[b]) for g, a, b in GROUPS}
        for g, ys in self.seams.items():
            ja, jb = gidx[g]
            for y in ys:
                s = self.si(y)
                for j in range(ja, jb + 1):
                    add_push(s, j, 1)
                    add_push(s, j, -1)

        def nrm(s, j):
            h = self.half[s]
            a = h[j - 1] if j > 0 else (-h[1][0], h[1][1])
            b = h[j + 1] if j < NH - 1 else (-h[NH - 2][0], h[NH - 2][1])
            tx, tz = b[0] - a[0], b[1] - a[1]
            l = math.hypot(tx, tz) or 1
            return (tz / l, -tx / l)   # наружу

        mb = MB("Hull")
        OV = [[0] * NR for _ in range(S)]
        IV = [[0] * NR for _ in range(S)]
        for s in range(S):
            for r in range(NR):
                x, y, z = self.O(s, r)
                dpt = push.get((s, r), 0.0)
                if dpt:
                    j = r if r < NH else NR - r
                    nx, nz = nrm(s, j)
                    if r >= NH:
                        nx = -nx
                    x -= nx * dpt
                    z -= nz * dpt
                OV[s][r] = mb.vert((x, y, z))
                IV[s][r] = mb.vert(self.I(s, r))
        self.OV, self.IV = OV, IV

        # --- материалы наружных граней
        rnd = _Rand(42)
        panel_mat = {}

        def group_of(j):
            for g, (ja, jb) in gidx.items():
                if ja <= j < jb:
                    return g
            return None

        def outer_mat(s, j):
            y = (st[s] + st[s + 1]) / 2
            n = NAMES
            jn = j
            if jn < IDX["K1b"]:
                return "M_Hull_Dark"
            if jn < IDX["K4a"]:
                if jn == IDX["ks_lo"] and any(a <= y <= b for a, b in L.STRIPS_KEEL):
                    return "M_Strip_Ext"
                return "M_Hull_Dark"
            if jn == IDX["bs_lo"] and any(a <= y <= b for a, b in L.STRIPS_BELT):
                return "M_Strip_Ext"
            dark_frame = any(a <= y <= b for a, b in L.DARK_FRAMES)
            if IDX["belt_o0"] <= jn < IDX["belt_o1"]:
                p0, p1 = shape_params(st[s])["belt"], shape_params(st[s + 1])["belt"]
                return "M_Hull_Dark" if (p0 > 0 or p1 > 0) else "M_Hull_Mid"
            if IDX["beltA_o0"] <= jn < IDX["beltA_o1"]:
                p0, p1 = shape_params(st[s])["beltA"], shape_params(st[s + 1])["beltA"]
                if p0 > 0 or p1 > 0:
                    return "M_Hull_Dark"
            if IDX["K4b"] <= jn < IDX["belt_o0"] and not dark_frame:
                ys = self.seams.get("wall_lo", [])
                key = ("lo", bisect.bisect_right(ys, y))
                if key not in panel_mat:
                    panel_mat[key] = "M_Hull_Dark" if rnd() < 0.5 else "M_Hull_Light"
                return panel_mat[key]
            if jn < IDX["K5b"]:
                if dark_frame:
                    return "M_Hull_Dark"
            if IDX["K7b"] <= jn < IDX["K8a"]:
                if -22.6 <= y <= -22.35:
                    return "M_Strip_Ext"
                if shape_params(y)["sh"] > 0.05:
                    return "M_Hull_Dark"
            if IDX["K8b"] <= jn and -22.6 <= y <= -22.35:
                return "M_Strip_Ext"
            g = group_of(jn)
            if g in ("wall_hi", "wall_lo", "sh1", "sh2", "top1", "top2", "sp_top"):
                ys = self.seams.get(g, [])
                pi = bisect.bisect_right(ys, y)
                key = (g, pi)
                if key not in panel_mat:
                    v = rnd()
                    top = g.startswith(("top", "sh", "sp"))
                    panel_mat[key] = "M_Hull_Mid" if (top and v < 0.16) or v < 0.05 else (
                        "M_Hull_Dark" if top and v > 0.93 else "M_Hull_Light")
                return panel_mat[key]
            return "M_Hull_Light"

        # --- наружная и внутренняя поверхности
        for s in range(S - 1):
            ym = (st[s] + st[s + 1]) / 2
            for r in range(NR):
                r1 = (r + 1) % NR
                if (s, r) in cell_op:
                    continue
                j = r if r < NH - 1 else NR - r - 1
                mb.face([OV[s][r], OV[s + 1][r], OV[s + 1][r1], OV[s][r1]], outer_mat(s, j))
                pi = self.I(s, r)
                pj = self.I(s + 1, r1)
                cx, cz = (pi[0] + pj[0]) / 2, (pi[2] + pj[2]) / 2
                mb.face([IV[s][r1], IV[s + 1][r1], IV[s + 1][r], IV[s][r]], region_mat(cx, ym, cz))

        # --- откосы, рамы, стекло
        glass = MB("Windows_Glass")
        canopy_glass = MB("Cockpit_Glass")
        frames = MB("Window_Frames")
        TF = 0.16    # глубина рамы до стекла, м
        for o in ops:
            s0, s1, r0, r1 = o["s0"], o["s1"], o["r0"], o["r1"]
            loop = [(s, r0) for s in range(s0, s1)] + [(s1, r) for r in range(r0, r1)] + \
                   [(s, r1) for s in range(s1, s0, -1)] + [(s0, r) for r in range(r1, r0, -1)]
            F = {}

            def fpos(s, r):
                if (s, r) not in F:
                    a = mb.v[OV[s][r]]
                    b = mb.v[IV[s][r]]
                    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
                    l = math.sqrt(dx * dx + dy * dy + dz * dz) or 1
                    t = min(0.6, TF / l)
                    F[(s, r)] = mb.vert((a[0] + dx * t, a[1] + dy * t, a[2] + dz * t))
                return F[(s, r)]

            rev_in = "M_Frame_Dark" if o["kind"] != "window" else None
            for k in range(len(loop)):
                a, b = loop[k], loop[(k + 1) % len(loop)]
                fa, fb = fpos(*a), fpos(*b)
                # контур обходится против часовой (изнутри проёма), грани смотрят внутрь проёма
                mb.face([OV[a[0]][a[1] % NR], OV[b[0]][b[1] % NR], fb, fa], "M_Frame_Dark")
                ia, ib = IV[a[0]][a[1] % NR], IV[b[0]][b[1] % NR]
                pa = mb.v[ia]
                mat = rev_in or region_mat(pa[0] * 0.98, pa[1], pa[2])
                mb.face([fa, fb, ib, ia], mat)
            # заполнение
            for s in range(s0, s1):
                for r in range(r0, r1):
                    q = [mb.v[fpos(s, r)], mb.v[fpos(s + 1, r)], mb.v[fpos(s + 1, r + 1)], mb.v[fpos(s, r + 1)]]
                    if o["kind"] == "door":
                        mb.poly(q, "M_Door")
                    elif o["kind"] == "canopy":
                        canopy_glass.poly(q, "M_Glass_Canopy")
                    else:
                        glass.poly(q, "M_Glass_Window")
            if o["kind"] == "canopy":
                self._mullions(frames, o, mb, OV, fpos)
            if o["kind"] == "door":
                self._door_details(frames, o, mb, OV)
        self._caps(mb, OV, IV, region_mat)
        return mb, glass, canopy_glass, frames

    def _mullions(self, fr, o, mb, OV, fpos):
        """Импосты остекления мостика: по шпангоутам CANOPY_Y и по рёбрам профиля."""
        s0, s1, r0, r1 = o["s0"], o["s1"], o["r0"], o["r1"]

        def mid(s, r):
            a = mb.v[OV[s][r]]
            b = mb.v[fpos(s, r)]
            return tuple(a[i] * 0.4 + b[i] * 0.6 for i in range(3))

        for y in L.CANOPY_Y[1:-1]:
            s = self.si(y)
            if not (s0 < s < s1):
                continue
            for r in range(r0, r1):
                beam(fr, mid(s, r), mid(s, r + 1), 0.16, 0.26, "M_Frame_Dark", up=_up(mb, OV, s, r))
        lines = [ring_index(IDX["K5a"], o["side"])] if o["side"] else [NH - 1]
        for r in lines + [r0, r1]:
            for s in range(s0, s1):
                beam(fr, mid(s, r), mid(s + 1, r), 0.18, 0.26, "M_Frame_Dark", up=_up(mb, OV, s, r))
        for s in (s0, s1):
            for r in range(r0, r1):
                beam(fr, mid(s, r), mid(s, r + 1), 0.18, 0.26, "M_Frame_Dark", up=_up(mb, OV, s, r))

    def _door_details(self, fr, o, mb, OV):
        """Наружная дверь шлюза: полосы и поручень на створке."""
        y0, y1 = self.st[o["s0"]], self.st[o["s1"]]
        x = mb.v[OV[o["s0"]][o["j0"]]][0] - 0.16
        z0 = mb.v[OV[o["s0"]][o["j0"]]][2]
        z1 = mb.v[OV[o["s0"]][o["j1"]]][2]
        from .geo import box
        box(fr, x, y0 + 0.15, z0 + 0.15, x + 0.04, y1 - 0.15, z0 + 0.35, "M_Hazard")
        box(fr, x, (y0 + y1) / 2 - 0.03, z0 + 0.4, x + 0.05, (y0 + y1) / 2 + 0.03, z1 - 0.2, "M_Frame_Dark")
        box(fr, x, y1 - 0.45, z0 + 0.9, x + 0.12, y1 - 0.4, z0 + 1.5, "M_Metal_Brushed")

    def _caps(self, mb, OV, IV, region_mat):
        S = self.S
        # нос: два гранёных пояса и торец
        ring = [mb.v[OV[0][r]] for r in range(NR)]
        cx = 0.0
        cz = sum(p[2] for p in ring) / NR
        y0 = self.st[0]
        prev = OV[0]
        steps = [(0.97, -0.25, "M_Hull_Dark"), (0.84, -1.05, "M_Hull_Dark"), (0.8, -1.2, "M_Hull_Dark")]
        for sc, dy, m in steps:
            cur = [mb.vert((cx + (p[0] - cx) * sc, y0 + dy, cz + (p[2] - cz) * sc)) for p in ring]
            for r in range(NR):
                r1 = (r + 1) % NR
                mb.face([prev[r1], cur[r1], cur[r], prev[r]], m)
            prev = cur
        # плоский торцевой щит носа
        tip = mb.vert((0, y0 - 1.2, cz))
        for r in range(NR):
            mb.face([prev[(r + 1) % NR], tip, prev[r]], "M_Hull_Dark")
        self.nose = dict(y=y0 - 1.2, cz=cz, ring=[mb.v[i] for i in prev])
        # нос изнутри: переборка
        self._fan(mb, [IV[0][r] for r in range(NR)], reverse=False, mat="M_Wall_Panel")
        # корма: фаска, ступень и утопленный торец под двигатели
        ring = [mb.v[OV[S - 1][r]] for r in range(NR)]
        cz = sum(p[2] for p in ring) / NR
        y1 = self.st[S - 1]
        prev = OV[S - 1]
        steps = [(0.95, 0.35, "M_Hull_Dark"), (0.9, 0.35, "M_Hull_Dark"), (0.88, 0.1, "M_Metal_Dark")]
        for sc, dy, m in steps:
            cur = [mb.vert((p[0] * sc, y1 + dy, cz + (p[2] - cz) * sc)) for p in ring]
            for r in range(NR):
                r1 = (r + 1) % NR
                mb.face([prev[r], cur[r], cur[r1], prev[r1]], m)
            prev = cur
        c = mb.vert((0, y1 + 0.1, cz))
        for r in range(NR):
            mb.face([prev[r], c, prev[(r + 1) % NR]], "M_Metal_Dark")
        self._fan(mb, [IV[S - 1][r] for r in range(NR)], reverse=True, mat="M_Wall_Industrial")
        self.stern_z = cz
        self.stern_y = y1 + 0.1

    def _fan(self, mb, ring, reverse, mat):
        pts = [mb.v[i] for i in ring]
        c = mb.vert((0, pts[0][1], sum(p[2] for p in pts) / len(pts)))
        n = len(ring)
        for r in range(n):
            a, b = ring[r], ring[(r + 1) % n]
            mb.face([a, c, b] if not reverse else [b, c, a], mat)

    # -------------------------------------------------------------- коллайдер корпуса
    def collider(self):
        mb = MB("COL_Hull")
        keys = [k for k in range(self.S) if k % 6 == 0 or k == self.S - 1]
        sel = [IDX[n] for n in ("K0", "K1a", "K3a", "K4b", "K5a", "K6b", "K7b", "K8a", "K9")]
        rings = []
        for s in keys:
            h = [self.half[s][j] for j in sel]
            full = h + [(-x, z) for x, z in reversed(h[1:-1])]
            rings.append(mb.verts([(x, self.st[s], z) for x, z in full]))
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for r in range(n):
                r1 = (r + 1) % n
                mb.face([a[r], b[r], b[r1], a[r1]], "M_Hull_Dark")
        mb.face(rings[0], "M_Hull_Dark")
        mb.face(rings[-1][::-1], "M_Hull_Dark")
        return mb


def _up(mb, OV, s, r):
    a = mb.v[OV[s][r]]
    b = mb.v[OV[s][(r + 1) % NR]]
    c = mb.v[OV[min(s + 1, len(OV) - 1)][r]]
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    l = math.sqrt(sum(q * q for q in n)) or 1
    return tuple(q / l for q in n)


def _hw(half, z):
    best = 0.0
    for (x0, z0), (x1, z1) in zip(half, half[1:]):
        lo, hi = min(z0, z1), max(z0, z1)
        if lo - 1e-9 <= z <= hi + 1e-9:
            if abs(z1 - z0) < 1e-9:
                best = max(best, x0, x1)
            else:
                best = max(best, x0 + (x1 - x0) * (z - z0) / (z1 - z0))
    return best


def _offset(half, t, p):
    """Смещение полупрофиля внутрь на t (митра с ограничением)."""
    n = len(half)
    full = [(-half[1][0], half[1][1])] + half + [(-half[-2][0], half[-2][1])]
    out = []
    for i in range(n):
        a, c, b = full[i], full[i + 1], full[i + 2]
        # ищем ненулевые соседние отрезки
        k = i
        while math.hypot(c[0] - a[0], c[1] - a[1]) < 1e-4 and k > 0:
            k -= 1
            a = full[k]
        k = i + 2
        while math.hypot(b[0] - c[0], b[1] - c[1]) < 1e-4 and k < len(full) - 1:
            k += 1
            b = full[k]
        n1 = _seg_n(a, c)
        n2 = _seg_n(c, b)
        nx, nz = n1[0] + n2[0], n1[1] + n2[1]
        l = math.hypot(nx, nz) or 1
        nx, nz = nx / l, nz / l
        cosh = max(0.5, nx * n1[0] + nz * n1[1])
        d = t / cosh
        out.append((max(0.0, c[0] - nx * d), c[1] - nz * d))
    # хребет не опускаем ниже внутренней палубы
    zt = p["zT"] - t
    k7 = IDX["K7a"]
    out = [(x, max(z, zt) if j >= k7 else z) for j, (x, z) in enumerate(out)]
    # монотонность по z (полупрофиль идёт снизу вверх)
    for j in range(1, n):
        if out[j][1] < out[j - 1][1]:
            out[j] = (out[j][0], out[j - 1][1])
    return out


def _seg_n(a, b):
    tx, tz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(tx, tz) or 1
    return (tz / l, -tx / l)


class _Rand:
    def __init__(self, seed):
        self.s = seed

    def __call__(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF
