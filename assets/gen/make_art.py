#!/usr/bin/env python3
"""毒格巧克力 CHOMP —— 全套位图资产的生成器（唯一真相源，仓内可复现）。

    python3 assets/gen/make_art.py          # 重画全套，打印每张的宽高与字节数
    python3 assets/gen/make_art.py --check  # 只校验盘上资产：合法 PNG / 尺寸 / 是否比脚本旧

母题和玩法同源，不是贴花：一条刻成方格的巧克力躺在锡纸托盘上，右下方已经被咬掉
一个象限，左上角那一格是毒格（苍白骷髅）。CHOMP 的全部规则压在这一张图里 ——
「咬掉一格连同它右下方的全部，被迫咬到毒格的人输」。残条形状 (3,3,1) 就是棋书里
一个真实局面，不是随手画的方格。

配色全部取自运行时实测读数（js/view.js 的 chocolate()/skull() 渐变停靠点，与
css/game.css 的 :root），所以图标与游戏画面是同一批颜色：
  #1b120c 背景 · #3a2415 托盘 · #8a5733/#6d4022/#54301a 牛奶巧克力
  #7d4f2c/#5f381d/#492814 毒格 · #c9f2a0 毒 · #2f4a1c 眼窝 · #2b1a10 咬痕

依赖只有 Pillow。文字是**可选点缀**：找到系统字体就排上，找不到就退化成纯几何块，
绝不因为缺某个 .ttc 而生不出图 —— 全部资产的几何部分 100% 程序化绘制。
"""
import argparse
import hashlib
import math
import os
import random
import struct
import sys

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：python3 -m pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
ICON_DIR = os.path.join(REPO, 'assets', 'icons')
TEX_DIR = os.path.join(REPO, 'assets', 'textures')
OG_DIR = os.path.join(REPO, 'assets', 'og')

# ---------------------------------------------------------------- palette (measured, see header)
BG = (27, 18, 12)
BG2 = (36, 24, 17)
TRAY = (58, 36, 21)
MILK = ((138, 87, 51), (109, 64, 34), (84, 48, 26))
TOXIC = ((125, 79, 44), (95, 56, 29), (73, 40, 20))
POISON = (201, 242, 160)
POISON_EYE = (47, 74, 28)
FOIL_EDGE = (210, 170, 120)
GHOST = (43, 26, 16)
CRUMB = (122, 74, 36)

ICON_SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 512, 1024]
BAR_ROWS = 3
BAR_SHAPE = (3, 3, 1)   # 右下咬掉一个 2x2 象限后剩下的 L 形：一个真实残局
SEED_GRAIN = 20260930   # 固定种子：同一份脚本在任何机器上画出同一张图


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def bands(size, top, bottom, step=32):
    """竖直两段渐变，按行画（C 侧填充，比逐像素快两个量级）。size 可为边长或 (w, h)。"""
    w, h = (size, size) if isinstance(size, int) else size
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(0, h, step):
        t = (y + step / 2) / max(1, h - 1)
        d.rectangle([0, y, w, min(h, y + step)], fill=lerp(top, bottom, t))
    return img


def tri(size, stops, step=32):
    """三段停靠点渐变，和 view.js 里 createLinearGradient 的 0 / .5 / 1 一致。"""
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(0, size, step):
        t = (y + step / 2) / max(1, size - 1)
        col = lerp(stops[0], stops[1], min(1, t * 2)) if t < 0.5 else lerp(stops[1], stops[2], (t - 0.5) * 2)
        d.rectangle([0, y, size, min(size, y + step)], fill=col)
    return img


def rounded_mask(s, rad):
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, fill=255)
    return m


# ---------------------------------------------------------------- material noise
def value_noise(size, cells, seed):
    """周期性 value noise：格点取模环绕，所以出来的纹理天然可平铺。"""
    rnd = random.Random(seed)
    lat = [[rnd.random() for _ in range(cells)] for _ in range(cells)]
    out = bytearray(size * size)
    scale = cells / size
    i = 0
    for y in range(size):
        fy = y * scale
        y0 = int(fy) % cells
        y1 = (y0 + 1) % cells
        sy = smooth(fy - int(fy))
        row0, row1 = lat[y0], lat[y1]
        for x in range(size):
            fx = x * scale
            x0 = int(fx) % cells
            x1 = (x0 + 1) % cells
            sx = smooth(fx - int(fx))
            v = (row0[x0] * (1 - sx) + row0[x1] * sx) * (1 - sy) \
                + (row1[x0] * (1 - sx) + row1[x1] * sx) * sy
            out[i] = int(round(v * 255))
            i += 1
    return Image.frombytes('L', (size, size), bytes(out))


def fbm(size, cells, seed, octaves=3):
    acc = value_noise(size, cells, seed)
    total = 1.0
    for o in range(1, octaves):
        w = 1.0 / (o + 1)
        acc = Image.blend(acc, value_noise(size, cells * (2 ** o), seed + o * 17), w / (total + w))
        total += w
    return acc


# ---------------------------------------------------------------- the drawn objects
def skull(img, cx, cy, r, detail=True):
    """js/view.js 里 path 骷髅的位图版：半球颅 + 收窄下颌 + 眼窝 + 鼻腔 + 三颗牙。"""
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=POISON)
    jw, jt, jb = r * 0.60, cy + r * 0.42, cy + r * 1.12
    d.polygon([(cx - jw, jt), (cx + jw, jt), (cx + jw * 0.70, jb), (cx - jw * 0.70, jb)], fill=POISON)
    if not detail:
        return
    eye = r * 0.30
    for sgn in (-1, 1):
        ex = cx + sgn * r * 0.42
        d.ellipse([ex - eye, cy - r * 0.34 - eye, ex + eye, cy - r * 0.34 + eye], fill=POISON_EYE)
    ns = r * 0.16
    d.polygon([(cx, cy + r * 0.04), (cx - ns, cy + r * 0.44), (cx + ns, cy + r * 0.44)], fill=POISON_EYE)
    tw, gap = r * 0.13, r * 0.38
    top = cy + r * 0.56
    bot = cy + r * 1.00
    d.rounded_rectangle([cx - gap - tw, top, cx + gap + tw, bot], radius=tw * 0.55, fill=POISON_EYE)
    for i in (-1, 0, 1):
        tx = cx + i * gap
        d.rounded_rectangle([tx - tw, top, tx + tw, bot], radius=tw * 0.55, fill=POISON)


def chocolate_tile(s, toxic, grain=None, bevel=True):
    """一格巧克力：三段渐变 + 可可脂斑驳 + 左上高光/右下压暗的斜角。"""
    stops = TOXIC if toxic else MILK
    img = tri(s, stops).convert('RGBA')
    if grain is not None:
        g = grain.resize((s, s), Image.BILINEAR)
        speck = Image.composite(Image.new('RGBA', (s, s), (255, 236, 210, 255)),
                               Image.new('RGBA', (s, s), (36, 16, 6, 255)), g)
        speck.putalpha(Image.new('L', (s, s), 26))
        img = Image.alpha_composite(img, speck)
    if bevel:
        k = max(1, round(s * 0.045))
        rad = max(1, round(s * 0.16))
        box = [k, k, s - 1 - k, s - 1 - k]
        hi = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(hi).rounded_rectangle(box, radius=rad, outline=(255, 226, 180, 96), width=k)
        lo = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(lo).rounded_rectangle(box, radius=rad, outline=(28, 11, 4, 168), width=k)
        # 高光只留左上、压暗只留右下：用一个对角三角当 alpha
        up = Image.new('L', (s, s), 0)
        ImageDraw.Draw(up).polygon([(0, 0), (s, 0), (0, s)], fill=255)
        dn = Image.new('L', (s, s), 0)
        ImageDraw.Draw(dn).polygon([(s, s), (s, 0), (0, s)], fill=255)
        hi.putalpha(ImageChops.multiply(hi.split()[3], up))
        lo.putalpha(ImageChops.multiply(lo.split()[3], dn))
        img = Image.alpha_composite(img, hi)
        img = Image.alpha_composite(img, lo)
    out = img.copy()
    out.putalpha(rounded_mask(s, s * 0.14))
    return out


def bite_hole(s):
    """被咬掉的格子：托盘底 + 撕断的刻痕，露出包装纸。"""
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, 'RGBA')
    m = s * 0.07
    d.rounded_rectangle([m, m, s - m, s - m], radius=s * 0.20, fill=GHOST + (210,))
    d.rounded_rectangle([m, m, s - m, s - m], radius=s * 0.20,
                        outline=(120, 80, 50, 120), width=max(1, int(s * 0.02)))
    rnd = random.Random(int(s))
    for _ in range(4):
        a = rnd.uniform(0, math.tau)
        cx, cy = s / 2 + math.cos(a) * s * 0.34, s / 2 + math.sin(a) * s * 0.34
        d.ellipse([cx - s * 0.06, cy - s * 0.06, cx + s * 0.06, cy + s * 0.06], fill=(30, 18, 10, 190))
    return img


def draw_bar(img, ox, oy, cell, gap, shape, rows, cols, grain, detail=True):
    s = int(round(cell))
    for r, c, tile in bar_tiles(shape, rows, cols, s, grain, detail):
        img.paste(tile, (int(ox + c * (cell + gap)), int(oy + r * (cell + gap))), tile)


def bar_tiles(shape, rows, cols, s, grain, detail):
    for r in range(rows):
        for c in range(cols):
            alive = r < len(shape) and c < shape[r]
            if not alive:
                yield (r, c, bite_hole(s))
                continue
            toxic = (r, c) == (0, 0)
            t = chocolate_tile(s, toxic, grain)
            if toxic:
                layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
                layer.paste(Image.new('RGBA', (s, s), (180, 255, 140, 30)), (0, 0),
                            rounded_mask(s, s * 0.14))
                t = Image.alpha_composite(t, layer)
                skull(t, s / 2, s * 0.44, s * 0.26, detail=detail)
            yield (r, c, t)


def master_icon(S=1024, maskable=False):
    """主图标：锡纸托盘 + L 形残条 + 毒格骷髅。maskable 版留出 20% 安全边。"""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pad_frac = 0.20 if maskable else 0.14
    bgw = S if not maskable else int(S * 1.12)
    bg = bands(bgw, (58, 37, 23), BG).convert('RGBA')
    if not maskable:
        bg.putalpha(rounded_mask(bgw, bgw * 0.20))
    off = (S - bgw) // 2
    img.paste(bg, (off, off), bg)
    d = ImageDraw.Draw(img, 'RGBA')
    cols, rows = BAR_SHAPE[0], BAR_ROWS
    pad = S * pad_frac
    gap = S * 0.022
    cell = min((S - 2 * pad - (cols - 1) * gap) / cols, (S - 2 * pad - (rows - 1) * gap) / rows)
    bar_w = cols * cell + (cols - 1) * gap
    bar_h = rows * cell + (rows - 1) * gap
    ox = (S - bar_w) / 2
    oy = (S - bar_h) / 2
    tray = [ox - gap * 1.7, oy - gap * 1.7, ox + bar_w + gap * 1.7, oy + bar_h + gap * 1.7]
    d.rounded_rectangle(tray, radius=cell * 0.24, fill=TRAY + (255,))
    d.rounded_rectangle(tray, radius=cell * 0.24, outline=FOIL_EDGE + (95,), width=max(2, int(S * 0.006)))
    d.rounded_rectangle([ox - gap, oy - gap, ox + bar_w + gap, oy + bar_h + gap],
                        radius=cell * 0.16, outline=(24, 13, 7, 190), width=max(1, int(S * 0.004)))
    grain = fbm(160, 5, SEED_GRAIN, octaves=3)
    draw_bar(img, ox, oy, cell, gap, BAR_SHAPE, rows, cols, grain, detail=S >= 128)
    return img


# ---------------------------------------------------------------- in-game textures / sprites
def texture_cocoa(size=256):
    """可平铺的可可脂纹理：叠在画布渐变上做出实体哑光，取代纯色填充。"""
    n = fbm(size, 6, 4242, octaves=3)
    img = Image.merge('RGB', [
        n.point(lambda v: int(120 + v * 0.40)),
        n.point(lambda v: int(74 + v * 0.30)),
        n.point(lambda v: int(42 + v * 0.22)),
    ])
    d = ImageDraw.Draw(img, 'RGBA')
    rnd = random.Random(99)
    for _ in range(size // 5):
        x, y = rnd.randint(0, size - 1), rnd.randint(0, size - 1)
        ln = rnd.randint(size // 24, size // 8)
        d.line([x, y, (x + ln) % size, (y + rnd.randint(-2, 2)) % size],
               fill=(255, 238, 214, rnd.randint(8, 24)))
    return img


def texture_foil(size=256):
    """可平铺的锡纸托盘：斜向条纹 + 一层斑驳，包装纸的反光。"""
    n = value_noise(size, 8, 777)
    img = Image.new('RGB', (size, size))
    px = img.load()
    np_ = n.load()
    period = size / 8
    for y in range(size):
        for x in range(size):
            t = smooth(((x - y) % (period * 2)) / (period * 2))
            base = lerp((36, 23, 14), (94, 68, 42), t)
            shimmer = lerp(base, (140, 108, 72), 0.10 + 0.30 * np_[x, y] / 255)
            px[x, y] = shimmer
    return img


def sprite_skull(size=160):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    skull(img, size / 2, size * 0.42, size * 0.30, detail=True)
    return img


def sprite_crumb(size=48):
    """咬下来那一粒巧克力屑：不规则多边形 + 顶面高光，喂给 dt 粒子系统。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, 'RGBA')
    rnd = random.Random(7)
    cx, cy, r = size / 2, size / 2, size * 0.42
    pts = []
    for i in range(9):
        a = i / 9 * math.tau
        rr = r * (0.72 + 0.38 * rnd.random())
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=CRUMB + (255,))
    d.polygon([(cx + (p[0] - cx) * 0.72, cy + (p[1] - cy) * 0.72 - r * 0.10) for p in pts[:5]],
              fill=(168, 116, 68, 230))
    d.ellipse([cx - r * 0.26, cy - r * 0.52, cx + r * 0.04, cy - r * 0.18], fill=(220, 186, 140, 160))
    return img


# ---------------------------------------------------------------- social card
FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
]


def find_font(px):
    """字体只是点缀：找不到就返回 None，卡片退化成纯图形而不是生成失败。"""
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px), os.path.basename(p)
            except Exception:
                continue
    return None, None


def og_card(w=1200, h=630):
    img = bands((w, h), (58, 37, 23), BG).convert('RGBA')
    foil = texture_foil(256).convert('RGBA')
    sheet = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for ty in range(0, h, 256):
        for tx in range(0, w, 256):
            sheet.paste(foil, (tx, ty))
    sheet.putalpha(Image.new('L', (w, h), 22))
    img = Image.alpha_composite(img, sheet)
    icon = master_icon(1024).resize((456, 456), Image.LANCZOS)
    img.paste(icon, (68, (h - 456) // 2), icon)
    d = ImageDraw.Draw(img, 'RGBA')
    tx, ty = 566, 132
    f1, _ = find_font(104)
    f2, _ = find_font(31)

    def put(x, y, s, font, fill):
        if font is None:
            return
        w = font.getlength(s)
        if x + w > img.width - 40:
            raise SystemExit('OG 卡片文字越界：%r 需要 %dpx，右边界只剩 %dpx' % (s, int(w), img.width - 40 - x))
        d.text((x, y), s, font=font, fill=fill)

    if f1:
        put(tx, ty, 'CHOMP', f1, POISON + (255,))
    else:
        d.rounded_rectangle([tx, ty, tx + 372, ty + 104], radius=14, fill=POISON + (255,))
    put(tx, ty + 140, 'A poisoned bar of chocolate.', f2, (243, 227, 207, 255))
    put(tx, ty + 188, 'Bite a square and all of', f2, (191, 167, 149, 255))
    put(tx, ty + 226, 'its below-right quadrant.', f2, (191, 167, 149, 255))
    put(tx, ty + 264, 'The skull stays for the loser.', f2, (191, 167, 149, 255))
    d.line([tx, ty + 322, tx + 500, ty + 322], fill=FOIL_EDGE + (70,), width=2)
    put(tx, ty + 344, '419 positions  -  36 losing', f2, POISON + (235,))
    d.rectangle([0, 0, w - 1, h - 1], outline=FOIL_EDGE + (60,), width=6)
    return img


# ---------------------------------------------------------------- output
def write(path, img, opaque=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if opaque and img.mode == 'RGBA':
        bg = Image.new('RGBA', img.size, BG + (255,))
        bg.paste(img, (0, 0), bg)
        img = bg
    img.save(path, 'PNG', optimize=True)
    return path


def png_dims(path):
    with open(path, 'rb') as fh:
        head = fh.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise SystemExit('%s: 不是合法 PNG（IHDR 缺失）' % path)
    return struct.unpack('>II', head[16:24])


def build():
    produced = []
    m1024 = master_icon(1024)
    for s in ICON_SIZES:
        im = m1024 if s == 1024 else m1024.resize((s, s), Image.LANCZOS)
        produced.append(write(os.path.join(ICON_DIR, 'icon-%d.png' % s), im))
    produced.append(write(os.path.join(ICON_DIR, 'favicon-32.png'), m1024.resize((32, 32), Image.LANCZOS), opaque=True))
    produced.append(write(os.path.join(ICON_DIR, 'apple-touch-icon.png'), m1024.resize((180, 180), Image.LANCZOS), opaque=True))
    produced.append(write(os.path.join(ICON_DIR, 'maskable-512.png'), master_icon(512, maskable=True), opaque=True))
    produced.append(write(os.path.join(TEX_DIR, 'cocoa-256.png'), texture_cocoa(256)))
    produced.append(write(os.path.join(TEX_DIR, 'foil-256.png'), texture_foil(256)))
    produced.append(write(os.path.join(TEX_DIR, 'skull-160.png'), sprite_skull(160)))
    produced.append(write(os.path.join(TEX_DIR, 'crumb-48.png'), sprite_crumb(48)))
    produced.append(write(os.path.join(OG_DIR, 'chomp-og.png'), og_card(1200, 630), opaque=True))
    return produced


def digest():
    h = hashlib.sha256()
    for root, dirs, files in os.walk(os.path.join(REPO, 'assets')):
        dirs[:] = sorted(d for d in dirs if d != 'gen')
        for f in sorted(files):
            if f.endswith('.png'):
                h.update(f.encode())
                with open(os.path.join(root, f), 'rb') as fh:
                    h.update(fh.read())
    return h.hexdigest()[:12]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验盘上资产，不重写')
    args = ap.parse_args()
    if args.check:
        want = ['assets/icons/icon-%d.png' % s for s in ICON_SIZES] + [
            'assets/icons/favicon-32.png', 'assets/icons/apple-touch-icon.png',
            'assets/icons/maskable-512.png', 'assets/textures/cocoa-256.png',
            'assets/textures/foil-256.png', 'assets/textures/skull-160.png',
            'assets/textures/crumb-48.png', 'assets/og/chomp-og.png']
        missing = [p for p in want if not os.path.exists(os.path.join(REPO, p))]
        zero = [p for p in want if os.path.exists(os.path.join(REPO, p)) and os.path.getsize(os.path.join(REPO, p)) == 0]
        big = [p for p in want if min(png_dims(os.path.join(REPO, p))) >= 180] if not missing else []
        print('应存在 %d 张 / 缺失 %d / 0字节 %d / 边长≥180 %d' % (len(want), len(missing), len(zero), len(big)))
        for p in missing + zero:
            print('  BAD', p)
        raise SystemExit(1 if (missing or zero) else 0)
    produced = build()
    print('生成 %d 张 PNG：' % len(produced))
    for p in produced:
        w, h = png_dims(p)
        n = os.path.getsize(p)
        print('  %-40s %4dx%-4d %7dB' % (os.path.relpath(p, REPO), w, h, n))
    print('指纹 sha256[:12] =', digest())
    print('边长≥180 的位图 %d 张' % len([p for p in produced if min(png_dims(p)) >= 180]))


if __name__ == '__main__':
    main()
