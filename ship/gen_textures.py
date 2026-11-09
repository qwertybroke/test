# Процедурные текстуры VESPER Explorer (корпус без запечённой раскладки плит, атласы надписей, пол цехов)
# и Unity MaskMap для всех наборов. Запуск: uv run --with numpy --with pillow python ship/gen_textures.py
import os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "assets", "Textures")
OUT = os.path.join(HERE, "build", "Textures")
FONT = os.path.join(HERE, "assets", "fonts", "Inter.woff2")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def font(size, weight=b"Light"):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


def noise(n, scale, octaves=4, seed=0):
    """Тайлящийся value-noise (сумма октав), значения 0..1."""
    r = np.random.default_rng(seed)
    acc = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        g = max(2, int(scale * 2 ** o))
        grid = r.random((g, g)).astype(np.float32)
        im = Image.fromarray((grid * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        # resize не тайлится по краям: склеиваем через wrap-усреднение
        a = np.asarray(im, np.float32) / 255
        a = (a + np.roll(a, n // 2, 0) + np.roll(a, n // 2, 1) + np.roll(np.roll(a, n // 2, 0), n // 2, 1)) / 4
        acc += a * amp
        tot += amp
        amp *= 0.5
    acc /= tot
    return (acc - acc.min()) / (np.ptp(acc) + 1e-6)


def streaks(n, count, seed):
    """Вертикальные потёки грязи/копоти (по V), тайлятся."""
    r = np.random.default_rng(seed)
    a = np.zeros((n, n), np.float32)
    for _ in range(count):
        x = r.integers(0, n)
        w = r.integers(2, 14)
        y0 = r.integers(0, n)
        ln = r.integers(n // 8, n // 2)
        ys = (np.arange(ln) + y0) % n
        fade = np.linspace(1, 0, ln) ** 1.5 * r.uniform(0.3, 1)
        for dx in range(-w, w + 1):
            a[ys, (x + dx) % n] += fade * (1 - abs(dx) / (w + 1))
    return np.clip(a, 0, 1)


def scratches(n, count, seed, length=(10, 80)):
    r = np.random.default_rng(seed)
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = r.integers(0, n, 2)
        ang = r.uniform(0, np.pi)
        ln = r.uniform(*length)
        d.line([(x, y), (x + np.cos(ang) * ln, y + np.sin(ang) * ln)], fill=int(r.uniform(60, 255)), width=1)
    return np.asarray(im, np.float32) / 255


def height_to_normal(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL (+Y вверх): зелёный = -dy
    return np.dstack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, nz / l * 0.5 + 0.5])


def save_rgb(a, name, q=92):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q)


def paint_set(name, base, n=2048, rough=0.5, metal=0.0, dirt=0.06, seed=1):
    lo = noise(n, 3, 5, seed)
    mid = noise(n, 24, 3, seed + 1)
    st = streaks(n, 90, seed + 2)
    sc = scratches(n, 260, seed + 3) * 0.6
    peel = noise(n, 160, 2, seed + 4)
    base = np.array(base, np.float32)
    col = base[None, None, :] * (1 + (lo[..., None] - 0.5) * 0.07 + (mid[..., None] - 0.5) * 0.035)
    col *= 1 - st[..., None] * dirt
    col += sc[..., None] * (0.04 if base.mean() < 0.4 else -0.012)
    save_rgb(col, f"T_{name}_BaseColor.jpg")
    h = peel * 0.3 + sc * -0.2 + lo * 0.2
    save_rgb(height_to_normal(h, 2.2), f"T_{name}_Normal.jpg")
    ao = 1 - st * 0.12
    rg = np.clip(rough + (mid - 0.5) * 0.12 + st * 0.12 - sc * 0.15, 0.05, 1)
    mt = np.full_like(ao, metal) + sc * (0.6 if metal < 0.5 else 0.0)
    save_rgb(np.dstack([ao, rg, np.clip(mt, 0, 1)]), f"T_{name}_ORM.jpg")


def hall_floor(n=1024):
    """Пол производственных цехов: полимерное покрытие, разметка сетки 4 м (текстура = 4×4 м)."""
    lo = noise(n, 4, 5, 31)
    sc = scratches(n, 1800, 32, (4, 40))
    col = np.dstack([0.20 + lo * 0.04, 0.215 + lo * 0.04, 0.23 + lo * 0.045])
    col += sc[..., None] * 0.05
    im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    w = 6
    # границы ячейки 4 м (жёлтая линия делится между соседними тайлами)
    for e in (0, n):
        d.rectangle([e - w // 2, 0, e + w // 2, n], fill=(196, 160, 40))
        d.rectangle([0, e - w // 2, n, e + w // 2], fill=(196, 160, 40))
    # тонкая сетка 1 м
    for i in range(1, 4):
        p = i * n // 4
        d.line([(p, 0), (p, n)], fill=(88, 94, 100), width=2)
        d.line([(0, p), (n, p)], fill=(88, 94, 100), width=2)
    # анкерные точки крепления оборудования в узлах 2 м
    for cx in (0, n // 2, n):
        for cy in (0, n // 2, n):
            if cx in (0, n) and cy in (0, n):
                continue
            d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(60, 64, 70), outline=(30, 32, 36), width=3)
            d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(25, 27, 30))
    im.save(os.path.join(OUT, "T_Floor_Hall_BaseColor.jpg"), quality=92)
    a = np.asarray(im, np.float32).mean(2) / 255
    save_rgb(height_to_normal(a * 0.5 + noise(n, 120, 2, 33) * 0.2 - sc * 0.4, 1.5), "T_Floor_Hall_Normal.jpg")
    save_rgb(np.dstack([np.ones_like(a), 0.55 + lo * 0.15 - sc * 0.2, np.full_like(a, 0.1)]), "T_Floor_Hall_ORM.jpg")


def decals():
    """Атлас 2048×2048 (RGBA, MASK): логотип, эмблема, бортовой номер, предупреждения. Регионы — в DECAL_UV."""
    n = 2048
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ink = (52, 56, 60, 255)
    # 1) VESPER: 0..2048 × 0..420
    f = font(330, b"Light")
    txt = "VESPER"
    sp = 70
    widths = [d.textlength(c, font=f) for c in txt]
    x = (n - (sum(widths) + sp * (len(txt) - 1))) / 2
    for c, w in zip(txt, widths):
        d.text((x, 30), c, font=f, fill=ink)
        x += w + sp
    # 2) EXPLORER с линиями: 0..2048 × 440..620
    f2 = font(120, b"Regular")
    t2 = "E X P L O R E R"
    w2 = d.textlength(t2, font=f2)
    d.text(((n - w2) / 2, 455), t2, font=f2, fill=ink)
    d.line([(160, 535), ((n - w2) / 2 - 50, 535)], fill=ink, width=6)
    d.line([((n + w2) / 2 + 50, 535), (n - 160, 535)], fill=ink, width=6)
    # 3) эмблема-шеврон: 0..512 × 640..1152
    def chevron(ox, oy, s, col):
        d.polygon([(ox + 0.08 * s, oy + 0.18 * s), (ox + 0.5 * s, oy + 0.9 * s), (ox + 0.92 * s, oy + 0.18 * s),
                   (ox + 0.74 * s, oy + 0.18 * s), (ox + 0.5 * s, oy + 0.6 * s), (ox + 0.26 * s, oy + 0.18 * s)], fill=col)
        d.polygon([(ox + 0.36 * s, oy + 0.18 * s), (ox + 0.5 * s, oy + 0.42 * s), (ox + 0.64 * s, oy + 0.18 * s)], fill=col)
        d.line([(ox + 0.04 * s, oy + 0.08 * s), (ox + 0.96 * s, oy + 0.08 * s)], fill=col, width=max(2, int(s * 0.03)))
    chevron(0, 640, 512, ink)
    chevron(512, 640, 512, (225, 228, 230, 255))  # светлая версия для тёмной брони
    # 4) бортовой номер: 1024..2048 × 640..900 (тёмный) и 1024..2048 × 900..1160 (светлый)
    f3 = font(190, b"Medium")
    for i, col in enumerate([ink, (225, 228, 230, 255)]):
        t = "VX-984"
        w = d.textlength(t, font=f3)
        d.text((1024 + (1024 - w) / 2, 660 + i * 260), t, font=f3, fill=col)
    # 5) мелкая маркировка 0..2048 × 1200..1600, ячейки 512×100
    f4 = font(54, b"SemiBold")
    labels = [("AIRLOCK  A-1", ink), ("NO STEP", ink), ("CARGO  C-07", ink), ("SERVICE  PORT", ink),
              ("FUEL  INLET", (180, 40, 30, 255)), ("O2 / N2", ink), ("DOCK  ▼", ink), ("RESCUE ▲", (190, 60, 20, 255))]
    for i, (t, col) in enumerate(labels):
        cx, cy = (i % 4) * 512, 1200 + (i // 4) * 100
        d.rectangle([cx + 20, cy + 14, cx + 492, cy + 86], outline=col, width=4)
        w = d.textlength(t, font=f4)
        d.text((cx + (512 - w) / 2, cy + 18), t, font=f4, fill=col)
    # 6) полоса-предупреждение 0..2048 × 1620..1700
    for i in range(0, n, 80):
        d.polygon([(i, 1700), (i + 40, 1620), (i + 80, 1620), (i + 40, 1700)], fill=(222, 170, 30, 255))
    # 7) стрелки и тонкие линии 0..2048 × 1720..2048
    for i in range(8):
        cx = 128 + i * 256
        d.polygon([(cx - 60, 1800), (cx + 40, 1800), (cx + 40, 1770), (cx + 100, 1830), (cx + 40, 1890), (cx + 40, 1860),
                   (cx - 60, 1860)], fill=ink)
    d.rectangle([0, 1960, n, 1972], fill=ink)
    im.save(os.path.join(OUT, "T_Decals_BaseColor.png"))
    flat = np.dstack([np.full((64, 64), 0.5), np.full((64, 64), 0.5), np.ones((64, 64))])
    save_rgb(flat, "T_Decals_Normal.jpg")
    save_rgb(np.dstack([np.ones((64, 64)), np.full((64, 64), 0.55), np.zeros((64, 64))]), "T_Decals_ORM.jpg")


def signs(rooms):
    """Атлас табличек отсеков: 4 столбца × N строк, ячейка 512×128, + emission."""
    cols, cw, ch = 4, 512, 128
    rows = (len(rooms) + cols - 1) // cols
    h = 1 << (rows * ch - 1).bit_length()
    base = Image.new("RGB", (cols * cw, h), (10, 13, 17))
    emi = Image.new("RGB", (cols * cw, h), (0, 0, 0))
    db, de = ImageDraw.Draw(base), ImageDraw.Draw(emi)
    f1, f2 = font(44, b"Medium"), font(30, b"Regular")
    for i, (code, title) in enumerate(rooms):
        x, y = (i % cols) * cw, (i // cols) * ch
        for d, k in ((db, 1.0), (de, 0.9)):
            acc = tuple(int(c * k) for c in (124, 200, 255))
            d.rectangle([x + 6, y + 6, x + cw - 6, y + ch - 6], outline=acc, width=3)
            d.rectangle([x + 18, y + 22, x + 30, y + ch - 22], fill=acc)
            d.text((x + 48, y + 18), title, font=f1, fill=tuple(int(c * k) for c in (230, 236, 240)))
            d.text((x + 48, y + 74), code, font=f2, fill=acc)
    base.save(os.path.join(OUT, "T_Signs_BaseColor.jpg"), quality=92)
    emi.save(os.path.join(OUT, "T_Signs_Emission.jpg"), quality=92)
    save_rgb(np.dstack([np.full((64, 64), 0.5), np.full((64, 64), 0.5), np.ones((64, 64))]), "T_Signs_Normal.jpg")
    save_rgb(np.dstack([np.ones((64, 64)), np.full((64, 64), 0.3), np.zeros((64, 64))]), "T_Signs_ORM.jpg")
    return cols, rows, h


def mask_maps():
    """Unity HDRP/URP MaskMap: R = Metallic, G = AO, B = detail(0), A = Smoothness."""
    for f in sorted(os.listdir(OUT)):
        if not f.endswith("_ORM.jpg"):
            continue
        orm = np.asarray(Image.open(os.path.join(OUT, f)).convert("RGB"), np.uint8)
        m = np.dstack([orm[..., 2], orm[..., 0], np.zeros_like(orm[..., 0]), 255 - orm[..., 1]])
        Image.fromarray(m, "RGBA").save(os.path.join(OUT, f.replace("_ORM.jpg", "_MaskMap.png")), optimize=True)


def main():
    for f in os.listdir(SRC):
        shutil.copy2(os.path.join(SRC, f), os.path.join(OUT, f))
    paint_set("Hull_Light", (0.80, 0.81, 0.815), rough=0.52, metal=0.0, dirt=0.10, seed=1)
    paint_set("Hull_Mid", (0.52, 0.535, 0.55), rough=0.5, metal=0.0, dirt=0.10, seed=11)
    paint_set("Hull_Dark", (0.085, 0.09, 0.10), rough=0.42, metal=0.55, dirt=-0.6, seed=21)
    hall_floor()
    decals()
    sys.path.insert(0, HERE)
    from vesper.layout import SIGN_ROOMS
    signs(SIGN_ROOMS)
    mask_maps()
    print("textures ->", OUT, len(os.listdir(OUT)))


if __name__ == "__main__":
    main()
