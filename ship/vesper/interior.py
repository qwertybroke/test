# Интерьер VESPER Explorer: перекрытия (по контуру внутренней обшивки), переборки с проёмами, двери,
# освещение и наполнение отсеков. Наружная стена каждого отсека — внутренняя обшивка корпуса (общая оболочка).
import math
from . import layout as L
from . import props as P
from .geo import MB, box, boxc, bbox, cyl, beam, prism, clip_poly
from .props import XF

WT = 0.16          # толщина переборки
DW, DH = L.DOOR_W, L.DOOR_H
LIVING = {"cabin", "captain", "briefing", "mess", "lounge", "medbay", "gym", "washroom", "laundry", "corridor",
          "skylounge", "obslounge", "stairhall", "stairhall_aft", "hydro"}


def side_range(side):
    return {"S": (L.CORR + WT / 2, 99.0), "P": (-99.0, -L.CORR - WT / 2), "F": (-99.0, 99.0), "C": (-L.CORR, L.CORR)}[side]


def rect_minus(x0, x1, y0, y1, holes):
    """Прямоугольник минус прямоугольные отверстия → список прямоугольников."""
    xs = sorted(set([x0, x1] + [h[0] for h in holes] + [h[1] for h in holes]))
    ys = sorted(set([y0, y1] + [h[2] for h in holes] + [h[3] for h in holes]))
    xs = [x for x in xs if x0 <= x <= x1]
    ys = [y for y in ys if y0 <= y <= y1]
    out = []
    for a, b in zip(xs, xs[1:]):
        # склеиваем по y полосы одной колонки
        run = None
        for c, d in zip(ys, ys[1:]):
            mx, my = (a + b) / 2, (c + d) / 2
            inside = any(h[0] <= mx <= h[1] and h[2] <= my <= h[3] for h in holes)
            if inside:
                if run:
                    out.append(run)
                run = None
            else:
                run = (a, b, run[2], d) if run else (a, b, c, d)
        if run:
            out.append(run)
    return out


class Interior:
    def __init__(self, H):
        self.H = H
        self.rooms = {r[0]: dict(code=r[0], name=r[1], deck=r[2], side=r[3], y0=r[4], y1=r[5], kind=r[6]) for r in L.ROOMS}
        self.mbs = {}           # код отсека → MB
        self.doors = []
        self.lights = []
        self.col_struct = MB("COL_Interior_Structure")
        self.col_furn = MB("COL_Interior_Furniture")
        self.sign_index = {r[0]: i for i, r in enumerate(L.ROOMS)}

    # ------------------------------------------------------------ утилиты
    def mb(self, code):
        if code not in self.mbs:
            r = self.rooms[code]
            self.mbs[code] = MB(f"{code}_{_slug(r['name'])}")
        return self.mbs[code]

    def hw(self, y, z):
        return self.H.inner_halfwidth(y, z) - 0.005

    def samples(self, y0, y1):
        ys = [y0] + [s for s in self.H.st if y0 < s < y1] + [y1]
        return ys

    def outline(self, x0, x1, y0, y1, z):
        ys = self.samples(y0, y1)
        right = [(min(x1, self.hw(y, z)), y) for y in ys]
        left = [(max(x0, -self.hw(y, z)), y) for y in reversed(ys)]
        pts = right + left
        out = []
        for p in pts:
            if not out or abs(p[0] - out[-1][0]) > 1e-5 or abs(p[1] - out[-1][1]) > 1e-5:
                out.append(p)
        return out if len(out) >= 3 and all(a[0] >= b[0] - 1e-6 for a, b in zip(right, left[::-1])) else []

    def floor(self, code, z, x0, x1, y0, y1, mat, holes=(), ceiling_mat=None, thick=0.0):
        m = self.mb(code)
        for a, b, c, d in rect_minus(x0, x1, y0, y1, list(holes)):
            poly = self.outline(a, b, c, d, z)
            if not poly:
                continue
            m.poly([(x, y, z) for x, y in poly], mat)
            if ceiling_mat:
                m.poly([(x, y, z - thick) for x, y in reversed(poly)], ceiling_mat)
            xs = [p[0] for p in poly]
            box(self.col_struct, min(xs), c, z - 0.25, max(xs), d, z, "M_Hull_Dark")

    def ceiling(self, code, z, x0, x1, y0, y1, mat, holes=()):
        m = self.mb(code)
        for a, b, c, d in rect_minus(x0, x1, y0, y1, list(holes)):
            poly = self.outline(a, b, c, d, z)
            if poly:
                m.poly([(x, y, z) for x, y in reversed(poly)], mat)

    def xwall(self, code, y, x0, x1, z0, z1, mat_neg, mat_pos, doors=(), t=WT, frame="M_Metal_Dark"):
        """Поперечная переборка в плоскости y по контуру сечения. doors: (xc, w, h, z_floor, kind, name)."""
        m = self.mb(code)
        sec = self.H.inner_section(y)
        cuts = sorted(doors, key=lambda d: d[0])
        xs = [x0]
        for d in cuts:
            xs += [d[0] - d[1] / 2, d[0] + d[1] / 2]
        xs.append(x1)
        pieces = []
        for k in range(0, len(xs) - 1):
            a, b = xs[k], xs[k + 1]
            if b - a < 1e-4:
                continue
            if k % 2 == 1:     # проём
                d = cuts[k // 2]
                pieces.append((a, b, max(z0, d[3] + d[2]), z1))
                if d[3] > z0 + 0.01:
                    pieces.append((a, b, z0, d[3]))
            else:
                pieces.append((a, b, z0, z1))
        for a, b, c, d in pieces:
            poly = clip_poly(sec, a, b, c, d)
            if not poly or d - c < 0.01:
                continue
            prism(m, poly, y - t / 2, y + t / 2, mat_neg, side_mat=frame, plane="xz", top_mat=mat_pos)
            xs_ = [p[0] for p in poly]
            zs_ = [p[1] for p in poly]
            box(self.col_struct, min(xs_), y - t / 2, min(zs_), max(xs_), y + t / 2, max(zs_), "M_Hull_Dark")
        for d in cuts:
            self._door(code, d, axis="x", pos=(d[0], y), t=t)

    def ywall(self, code, x, y0, y1, z0, z1, mat_neg, mat_pos, doors=(), t=WT, frame="M_Metal_Dark"):
        """Продольная стена в плоскости x. doors: (yc, w, h, z_floor, kind, name). mat_neg — сторона −X."""
        m = self.mb(code)
        cuts = sorted(doors, key=lambda d: d[0])
        ys = [y0]
        for d in cuts:
            ys += [d[0] - d[1] / 2, d[0] + d[1] / 2]
        ys.append(y1)
        for k in range(len(ys) - 1):
            a, b = ys[k], ys[k + 1]
            if b - a < 1e-4:
                continue
            segs = [(z0, z1)]
            if k % 2 == 1:
                d = cuts[k // 2]
                segs = [(d[3] + d[2], z1)] + ([(z0, d[3])] if d[3] > z0 + 0.01 else [])
            for c, e in segs:
                if e - c < 0.01:
                    continue
                box(m, x - t / 2, a, c, x + t / 2, b, e, frame, mats={"nx": mat_neg, "px": mat_pos})
                box(self.col_struct, x - t / 2, a, c, x + t / 2, b, e, "M_Hull_Dark")
        for d in cuts:
            self._door(code, d, axis="y", pos=(x, d[0]), t=t)

    def _door(self, code, d, axis, pos, t):
        xc, w, h, zf, kind, name = d
        m = self.mb(code)
        x, y = pos
        # наличник
        f = 0.08
        if axis == "x":
            box(m, x - w / 2 - f, y - t / 2 - 0.03, zf, x - w / 2, y + t / 2 + 0.03, zf + h + f, "M_Metal_Dark")
            box(m, x + w / 2, y - t / 2 - 0.03, zf, x + w / 2 + f, y + t / 2 + 0.03, zf + h + f, "M_Metal_Dark")
            box(m, x - w / 2, y - t / 2 - 0.03, zf + h, x + w / 2, y + t / 2 + 0.03, zf + h + f, "M_Metal_Dark")
            if kind != "arch":
                for s in (-1, 1):
                    box(m, x - 0.25, y + s * (t / 2 + 0.031) - 0.002, zf + h + 0.02, x + 0.25, y + s * (t / 2 + 0.031) + 0.002, zf + h + 0.06,
                        "M_Strip_Blue")
        else:
            box(m, x - t / 2 - 0.03, y - w / 2 - f, zf, x + t / 2 + 0.03, y - w / 2, zf + h + f, "M_Metal_Dark")
            box(m, x - t / 2 - 0.03, y + w / 2, zf, x + t / 2 + 0.03, y + w / 2 + f, zf + h + f, "M_Metal_Dark")
            box(m, x - t / 2 - 0.03, y - w / 2, zf + h, x + t / 2 + 0.03, y + w / 2, zf + h + f, "M_Metal_Dark")
            if kind != "arch":
                for s in (-1, 1):
                    box(m, x + s * (t / 2 + 0.031) - 0.002, y - 0.25, zf + h + 0.02, x + s * (t / 2 + 0.031) + 0.002, y + 0.25, zf + h + 0.06,
                        "M_Strip_Blue")
        if kind in ("door", "gate"):
            self.doors.append(dict(name=name, room=code, axis=axis, x=x, y=y, z=zf, w=w, h=h, t=0.06 if kind == "door" else 0.12, kind=kind))

    def place(self, code, fn, x, y, z, back="+y", *a, collide=True, **kw):
        m = self.mb(code)
        n0 = len(m.v)
        fn(XF(m, x, y, z, back), *a, **kw)
        if collide and len(m.v) > n0:
            vs = m.v[n0:]
            xs, ys, zs = [p[0] for p in vs], [p[1] for p in vs], [p[2] for p in vs]
            box(self.col_furn, min(xs), min(ys), min(zs), max(xs), max(ys), max(zs), "M_Hull_Dark")

    def light(self, code, x, y, z, power, color=(1.0, 0.85, 0.7), radius=0.1, rng=None):
        self.lights.append(dict(room=code, deck=self.rooms[code]["deck"], pos=(x, y, z), power=power, color=color,
                                radius=radius, range=rng or max(4.0, math.sqrt(power) * 0.9)))

    def sign(self, code, x, y, z, normal):
        """Табличка отсека (атлас Signs). normal: '+x', '-x', '+y', '-y'."""
        i = self.sign_index[code]
        cols, rows = 4, (len(L.ROOMS) + 3) // 4
        hpx = 1 << (rows * 128 - 1).bit_length()
        u0, u1 = (i % 4) / 4, (i % 4 + 1) / 4
        v1 = 1 - (i // 4) * 128 / hpx
        v0 = 1 - (i // 4 + 1) * 128 / hpx
        w, h = 0.9, 0.225
        m = self.mb(code)
        o = 0.012
        if normal == "+y":
            pts = [(x + w / 2, y + o, z), (x - w / 2, y + o, z), (x - w / 2, y + o, z + h), (x + w / 2, y + o, z + h)]
            m.poly(pts, "M_Signs", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        elif normal == "-y":
            pts = [(x - w / 2, y - o, z), (x + w / 2, y - o, z), (x + w / 2, y - o, z + h), (x - w / 2, y - o, z + h)]
            m.poly(pts, "M_Signs", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        elif normal == "+x":
            pts = [(x + o, y - w / 2, z), (x + o, y + w / 2, z), (x + o, y + w / 2, z + h), (x + o, y - w / 2, z + h)]
            m.poly(pts, "M_Signs", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        else:
            pts = [(x - o, y + w / 2, z), (x - o, y - w / 2, z), (x - o, y - w / 2, z + h), (x - o, y + w / 2, z + h)]
            m.poly(pts, "M_Signs", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    # ------------------------------------------------------------ материал внутренней обшивки по зоне
    def region_mat(self, x, y, z):
        if z > 7.0 and -21.0 < y < 31.8 and abs(x) < 6.6:
            return "M_Wall_Warm"
        best = None
        for r in self.rooms.values():
            if not (r["y0"] - 0.05 <= y <= r["y1"] + 0.05):
                continue
            f, c = L.DECK[r["deck"]]
            if r["kind"] == "bridge":
                f, c = 1.0, 9.0
            if not (f - 0.9 <= z <= c + 0.7):
                continue
            if r["side"] == "S" and x < 0 or r["side"] == "P" and x > 0 or r["side"] == "C":
                continue
            best = r
            break
        if best is None:
            return "M_Wall_Industrial"
        k = best["kind"]
        if k == "bridge":
            return "M_Wall_Panel"
        if k in ("cabin", "captain", "lounge", "mess", "obslounge", "briefing", "skylounge"):
            return "M_Wall_Warm"
        if k in LIVING:
            return "M_Wall_White"
        return "M_Wall_Industrial"

    # ------------------------------------------------------------ сборка
    def build(self):
        self.deck_a()
        self.sky_lounge()
        self.bow_lower()
        self.cores()
        self.halls()
        self.midcore()
        self.engineering()
        return self.mbs

    # ============================================================ палуба A
    def deck_a(self):
        zf, zc = L.DECK["A"]
        R = self.rooms
        cw = L.CORR
        # полы/потолки всех отсеков палубы A, кроме мостика
        holes_fore = [(2.85, 6.15, -29.4, -26.1), (-5.7, -2.3, -29.5, -26.0)]
        holes_aft = [(2.85, 6.15, 27.35, 30.65)]
        sky_hole = [(-4.65, -1.35, 27.35, 30.65)]
        for code, r in R.items():
            if r["deck"] != "A" or r["kind"] == "bridge":
                continue
            x0, x1 = side_range(r["side"])
            fm = {"mess": "M_Floor_Wood", "lounge": "M_Floor_Wood", "captain": "M_Floor_Wood", "cabin": "M_Floor_Wood",
                  "hydro": "M_Floor_Grate", "workshop": "M_Floor_Grate", "storage": "M_Floor_Deck", "gym": "M_Floor_Deck"}.get(r["kind"], "M_Floor_Deck")
            holes = holes_fore if code == "A-02" else holes_aft if code == "A-18" else []
            ch = sky_hole if code == "A-18" else []
            spans = [(-25.0, -2.0), (8.0, 27.0)] if code == "A-00" else [(r["y0"], r["y1"])]
            for a, b in spans:
                self.floor(code, zf, x0, x1, a, b, fm, holes=holes)
                self.ceiling(code, zc, x0, x1, a, b, "M_Ceiling", holes=ch)
        # коридор: продольные стены с дверями
        wm = "M_Wall_White"
        for s in (1, -1):
            doors_l, doors_r = [], []
            for code, r in R.items():
                if r["deck"] != "A" or r["side"] != ("S" if s > 0 else "P"):
                    continue
                yd = r["y0"] + 0.95 if r["kind"] == "cabin" else (r["y0"] + r["y1"]) / 2
                doors_l.append((yd, DW, DH, zf, "door", f"{code}"))
            segs = [(-25.0, -2.0), (8.0, 27.0)]
            for a, b in segs:
                ds = [d for d in doors_l if a < d[0] < b]
                warm = "M_Wall_Warm"
                self.ywall("A-00", s * cw, a, b, zf, zc, wm if s > 0 else warm, warm if s > 0 else wm, doors=ds)
        # поперечные стены между боковыми отсеками (каждая граница — один раз)
        done = set()
        for code, r in R.items():
            if r["deck"] != "A" or r["side"] not in "SP":
                continue
            s = 1 if r["side"] == "S" else -1
            x0, x1 = sorted((s * (cw + WT / 2), s * 11.0))
            for yy in (r["y0"], r["y1"]):
                if yy in (-25.0, -2.0, 8.0, 27.0, 40.0, 45.4) or (s, yy) in done:
                    continue
                done.add((s, yy))
                self.xwall(code, yy, x0, x1, zf, zc, "M_Wall_Warm", "M_Wall_Warm")
        # стены отсеков на всю ширину (y, проёмы)
        arch = lambda name: (0.0, 2 * cw, zc - zf - 0.6, zf, "arch", name)
        self.xwall("A-02", -30.5, -11, 11, zf, zc, "M_Wall_Panel", "M_Wall_White", doors=[(0.0, 1.6, DH, zf, "door", "A-01")])
        self.xwall("A-02", -25.0, -11, 11, zf, zc, "M_Wall_White", "M_Wall_Warm", doors=[arch("A-00_fore")])
        for yy, code in ((-2.0, "A-13"), (8.0, "A-13")):
            for s in (1, -1):
                x0, x1 = sorted((s * cw, s * 11.0))
                self.xwall(code, yy, x0, x1, zf, zc, "M_Wall_Warm", "M_Wall_Warm")
        for s in (1, -1):
            x0, x1 = sorted((s * cw, s * 11.0))
            self.xwall("A-18", 27.0, x0, x1, zf, zc, "M_Wall_White", "M_Wall_White")
        self.xwall("A-18", 31.0, -11, 11, zf, zc, "M_Wall_White", "M_Wall_White", doors=[(0.0, 1.8, DH, zf, "door", "A-19")])
        self.xwall("A-19", 40.0, -11, 11, zf, zc, "M_Wall_White", "M_Wall_Industrial",
                   doors=[(5.0, DW, DH, zf, "door", "A-20"), (-5.0, DW, DH, zf, "door", "A-21")])
        self.ywall("A-20", 0.0, 40.0, 45.4, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial")
        self.xwall("A-20", 45.4, -11, 11, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial")
        self.bridge()
        self.corridor_a()
        for code, r in R.items():
            if r["deck"] != "A":
                continue
            fn = getattr(self, "f_" + r["kind"], None)
            if fn:
                fn(code, r)

    def corridor_a(self):
        zf, zc = L.DECK["A"]
        code = "A-00"
        y = -24.0
        while y < 26.5:
            if not (-2.0 < y < 8.0):
                P.ceiling_panel(self.mb(code), 0, y, zc, 0.9, 1.2)
                if int(y) % 4 == 0:
                    self.light(code, 0, y, zc - 0.3, 60, (0.95, 0.95, 1.0))
            y += 2.5
        for s in (1, -1):
            for a, b in ((-25.0, -2.0), (8.0, 27.0)):
                box(self.mb(code), s * L.CORR - 0.03 * (1 if s > 0 else -1) - 0.01, a, zf + 0.08, s * L.CORR - 0.02 * (1 if s > 0 else -1), b, zf + 0.12, "M_Strip_Blue")
        for code_, r in self.rooms.items():
            if r["deck"] == "A" and r["side"] in "SP":
                s = 1 if r["side"] == "S" else -1
                yd = r["y0"] + 0.95 if r["kind"] == "cabin" else (r["y0"] + r["y1"]) / 2
                self.sign(code_, s * (L.CORR - WT / 2), yd + 1.15 * (1 if yd + 1.4 < r["y1"] else -1), zf + 1.5, "-x" if s > 0 else "+x")

    # ------------------------------------------------------------ мостик
    def bridge(self):
        code = "A-01"
        r = self.rooms[code]
        zf = L.DECK["A"][0]
        zp = 1.6
        y_pit, y_top = -41.5, -39.25
        self.floor(code, zf, -11, 11, y_top, r["y1"], "M_Floor_Deck")
        self.floor(code, zp, -11, 11, r["y0"], y_pit, "M_Floor_Deck")
        n = 9
        for k in range(n):
            ya = y_pit + (y_top - y_pit) * k / n
            yb = y_pit + (y_top - y_pit) * (k + 1) / n
            z = zp + (zf - zp) * (k + 1) / n
            self.floor(code, z, -11, 11, ya, yb, "M_Floor_Deck")
            m = self.mb(code)
            hw = self.hw(ya, z) - 0.01
            m.poly([(-hw, ya, z - (zf - zp) / n), (hw, ya, z - (zf - zp) / n), (hw, ya, z), (-hw, ya, z)], "M_Metal_Dark")
            box(m, -hw, ya - 0.005, z - 0.02, hw, ya + 0.04, z, "M_Strip_Blue")
        # передняя переборка под остеклением
        m = self.mb(code)
        self.xwall(code, r["y0"], -11, 11, zp - 2.0, zp + 0.6, "M_Wall_Panel", "M_Wall_Panel")
        # места пилотов
        for sx, i in ((-1.5, 0), (1.5, 2)):
            self.place(code, P.console, sx, -46.4, zp, "-y", 1.8, 0.9, si=i)
            self.place(code, P.pilot_seat, sx, -45.0, zp, "+y")
        self.place(code, P.console, 0, -47.2, zp, "-y", 1.0, 0.8, si=4)
        for sx in (-4.4, 4.4):
            self.place(code, P.console, sx, -44.0, zp, "-x" if sx < 0 else "+x", 1.6, 0.8, si=8 if sx < 0 else 10)
            self.place(code, P.pilot_seat, sx * 0.8, -44.0, zp, "+x" if sx < 0 else "-x", mat="M_Fabric_Navy")
        # капитанский уровень
        self.place(code, P.pilot_seat, 0, -36.2, zf, "+y", mat="M_Leather")
        self.place(code, P.holo_table, 0, -33.0, zf)
        for sx in (-1, 1):
            for yy, i in ((-37.4, 12), (-34.6, 14)):
                self.place(code, P.console, sx * 7.6, yy, zf, "+x" if sx > 0 else "-x", 2.2, 0.8, si=i)
                self.place(code, P.office_chair, sx * 6.7, yy, zf, collide=False)
            self.place(code, P.plant, sx * 8.6, -31.3, zf, seed=3 + sx)
        # обзорные экраны на задней стене
        mm = XF(m, 0, -30.62, zf, "+y")
        for k, i in enumerate((1, 3, 5)):
            P.screen(mm, -3.4 + k * 2.3, -1.6 + k * 2.3, 1.2, 2.3, 0.0, i)
        rg = XF(m, 0, -34.5, zf + 0.005)
        P.rug(rg, 5.0, 6.0, "M_Fabric_Navy")
        self.light(code, 0, -35.0, 6.2, 260, (0.8, 0.9, 1.0))
        self.light(code, 0, -44.5, 3.6, 200, (0.7, 0.85, 1.0))
        for sx in (-6.5, 6.5):
            self.light(code, sx, -36.0, 6.0, 120, (0.8, 0.9, 1.0))

    # ------------------------------------------------------------ жилые отсеки
    def _side(self, r):
        s = 1 if r["side"] == "S" else -1
        return s, (lambda b: b if b in ("+y", "-y") else ("+x" if (b == "+x") == (s > 0) else "-x"))

    def f_cabin(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        fab = ("M_Fabric_Navy", "M_Fabric_Green", "M_Fabric_Red", "M_Fabric_Blue")[int(abs(y0)) % 4]
        self.place(code, P.bed, s * 6.4, y1 - 0.08 - 1.05, zf, "+y", 1.6, 2.1, blanket=fab)
        self.place(code, P.wardrobe, s * 2.25, y1 - 0.4, zf, "+y", 1.2, 0.6)
        self.place(code, P.desk, s * 3.9, y0 + 0.42, zf, "-y", 1.3, 0.62, si=int(abs(y0)) % 16)
        self.place(code, P.armchair, s * 9.0, y0 + 1.0, zf, "-y", mat="M_Leather")
        self.place(code, P.coffee_table, s * 9.2, y0 + 2.1, zf, "+y", 0.6, 0.6, 0.45)
        self.place(code, P.plant, s * 9.9, y1 - 0.45, zf, seed=int(abs(y0)))
        self.place(code, P.rug, s * 6.2, (y0 + y1) / 2 - 0.4, zf + 0.004, "+y", 3.0, 2.2, fab, collide=False)
        self.place(code, P.floor_lamp, s * 8.2, y0 + 0.4, zf)
        m = self.mb(code)
        P.ceiling_panel(m, s * 5.6, (y0 + y1) / 2, zc, 1.6, 1.0, "M_Light_Warm")
        self.light(code, s * 5.6, (y0 + y1) / 2, zc - 0.4, 140)
        self.light(code, s * 8.5, y0 + 0.6, zf + 1.6, 35, rng=4)

    def f_captain(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        self.place(code, P.bed, s * 7.0, y1 - 0.08 - 1.1, zf, "+y", 2.0, 2.2, blanket="M_Fabric_Red")
        self.place(code, P.desk, s * 3.4, y0 + 0.45, zf, "-y", 1.8, 0.75, screens=2, si=6)
        self.place(code, P.bookshelf, s * 5.6, y0 + 0.2, zf, "-y", 1.8, 0.35, 2.4, seed=1)
        self.place(code, P.sofa, s * 7.6, y0 + 2.4, zf, "-y", 2.2, 0.9, mat="M_Leather")
        self.place(code, P.coffee_table, s * 7.6, y0 + 3.6, zf)
        self.place(code, P.armchair, s * 9.6, y0 + 3.6, zf, B("+x"), mat="M_Fabric_Beige")
        self.place(code, P.wardrobe, s * 2.3, y1 - 0.4, zf, "+y", 1.6, 0.6)
        self.place(code, P.rug, s * 7.6, y0 + 3.4, zf + 0.004, "+y", 3.2, 2.6, "M_Fabric_Red", collide=False)
        self.place(code, P.plant, s * 9.9, y0 + 0.5, zf, seed=8)
        self.place(code, P.floor_lamp, s * 9.8, y1 - 0.5, zf)
        m = self.mb(code)
        P.ceiling_panel(m, s * 5.5, (y0 + y1) / 2, zc, 2.0, 1.4, "M_Light_Warm")
        self.light(code, s * 5.5, (y0 + y1) / 2, zc - 0.4, 220)
        self.light(code, s * 8.0, y0 + 3.2, zf + 1.8, 60)

    def f_briefing(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        self.place(code, P.dining_table, s * 5.8, (y0 + y1) / 2 + 0.3, zf, 90, 4.2, 1.3, seats=10)
        m = self.mb(code)
        mm = XF(m, s * 5.8, y0 + 0.1, zf, "-y")
        P.screen(mm, -1.8, 1.8, 1.0, 3.0, -0.02, 9)
        self.place(code, P.plant, s * 9.8, y1 - 0.5, zf, seed=4)
        self.place(code, P.plant, s * 2.2, y1 - 0.5, zf, seed=5)
        P.ceiling_panel(m, s * 5.8, (y0 + y1) / 2, zc, 1.4, 4.0, "M_Light_White")
        self.light(code, s * 5.8, (y0 + y1) / 2, zc - 0.4, 220, (1.0, 0.95, 0.9))

    def f_mess(self, code, r):
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        # камбуз у кормовой стены левого борта, островок перед ним
        self.place(code, P.kitchen, -6.0, y1 - 0.4, zf, "+y", 5.2, 0.65)
        # обеденные столы у окон
        for yy in (y0 + 1.7, y0 + 5.0):
            self.place(code, P.dining_table, 7.3, yy, zf, 90, 2.0, 0.95, seats=6)
            P.pendant(self.mb(code), 7.3, yy, zc, 0.9, 0.3)
            self.light(code, 7.3, yy, zc - 1.2, 110)
        self.place(code, P.dining_table, -7.3, y0 + 1.7, zf, 90, 2.0, 0.95, seats=6)
        P.pendant(self.mb(code), -7.3, y0 + 1.7, zc, 0.9, 0.3)
        self.light(code, -7.3, y0 + 1.7, zc - 1.2, 110)
        # длинный общий стол по центру
        self.place(code, P.dining_table, 3.4, (y0 + y1) / 2, zf, 90, 4.0, 1.0, seats=8)
        for yy in (y0 + 3.4, y0 + 6.4):
            P.pendant(self.mb(code), 3.4, yy, zc, 0.9, 0.26)
        self.light(code, 3.4, (y0 + y1) / 2, zc - 1.2, 160)
        self.light(code, -6.0, y1 - 2.0, zc - 0.4, 180, (1.0, 0.92, 0.82))
        for x, y in ((10.0, y0 + 0.4), (-10.0, y0 + 0.4), (10.0, y1 - 0.4), (1.7, y1 - 0.4)):
            self.place(code, P.plant, x, y, zf, seed=int(x + y))
        self.place(code, P.rug, 7.3, (y0 + y1) / 2, zf + 0.004, 90, 6.8, 3.0, "M_Carpet", collide=False)
        m = self.mb(code)
        for yy in (y0 + 1.5, y0 + 5.0, y0 + 8.5):
            P.ceiling_panel(m, 0, yy, zc, 1.0, 1.4, "M_Light_Warm")
        self.sign(code, -3.0, y0 + 0.09, zf + 2.3, "+y")

    def f_lounge(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for k, x in enumerate((2.6, 4.6, 6.6)):
            self.place(code, P.bookshelf, s * x, y1 - 0.2, zf, "+y", 1.9, 0.35, 2.4, seed=k + 2)
        self.place(code, P.sofa, s * 6.6, y0 + 4.6, zf, "+y", 2.6, 0.9, mat="M_Fabric_Green")
        self.place(code, P.sofa, s * 6.6, y0 + 1.0, zf, "-y", 2.6, 0.9, mat="M_Fabric_Green")
        self.place(code, P.coffee_table, s * 6.6, y0 + 2.8, zf, "+y", 1.4, 0.7)
        self.place(code, P.armchair, s * 9.4, y0 + 2.8, zf, B("+x"), mat="M_Leather")
        self.place(code, P.armchair, s * 3.6, y0 + 2.8, zf, B("-x"), mat="M_Leather")
        self.place(code, P.rug, s * 6.6, y0 + 2.8, zf + 0.004, "+y", 4.6, 4.4, "M_Fabric_Red", collide=False)
        for y, k in ((y0 + 0.5, 0), (y1 - 1.5, 1)):
            self.place(code, P.floor_lamp, s * 9.9, y, zf)
        self.place(code, P.plant, s * 2.3, y0 + 0.5, zf, seed=21)
        # «камин»: экран с живым огнём на передней стене
        m = self.mb(code)
        mm = XF(m, s * 3.4, y0 + 0.1, zf, "-y")
        box(mm, -1.0, -0.25, 0, 1.0, 0.0, 0.4, "M_Wood_Dark")
        P.screen(mm, -0.8, 0.8, 0.5, 1.3, -0.12, 7)
        P.ceiling_panel(m, s * 6.0, (y0 + y1) / 2, zc, 1.4, 2.4, "M_Light_Warm")
        self.light(code, s * 6.0, (y0 + y1) / 2, zc - 0.4, 150)
        self.light(code, s * 9.6, y0 + 0.6, zf + 1.6, 50)
        self.light(code, s * 9.6, y1 - 1.5, zf + 1.6, 50)

    def f_medbay(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for yy in (y0 + 1.6, y0 + 4.4):
            self.place(code, P.med_bed, s * 7.6, yy, zf, B("+x"))
        for k in range(3):
            self.place(code, P.cabinet, s * (3.0 + k * 1.1), y1 - 0.3, zf, "+y", 1.0, 0.5, 2.0)
        self.place(code, P.desk, s * 3.2, y0 + 0.4, zf, "-y", 1.4, 0.65, si=6)
        self.place(code, P.plant, s * 9.9, y1 - 0.5, zf, seed=17)
        m = self.mb(code)
        P.ceiling_panel(m, s * 6.0, (y0 + y1) / 2, zc, 1.8, 3.0, "M_Light_White")
        self.light(code, s * 6.0, (y0 + y1) / 2, zc - 0.4, 260, (0.95, 0.97, 1.0))

    def f_gym(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for yy in (y0 + 1.5, y0 + 3.2):
            self.place(code, P.treadmill, s * 8.2, yy, zf, B("-x"))
        self.place(code, P.weight_bench, s * 5.0, y0 + 6.0, zf, "+y")
        self.place(code, P.weight_rack, s * 4.6, y1 - 0.4, zf, "+y")
        self.place(code, P.punching_bag, s * 8.0, y0 + 7.8, zf, "+y", zc - zf)
        for yy in (y0 + 5.0, y0 + 7.4):
            self.place(code, P.rug, s * 8.4, yy + 1.0, zf + 0.004, "+y", 1.8, 1.1, "M_Rubber", collide=False)
        m = self.mb(code)
        box(m, s * 1.37 if s > 0 else -1.39, y0 + 4.0, zf + 0.3, s * 1.39 if s > 0 else -1.37, y1 - 0.5, zf + 2.4, "M_Mirror")
        for yy in (y0 + 2.5, y0 + 6.0, y0 + 9.0):
            P.ceiling_panel(m, s * 6.0, yy, zc, 2.4, 0.6, "M_Light_White")
        self.light(code, s * 6.0, y0 + 3.0, zc - 0.4, 200, (0.95, 0.97, 1.0))
        self.light(code, s * 6.0, y0 + 8.0, zc - 0.4, 200, (0.95, 0.97, 1.0))

    def f_washroom(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for k in range(4):
            self.place(code, P.shower, s * 9.7, y0 + 0.8 + k * 1.15, zf, B("+x"))
        self.place(code, P.vanity, s * 5.0, y0 + 0.32, zf, "-y", 3.2)
        self.place(code, P.locker_row, s * 5.4, y1 - 0.3, zf, "+y", 3.0)
        box(self.mb(code), s * 4.0 - 0.8, (y0 + y1) / 2 - 0.2, zf, s * 4.0 + 0.8, (y0 + y1) / 2 + 0.2, zf + 0.45, "M_Wood")
        m = self.mb(code)
        P.ceiling_panel(m, s * 6.0, (y0 + y1) / 2, zc, 1.4, 2.4, "M_Light_White")
        self.light(code, s * 6.0, (y0 + y1) / 2, zc - 0.4, 160, (0.95, 0.97, 1.0))

    def f_laundry(self, code, r):
        s, B = self._side(r)
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for k in range(4):
            self.place(code, P.washer, s * (2.4 + k * 0.7), y1 - 0.35, zf, "+y")
        self.place(code, P.rack, s * 6.5, y1 - 0.35, zf, "+y", 2.4, 0.5, 2.2, seed=3)
        self.place(code, P.dining_table, s * 5.0, y0 + 2.2, zf, "+y", 1.8, 0.9, seats=0)
        self.place(code, P.plant, s * 9.9, y0 + 0.5, zf, seed=9)
        m = self.mb(code)
        P.ceiling_panel(m, s * 5.5, (y0 + y1) / 2, zc, 1.4, 2.0, "M_Light_White")
        self.light(code, s * 5.5, (y0 + y1) / 2, zc - 0.4, 140, (1.0, 0.95, 0.9))

    def f_stairhall_aft(self, code, r):
        zf, zc = L.DECK["A"]
        P.spiral_stair(self.mb(code), -3.0, 29.0, zf, L.DECK["S"][0], r=1.55)
        self.place(code, P.plant, 9.8, 27.5, zf, seed=31)
        self.place(code, P.plant, -9.8, 30.5, zf, seed=32)
        self.place(code, P.sofa, 8.6, 29.6, zf, "+x", 2.0, 0.85, mat="M_Fabric_Beige")
        m = self.mb(code)
        P.ceiling_panel(m, 0.5, 29.0, zc, 1.2, 1.2, "M_Light_Warm")
        self.light(code, 0.5, 29.0, zc - 0.4, 150)
        self.sign(code, 0.0, 30.92, zf + 2.4, "-y")

    def f_hydro(self, code, r):
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        m = self.mb(code)
        for k, x in enumerate((-6.6, -3.2, 3.2, 6.6)):
            self.place(code, P.planter, x, (y0 + y1) / 2 + 0.4, zf, "+y", 6.4, 1.0, seed=k * 11, z_ceil=zc - zf)
            self.light(code, x, (y0 + y1) / 2, zc - 1.0, 90, (1.0, 0.55, 0.9), rng=5)
        for x in (-9.6, 9.6):
            self.place(code, P.tank, x, y1 - 0.8, zf, "+y", 0.55, 2.2)
        self.place(code, P.sofa, 0.0, y0 + 0.9, zf, "-y", 2.0, 0.85, mat="M_Fabric_Green")
        for x in (-1.6, 1.6):
            self.place(code, P.plant, x, y0 + 0.6, zf, seed=int(x * 10) + 40, h=1.6, pot=0.32)
        P.ceiling_panel(m, 0.0, (y0 + y1) / 2, zc, 1.0, 6.0, "M_Light_White")
        self.light(code, 0.0, (y0 + y1) / 2, zc - 0.4, 180, (1.0, 0.97, 0.9))

    def f_workshop(self, code, r):
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        self.place(code, P.workbench, 4.6, y1 - 0.45, zf, "+y", 3.0)
        self.place(code, P.printer3d, 8.6, y1 - 0.8, zf, "+y")
        self.place(code, P.rack, 1.2 + 0.4, (y0 + y1) / 2, zf, "-x", 2.4, 0.6, 2.2, seed=5)
        self.place(code, P.office_chair, 4.6, y1 - 1.3, zf, collide=False)
        P.ceiling_panel(self.mb(code), 5.5, (y0 + y1) / 2, zc, 1.6, 2.0, "M_Light_White")
        self.light(code, 5.5, (y0 + y1) / 2, zc - 0.4, 200, (0.95, 0.97, 1.0))

    def f_storage(self, code, r):
        zf, zc = L.DECK["A"]
        y0, y1 = r["y0"], r["y1"]
        for k, x in enumerate((-2.0, -4.8, -7.6)):
            self.place(code, P.rack, x, (y0 + y1) / 2 + 0.6, zf, 90, 3.6, 0.7, 2.6, seed=k)
        P.ceiling_panel(self.mb(code), -5.0, (y0 + y1) / 2, zc, 1.0, 2.0, "M_Light_White")
        self.light(code, -5.0, (y0 + y1) / 2, zc - 0.4, 120, (0.95, 0.97, 1.0))

    def f_stairhall(self, code, r):
        pass

    # ============================================================ обзорный салон в хребте
    def sky_lounge(self):
        code = "S-01"
        r = self.rooms[code]
        zf, zc = L.DECK["S"]
        y0, y1 = r["y0"], r["y1"]
        xw = 5.55
        self.floor(code, zf, -xw, xw, y0, y1, "M_Floor_Wood", holes=[(-4.65, -1.35, 27.35, 30.65)], ceiling_mat=None)
        for s in (1, -1):
            x0 = s * xw
            self.ywall(code, x0, y0, y1, zf, zf + 1.3, "M_Wall_Warm" if s > 0 else "M_Wood_Dark", "M_Wood_Dark" if s > 0 else "M_Wall_Warm")
        self.xwall(code, y0, -xw, xw, zf, zc + 0.8, "M_Wall_Warm", "M_Wall_Warm")
        self.xwall(code, y1, -xw, xw, zf, zc + 0.8, "M_Wall_Warm", "M_Wall_Warm")
        m = self.mb(code)
        # группы диванов вдоль окон, столики, ковры, растения
        k = 0
        for yc in range(-16, 26, 7):
            for s in (1, -1):
                mat = ("M_Fabric_Beige", "M_Fabric_Blue", "M_Fabric_Green")[k % 3]
                self.place(code, P.sofa, s * 4.75, yc, zf, "+x" if s > 0 else "-x", 2.6, 0.85, mat=mat)
                self.place(code, P.coffee_table, s * 3.4, yc, zf, 90, 1.2, 0.6)
                self.place(code, P.armchair, s * 2.0, yc + (1.0 if k % 2 else -1.0), zf, "-x" if s > 0 else "+x", mat="M_Leather")
                self.place(code, P.rug, s * 3.6, yc, zf + 0.004, 90, 3.4, 2.6, "M_Carpet", collide=False)
                k += 1
            self.place(code, P.plant, 0.0, yc + 3.5, zf, seed=yc + 60, h=1.4, pot=0.3)
            P.pendant(m, 0.0, yc, zc, 0.6, 0.28)
            self.light(code, 0.0, yc, zc - 0.9, 120)
        # бар у кормовой лестницы
        self.place(code, P.kitchen, 3.0, 30.9, zf, "+y", 3.2, 0.6, island=False)
        # телескоп у носового торца
        mm = XF(m, 0, -19.6, zf)
        cyl(mm, 0, 0, 0, 0.35, 0.1, "M_Metal_Dark", seg=12)
        cyl(mm, 0, 0, 0.1, 0.05, 1.0, "M_Metal_Brushed", seg=8)
        beam(mm, (0, 0.4, 1.05), (0, -0.6, 1.55), 0.24, 0.24, "M_Plastic_White")
        self.place(code, P.bookshelf, -3.6, -20.4, zf, "-y", 2.0, 0.3, 1.2, seed=9)
        self.place(code, P.bookshelf, 3.6, -20.4, zf, "-y", 2.0, 0.3, 1.2, seed=10)
        for yy in range(-19, 31, 3):
            box(m, -0.6, yy, zc + 0.35, 0.6, yy + 0.06, zc + 0.4, "M_Strip_Warm")

    # ============================================================ нос: палубы B и C
    def bow_lower(self):
        # B-01 носовой салон
        code = "B-01"
        r = self.rooms[code]
        zf, zc = L.DECK["B"]
        y0, y1 = r["y0"], r["y1"]
        self.floor(code, zf, -11, 11, y0, y1, "M_Floor_Wood")
        self.ceiling(code, zc, -11, 11, y0, y1, "M_Ceiling")
        self.xwall(code, y0, -11, 11, zf, zc, "M_Wall_Warm", "M_Wall_Warm")
        self.xwall(code, y1, -11, 11, zf, zc, "M_Wall_Warm", "M_Wall_White", doors=[(0.0, 1.6, DH, zf, "door", "B-01")])
        m = self.mb(code)
        mm = XF(m, 0, y0 + 0.1, zf, "-y")
        P.screen(mm, -3.0, 3.0, 0.8, 3.0, -0.02, 15)
        for s in (1, -1):
            self.place(code, P.sofa, s * 6.8, y0 + 4.2, zf, "+x" if s > 0 else "-x", 3.2, 0.9, mat="M_Fabric_Navy")
            self.place(code, P.coffee_table, s * 5.2, y0 + 4.2, zf, 90, 1.4, 0.7)
            self.place(code, P.armchair, s * 3.4, y0 + 3.0, zf, "-x" if s > 0 else "+x", mat="M_Fabric_Beige")
            self.place(code, P.armchair, s * 3.4, y0 + 5.4, zf, "-x" if s > 0 else "+x", mat="M_Fabric_Beige")
            self.place(code, P.plant, s * 8.4, y0 + 7.8, zf, seed=50 + s)
            self.place(code, P.rug, s * 5.0, y0 + 4.2, zf + 0.004, 90, 4.2, 4.0, "M_Fabric_Red", collide=False)
            P.pendant(m, s * 5.2, y0 + 4.2, zc, 0.7, 0.3)
            self.light(code, s * 5.2, y0 + 4.2, zc - 1.0, 140)
        self.place(code, P.kitchen, 0.0, y1 - 0.4, zf, "+y", 3.0, 0.6, island=False)
        self.light(code, 0, y1 - 1.6, zc - 0.4, 120)
        # C-01 шлюз и стыковочный узел
        code = "C-01"
        r = self.rooms[code]
        zf, zc = L.DECK["C"]
        y0, y1 = r["y0"], r["y1"]
        self.floor(code, zf, -11, 11, y0, y1, "M_Floor_Grate")
        self.ceiling(code, zc, -11, 11, y0, y1, "M_Ceiling")
        self.xwall(code, y0, -11, 11, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial")
        self.xwall(code, y1, -11, 11, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial", doors=[(0.0, 1.6, DH, zf, "door", "C-01")])
        # шлюзовая камера у наружной двери правого борта
        self.ywall(code, 5.6, -37.2, -32.8, zf, zc, "M_Wall_Industrial", "M_Hazard", doors=[(-35.0, 1.5, DH, zf, "door", "C-01_inner")])
        self.xwall(code, -37.2, 5.6, 11, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial")
        self.xwall(code, -32.8, 5.6, 11, zf, zc, "M_Wall_Industrial", "M_Wall_Industrial")
        for k in range(4):
            self.place(code, P.eva_suit, -7.8 + k * 1.1, y0 + 0.45, zf, "-y")
        self.place(code, P.locker_row, -3.2, y0 + 0.3, zf, "-y", 2.4)
        self.place(code, P.locker_row, -7.2, y1 - 0.3, zf, "+y", 3.0, mat="M_Paint_Orange")
        box(self.mb(code), -1.6, -34.8, zf, 1.6, -34.4, zf + 0.45, "M_Metal_Dark")
        for yy in (-36.0, -33.0):
            self.light(code, 8.3, yy, zc - 0.3, 90, (1.0, 0.6, 0.3))
        self.light(code, -3.0, -34.5, zc - 0.3, 200, (0.95, 0.97, 1.0))
        P.ceiling_panel(self.mb(code), -3.0, -34.5, zc, 1.2, 3.0, "M_Light_White")
        P.ceiling_panel(self.mb(code), 8.3, -35.0, zc, 0.6, 2.0, "M_Strip_Orange")

    # ============================================================ стволы лестниц и лифт
    def cores(self):
        fore = (4.5, -27.75)
        aft = (4.5, 29.0)
        lift = (-5.7, -2.3, -29.5, -26.0)
        holes_f = [(2.85, 6.15, -29.4, -26.1), lift]
        holes_a = [(2.85, 6.15, 27.35, 30.65)]
        for code, holes, (sx, sy) in (("C-02", holes_f, fore), ("B-02", holes_f, fore), ("C-03", holes_a, aft), ("B-03", holes_a, aft)):
            r = self.rooms[code]
            zf, zc = L.DECK[r["deck"]]
            fh = [] if r["deck"] == "C" else holes
            self.floor(code, zf, -11, 11, r["y0"], r["y1"], "M_Floor_Deck", holes=fh)
            self.ceiling(code, zc, -11, 11, r["y0"], r["y1"], "M_Ceiling", holes=holes)
            m = self.mb(code)
            P.ceiling_panel(m, -0.5, (r["y0"] + r["y1"]) / 2, zc, 1.2, 1.2, "M_Light_White")
            self.light(code, -0.5, (r["y0"] + r["y1"]) / 2, zc - 0.4, 160, (0.95, 0.97, 1.0))
            self.sign(code, -1.0, r["y1"] - WT / 2 - 0.01, zf + 2.4, "-y")
        # винтовые лестницы через все палубы
        P.spiral_stair(self.mb("C-02"), *fore, L.DECK["C"][0], L.DECK["A"][0], r=1.55)
        P.spiral_stair(self.mb("C-03"), *aft, L.DECK["C"][0], L.DECK["A"][0], r=1.55)
        # перила вокруг проёмов
        for code, (x0, x1, y0, y1), zf in (("B-02", holes_f[0], L.DECK["B"][0]), ("A-02", holes_f[0], L.DECK["A"][0]),
                                          ("B-03", holes_a[0], L.DECK["B"][0]), ("A-18", holes_a[0], L.DECK["A"][0])):
            m = self.mb(code)
            P.railing(m, (x0, y1, zf), (x1, y1, zf), 1.05, "M_Metal_Brushed")
            P.railing(m, (x1, y0, zf), (x1, y1, zf), 1.05, "M_Metal_Brushed")
            P.railing(m, (x0, y0, zf), (x1 - 1.6, y0, zf), 1.05, "M_Metal_Brushed")
        m = self.mb("A-18")
        x0, x1, y0, y1 = (-4.65, -1.35, 27.35, 30.65)
        P.railing(m, (x0, y0, L.DECK["S"][0]), (x1, y0, L.DECK["S"][0]), 1.05, "M_Metal_Brushed")
        P.railing(m, (x1, y0, L.DECK["S"][0]), (x1, y1 - 1.6, L.DECK["S"][0]), 1.05, "M_Metal_Brushed")
        # шахта лифта: стеклянная, двери на каждой палубе со стороны +X
        m = self.mb("C-02")
        x0, x1, y0, y1 = lift
        z0, z1 = L.DECK["C"][0], L.DECK["A"][1]
        for yy in (y0, y1):
            box(m, x0, yy - 0.05, z0, x1, yy + 0.05, z1, "M_Metal_Dark")
        box(m, x0 - 0.05, y0, z0, x0 + 0.05, y1, z1, "M_Metal_Dark")
        for d in ("C", "B", "A"):
            zf = L.DECK[d][0]
            zn = L.DECK[d][1]
            for ya, yb in ((y0, (y0 + y1) / 2 - 0.65), ((y0 + y1) / 2 + 0.65, y1)):
                box(m, x1 - 0.05, ya, zf, x1 + 0.05, yb, zn, "M_Metal_Dark")
            box(m, x1 - 0.05, (y0 + y1) / 2 - 0.65, zf + DH, x1 + 0.05, (y0 + y1) / 2 + 0.65, zn, "M_Metal_Dark")
            self.doors.append(dict(name=f"Lift_{d}", room="C-02", axis="y", x=x1, y=(y0 + y1) / 2, z=zf, w=1.3, h=DH, t=0.05, kind="door"))
        # кабина на палубе B
        zb = L.DECK["B"][0]
        box(m, x0 + 0.1, y0 + 0.1, zb, x1 - 0.1, y1 - 0.1, zb + 0.08, "M_Floor_Deck")
        box(m, x0 + 0.1, y0 + 0.1, zb + 2.6, x1 - 0.1, y1 - 0.1, zb + 2.7, "M_Metal_Dark")
        box(m, x0 + 0.3, y0 + 0.3, zb + 2.59, x1 - 0.3, y1 - 0.3, zb + 2.6, "M_Light_White")

    # ============================================================ производственные цеха
    def halls(self):
        for code in ("H-01", "H-02"):
            self.hall(code)
        # торцевые переборки цехов (C+B): y = −25 (носовой ствол) и y = 27 (кормовой ствол)
        z0, z1 = L.DECK["H"]
        zb = L.DECK["B"][0]
        for yy, code, a, b in ((-25.0, "H-01", "M_Wall_Industrial", "M_Wall_Industrial"), (27.0, "H-02", "M_Wall_Industrial", "M_Wall_Industrial")):
            doors = [(0.0, 2.4, 2.8, z0, "door", f"{code}_main"), (9.15, DW, DH, zb, "door", f"{code}_gallery_S"),
                     (-9.15, DW, DH, zb, "door", f"{code}_gallery_P")]
            self.xwall(code, yy, -11, 11, z0, z1, a, b, doors=doors, t=0.3)

    def hall(self, code):
        r = self.rooms[code]
        z0, z1 = L.DECK["H"]
        zg = L.DECK["B"][0]
        y0, y1 = r["y0"], r["y1"]
        m = self.mb(code)
        self.floor(code, z0, -11, 11, y0, y1, "M_Floor_Hall")
        self.ceiling(code, z1, -11, 11, y0, y1, "M_Ceiling")
        gx = 7.9
        for s in (1, -1):
            # галерея вдоль борта на уровне палубы B
            xa, xb = sorted((s * gx, s * 11.0))
            self.floor(code, zg, xa, xb, y0 + 0.15, y1 - 0.15, "M_Floor_Grate", ceiling_mat="M_Metal_Dark", thick=0.12)
            xa2, xb2 = sorted((s * gx, s * (gx + 0.12)))
            box(m, xa2, y0 + 0.15, zg - 0.45, xb2, y1 - 0.15, zg, "M_Metal_Dark")
            P.railing(m, (s * gx, y0 + 0.2, zg), (s * gx, y1 - 0.2, zg), 1.1, "M_Paint_Yellow", post=2.0)
            # колонны: опоры галереи и подкрановых путей
            n = int((y1 - y0) / 4.0)
            for k in range(n + 1):
                yy = y0 + 0.4 + k * (y1 - y0 - 0.8) / n
                xc = s * (gx + 0.1)
                box(m, xc - 0.12, yy - 0.12, z0, xc + 0.12, yy + 0.12, z1, "M_Paint_Grey")
                box(m, xc - 0.16, yy - 0.16, z0, xc + 0.16, yy + 0.16, z0 + 0.6, "M_Hazard")
                beam(m, (xc, yy, zg - 1.2), (s * 10.2, yy, zg - 0.1), 0.12, 0.12, "M_Metal_Dark")
                box(self.col_struct, xc - 0.12, yy - 0.12, z0, xc + 0.12, yy + 0.12, z1, "M_Hull_Dark")
            # подкрановый путь
            box(m, s * 7.6 - 0.18, y0 + 0.2, 1.65, s * 7.6 + 0.18, y1 - 0.2, 1.95, "M_Paint_Yellow")
            # точки подключения под галереей (силовые/вода/данные)
            for k in range(n):
                yy = y0 + 2.4 + k * (y1 - y0 - 0.8) / n
                self.place(code, P.utility_pillar, s * (gx - 0.4), yy, z0, "+x" if s > 0 else "-x")
            # световая полоса под галереей
            xa3, xb3 = sorted((s * (gx + 0.2), s * (gx + 0.24)))
            box(m, xa3, y0 + 0.3, zg - 0.6, xb3, y1 - 0.3, zg - 0.55, "M_Strip_White")
        # мостовой кран
        yc = (y0 + y1) / 2 - 3.0
        box(m, -7.6, yc - 0.35, 1.95, 7.6, yc + 0.35, 2.35, "M_Paint_Yellow")
        for s in (1, -1):
            box(m, s * 7.6 - 0.3, yc - 1.2, 1.95, s * 7.6 + 0.3, yc + 1.2, 2.25, "M_Paint_Yellow")
        box(m, -0.9, yc - 0.6, 1.55, 0.9, yc + 0.6, 1.95, "M_Paint_Orange")
        for dx in (-0.25, 0.25):
            cyl(m, dx, yc, -2.0, 0.015, 3.55, "M_Metal_Dark", seg=4, cap=False)
        bbox(m, -0.4, yc - 0.25, -2.6, 0.4, yc + 0.25, -2.0, "M_Paint_Yellow", c=0.06)
        boxc(m, 0, yc, -2.85, 0.12, 0.08, 0.5, "M_Metal_Dark")
        # высокопролётные светильники
        for x in (-3.6, 3.6):
            yy = y0 + 2.0
            while yy < y1 - 1.0:
                P.ceiling_panel(m, x, yy, z1, 1.2, 0.8, "M_Light_White")
                yy += 4.0
            for yy in [y0 + 4.0 + k * 8.0 for k in range(int((y1 - y0 - 4.0) / 8.0) + 1)]:
                if yy < y1 - 1.0:
                    self.light(code, x, yy, z1 - 0.6, 1100, (0.95, 0.97, 1.0), rng=16)
        for s in (1, -1):
            for yy in [y0 + 3.0 + k * 6.0 for k in range(int((y1 - y0) / 6.0))]:
                self.light(code, s * 9.2, yy, zg + 2.4, 120, (1.0, 0.95, 0.88), rng=6)
        # стартовый инвентарь у входа: поддоны, ящики, тележка
        for k, (x, y) in enumerate(((-5.5, y0 + 1.4), (-4.0, y0 + 1.4), (5.0, y1 - 1.6), (6.2, y1 - 1.6))):
            self.place(code, P.pallet_stack, x, y, z0, "+y", 2 if k % 2 else 1)
        self.place(code, P.workbench, 0.0, y1 - 0.6 if code == "H-01" else y0 + 0.6, z0, "+y" if code == "H-01" else "-y", 2.4)
        # разметка рабочих зон: жёлтые рамки 8×8 м
        for xc in (-3.9, 3.9):
            for yc2 in ([y0 + 5.0 + k * 8.4 for k in range(3)] if code == "H-01" else [y0 + 4.5 + k * 8.0 for k in range(2)]):
                if yc2 + 4.0 > y1 - 0.5:
                    continue
                for a, b, c, d in ((xc - 3.6, xc + 3.6, yc2 - 3.6, yc2 - 3.5), (xc - 3.6, xc + 3.6, yc2 + 3.5, yc2 + 3.6),
                                   (xc - 3.6, xc - 3.5, yc2 - 3.6, yc2 + 3.6), (xc + 3.5, xc + 3.6, yc2 - 3.6, yc2 + 3.6)):
                    box(m, a, c, z0, b, d, z0 + 0.004, "M_Paint_Yellow")
        self.sign(code, -3.0, y0 + 0.16 if code == "H-01" else y1 - 0.16, z0 + 4.0, "+y" if code == "H-01" else "-y")

    # ============================================================ техузел миделя и пост управления
    def midcore(self):
        z0 = L.DECK["H"][0]
        zc0, zc1 = L.DECK["C"]
        zb0, zb1 = L.DECK["B"]
        gate_w, gate_h = 7.0, 3.9
        # ворота между цехами (y = 1 и y = 6) на уровне C, двери галерей и окна поста на уровне B
        for yy, code in ((1.0, "M-01"), (6.0, "M-01")):
            self.xwall(code, yy, -11, 11, z0, zc1, "M_Wall_Industrial", "M_Wall_Industrial",
                       doors=[(0.0, gate_w, gate_h, z0, "gate", f"Gate_{'1' if yy < 3 else '2'}")], t=0.4)
            P.gate_frame(self.mb(code), -gate_w / 2, gate_w / 2, z0, z0 + gate_h, yy, 0.44)
            self.xwall("M-02", yy, -11, 11, zb0 - 0.6, L.DECK["H"][1], "M_Wall_Industrial", "M_Wall_Industrial",
                       doors=[(9.15, DW, DH, zb0, "door", f"M-02_gallery_S_{int(yy)}"), (-9.15, DW, DH, zb0, "door", f"M-02_gallery_P_{int(yy)}"),
                              (0.0, 6.0, 1.9, zb0 + 0.9, "arch", "window")], t=0.3)
            # обзорное стекло поста управления
            m = self.mb("M-02")
            m.poly([(-3.0, yy, zb0 + 0.9), (3.0, yy, zb0 + 0.9), (3.0, yy, zb0 + 2.8), (-3.0, yy, zb0 + 2.8)], "M_Glass_Interior")
        code = "M-01"
        self.floor(code, z0, -11, 11, 1.0, 6.0, "M_Floor_Hall")
        self.ceiling(code, zc1, -11, 11, 1.0, 6.0, "M_Ceiling")
        for s in (1, -1):
            self.ywall(code, s * 3.6, 1.0, 6.0, z0, zc1, "M_Wall_Industrial", "M_Wall_Industrial",
                       doors=[(3.5, DW, DH, z0, "door", f"M-01_{'S' if s > 0 else 'P'}")])
        # правый борт — подстанция для производственных линий, левый — склад материалов
        for k in range(4):
            self.place(code, P.server_rack, 5.0 + k * 0.8, 5.5, z0, "+y")
            self.place(code, P.cabinet, 5.0 + k * 1.0, 1.4, z0, "-y", 0.9, 0.6, 1.9, mat="M_Paint_Grey")
        for k in range(2):
            self.place(code, P.rack, -5.6 - k * 2.6, 3.5, z0, 90, 3.6, 0.7, 2.4, seed=20 + k)
        for x in (-2.0, 2.0):
            self.light(code, x, 3.5, zc1 - 0.4, 300, (0.95, 0.97, 1.0))
            P.ceiling_panel(self.mb(code), x, 3.5, zc1, 0.8, 3.0, "M_Light_White")
        self.light(code, 7.0, 3.5, zc1 - 0.4, 120, (0.95, 0.97, 1.0))
        self.light(code, -7.0, 3.5, zc1 - 0.4, 120, (0.95, 0.97, 1.0))
        # пост управления цехами (палуба B)
        code = "M-02"
        self.floor(code, zb0, -11, 11, 1.0, 6.0, "M_Floor_Deck")
        self.ceiling(code, zb1, -11, 11, 1.0, 6.0, "M_Ceiling")
        for yy, back, i in ((1.6, "-y", 8), (5.4, "+y", 10)):
            for x in (-1.6, 1.6):
                self.place(code, P.console, x, yy, zb0, back, 1.5, 0.8, si=i + (1 if x > 0 else 0))
                self.place(code, P.office_chair, x, yy + (0.9 if back == "-y" else -0.9), zb0, collide=False)
        self.place(code, P.holo_table, 0, 3.5, zb0, r=0.7)
        for s in (1, -1):
            self.place(code, P.plant, s * 4.2, 3.5, zb0, seed=70 + s)
        self.light(code, 0, 3.5, zb1 - 0.4, 200, (0.85, 0.92, 1.0))
        P.ceiling_panel(self.mb(code), 0, 3.5, zb1, 3.0, 1.0, "M_Light_Blue")
        self.sign(code, -5.0, 1.0 + 0.16, zb0 + 2.2, "+y")

    # ============================================================ реактор и машинное
    def engineering(self):
        z0, z1 = L.DECK["H"]
        zg = L.DECK["B"][0]
        # реакторный отсек
        code = "C-04"
        r = self.rooms[code]
        y0, y1 = r["y0"], r["y1"]
        m = self.mb(code)
        self.floor(code, z0, -11, 11, y0, y1, "M_Floor_Grate")
        self.ceiling(code, z1, -11, 11, y0, y1, "M_Ceiling")
        hole = (-3.0, 3.0, y0 + 1.5, y1 - 1.5)
        self.floor(code, zg, -11, 11, y0, y1, "M_Floor_Grate", holes=[hole], ceiling_mat="M_Metal_Dark", thick=0.12)
        x0, x1, ya, yb = hole
        for a, b in (((x0, ya), (x1, ya)), ((x1, ya), (x1, yb)), ((x1, yb), (x0, yb)), ((x0, yb), (x0, ya + 1.6))):
            P.railing(m, (*a, zg), (*b, zg), 1.1, "M_Paint_Yellow")
        cx, cy = 0.0, (y0 + y1) / 2
        cyl(m, cx, cy, z0, 2.4, 0.8, "M_Metal_Dark", seg=32)
        cyl(m, cx, cy, z0 + 0.8, 1.9, 0.4, "M_Engine", seg=32)
        cyl(m, cx, cy, z0 + 1.2, 1.3, z1 - z0 - 2.4, "M_Reactor_Core", seg=32)
        for k in range(6):
            cyl(m, cx, cy, z0 + 1.6 + k * 1.05, 1.55, 0.18, "M_Engine", seg=32)
        for k in range(8):
            a = k * math.pi / 4
            px, py = cx + math.cos(a) * 1.45, cy + math.sin(a) * 1.45
            box(m, px - 0.08, py - 0.08, z0 + 1.2, px + 0.08, py + 0.08, z1 - 1.2, "M_Metal_Dark")
        cyl(m, cx, cy, z1 - 1.2, 1.9, 1.2, "M_Metal_Dark", seg=32, r2=1.2)
        for s in (1, -1):
            for k in range(3):
                self.place(code, P.tank, s * 8.0, y0 + 1.6 + k * 2.2, z0, "+x" if s > 0 else "-x", 0.7, 3.0)
            from .geo import tube
            tube(m, [(s * 1.6, cy, z0 + 3.0), (s * 4.5, cy, z0 + 3.0), (s * 7.2, y0 + 3.8, z0 + 3.0), (s * 7.2, y0 + 3.8, z0 + 2.4)], 0.18, "M_Metal_Brushed", seg=10)
            self.place(code, P.console, s * 4.6, y1 - 0.6, z0, "+y", 1.8, 0.8, si=6 if s > 0 else 11)
        for x in (-6.0, 6.0):
            self.light(code, x, cy, z1 - 0.6, 600, (0.85, 0.92, 1.0), rng=12)
        self.light(code, 0, cy, z0 + 3.5, 900, (0.45, 0.85, 1.0), rng=14)
        # машинное отделение
        code = "C-05"
        r = self.rooms[code]
        y0, y1 = r["y0"], r["y1"]
        m = self.mb(code)
        self.floor(code, z0, -11, 11, y0, y1, "M_Floor_Grate")
        self.ceiling(code, z1, -11, 11, y0, y1, "M_Ceiling")
        self.xwall(code, y0, -11, 11, z0, z1, "M_Wall_Industrial", "M_Wall_Industrial",
                   doors=[(0.0, 1.8, DH, z0, "door", "C-05_main")], t=0.3)
        self.xwall(code, 31.0, -11, 11, z0, z1, "M_Wall_Industrial", "M_Wall_Industrial",
                   doors=[(0.0, 1.8, DH, z0, "door", "C-04_main"), (0.0 + 6.0, DW, DH, zg, "door", "C-04_gallery")], t=0.3)
        self.xwall(code, y1, -11, 11, z0, z1, "M_Wall_Industrial", "M_Wall_Industrial", t=0.3)
        for s in (1, -1):
            cyl(m, s * 4.0, y0 + 0.6, z0 + 1.4, 1.1, y1 - y0 - 1.0, "M_Engine", axis="y", seg=24)
            for k in range(4):
                cyl(m, s * 4.0, y0 + 0.9 + k * 1.2, z0 + 1.4, 1.25, 0.2, "M_Metal_Dark", axis="y", seg=24)
            box(m, s * 4.0 - 1.2, y0 + 0.5, z0, s * 4.0 + 1.2, y1 - 0.4, z0 + 0.4, "M_Metal_Dark")
            self.place(code, P.console, s * 8.6, y0 + 2.6, z0, "+x" if s > 0 else "-x", 1.6, 0.8, si=12 if s > 0 else 13)
        self.light(code, 0, (y0 + y1) / 2, z1 - 0.6, 700, (1.0, 0.75, 0.5), rng=12)
        self.light(code, 0, (y0 + y1) / 2, z0 + 2.6, 200, (1.0, 0.6, 0.3), rng=8)
        # кормовые стволы: двери в цех и реактор


def _slug(s):
    tr = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя", ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))
    out = "".join(tr.get(c, c) for c in s.lower())
    return "".join(c if c.isalnum() else "_" for c in out).strip("_").title().replace("__", "_")
