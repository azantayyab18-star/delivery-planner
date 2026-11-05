"""Draws Routify's icon and logo in the app's theme (ink + blue): a map pin holding a parcel, with a dotted route
leading to it. Writes every icon, splash and logo image the app uses. Run from rider-app/:

    python assets/brand/make_brand.py

Needs Pillow. Everything is drawn at 4x and scaled down, for smooth edges.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent
SS = 4  # supersampling

INK = (24, 24, 27, 255)          # light.ink
BLUE = (37, 99, 235, 255)        # light.link
BLUE_TOP = (59, 130, 246, 255)   # lighter top face
BLUE_DARK = (29, 78, 216, 255)
SKY = (96, 165, 250, 255)        # dark-mode link
SKY_TOP = (147, 197, 253, 255)
WHITE = (255, 255, 255, 255)
NAVY = (11, 17, 32, 255)         # dark-mode background
CLEAR = (0, 0, 0, 0)


def teardrop(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, tip_y: float, fill) -> None:
    """A map pin: a circle and the two tangents from the tip below it."""
    d = tip_y - cy
    a = math.acos(r / d)
    base = math.pi / 2  # straight down
    p1 = (cx + r * math.cos(base - a), cy + r * math.sin(base - a))
    p2 = (cx + r * math.cos(base + a), cy + r * math.sin(base + a))
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    draw.polygon([p1, (cx, tip_y), p2], fill=fill)


def cube(draw: ImageDraw.ImageDraw, cx: float, cy: float, a: float, gap: float, top, side) -> None:
    """An isometric parcel: three faces with thin gaps between them."""
    h = a * math.sqrt(3) / 2
    faces = [
        ([(0, -a), (h, -a / 2), (0, 0), (-h, -a / 2)], top),
        ([(-h, -a / 2), (0, 0), (0, a), (-h, a / 2)], side),
        ([(h, -a / 2), (0, 0), (0, a), (h, a / 2)], side),
    ]
    for pts, color in faces:
        mx = sum(p[0] for p in pts) / 4
        my = sum(p[1] for p in pts) / 4
        shrunk = []
        for x, y in pts:
            dx, dy = x - mx, y - my
            n = math.hypot(dx, dy) or 1
            shrunk.append((cx + x - dx / n * gap, cy + y - dy / n * gap))
        draw.polygon(shrunk, fill=color)


def mark(size: int, *, ring, inside, top, side, dots, ring_width: float = 0.075) -> Image.Image:
    """The mark on a transparent square. Geometry is in units of the square (0..1)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), CLEAR)
    d = ImageDraw.Draw(img)
    cx, cy, r, tip = 0.56 * s, 0.42 * s, 0.25 * s, 0.86 * s
    w = ring_width * s
    teardrop(d, cx, cy, r, tip, ring)
    # The inside of the ring: the same shape, smaller, its tip moved up to keep the ring even.
    inner_r = r - w
    half = math.asin(r / (tip - cy))
    teardrop(d, cx, cy, inner_r, tip - w / math.sin(half), inside)
    cube(d, cx, cy - 0.005 * s, 0.135 * s, 0.01 * s, top, side)
    # The route: a start dot, then dashes curving up to the pin's tip.
    d.ellipse([0.06 * s, 0.795 * s, 0.17 * s, 0.905 * s], fill=dots)
    for i, t in enumerate([0.30, 0.48, 0.66, 0.84]):
        x = 0.12 * s + t * (cx - 0.12 * s - 0.04 * s)
        y = 0.85 * s - math.sin(t * math.pi) * 0.045 * s - t * 0.0 * s
        rr = 0.028 * s
        d.ellipse([x - rr, y - rr * 0.8, x + rr, y + rr * 0.8], fill=dots)
        del i
    # Centre the drawing in its square (the pin sits right of the route).
    left, upper, right, lower = img.getbbox()
    centred = Image.new("RGBA", (s, s), CLEAR)
    centred.paste(img, ((s - (right - left)) // 2 - left, (s - (lower - upper)) // 2 - upper))
    return centred.resize((size, size), Image.LANCZOS)


def blue_square(size: int, radius: float = 0.0) -> Image.Image:
    """The icon background: blue, a little lighter at the top."""
    s = size * SS
    grad = Image.new("RGBA", (1, s))
    for y in range(s):
        t = y / (s - 1)
        grad.putpixel((0, y), tuple(int(BLUE_TOP[i] * (1 - t) + BLUE_DARK[i] * t) for i in range(3)) + (255,))
    bg = grad.resize((s, s))
    if radius:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius * s, fill=255)
        out = Image.new("RGBA", (s, s), CLEAR)
        out.paste(bg, (0, 0), mask)
        bg = out
    return bg.resize((size, size), Image.LANCZOS)


def on(bg: Image.Image, fg: Image.Image, scale: float) -> Image.Image:
    """`fg` scaled to `scale` of `bg`, centred."""
    n = int(bg.width * scale)
    small = fg.resize((n, n), Image.LANCZOS)
    out = bg.copy()
    out.alpha_composite(small, ((bg.width - n) // 2, (bg.height - n) // 2))
    return out


def main() -> None:
    white_mark = mark(1024, ring=WHITE, inside=CLEAR, top=WHITE, side=(219, 234, 254, 255), dots=WHITE)

    # App icon (iOS and the store): full square, no transparency.
    icon = on(blue_square(1024), white_mark, 0.74)
    icon.convert("RGB").save(ASSETS / "icon.png")
    icon.resize((48, 48), Image.LANCZOS).save(ASSETS / "favicon.png")
    # Android adaptive icon: the launcher masks it, so the mark stays inside the middle 60%.
    blue_square(1024).convert("RGB").save(ASSETS / "android-icon-background.png")
    fg = Image.new("RGBA", (1024, 1024), CLEAR)
    fg = on(fg, white_mark, 0.56)
    fg.save(ASSETS / "android-icon-foreground.png")
    fg.save(ASSETS / "android-icon-monochrome.png")

    # Splash and in-app marks: ink pin + blue parcel on light screens, white pin + sky-blue parcel on dark ones.
    light_mark = mark(384, ring=INK, inside=CLEAR, top=BLUE_TOP, side=BLUE, dots=BLUE)
    dark_mark = mark(384, ring=WHITE, inside=CLEAR, top=SKY_TOP, side=SKY, dots=SKY)
    light_mark.save(ASSETS / "splash-mark.png")
    dark_mark.save(ASSETS / "splash-mark-dark.png")
    light_mark.save(ASSETS / "brand" / "routify-mark.png")
    dark_mark.save(ASSETS / "brand" / "routify-mark-dark.png")
    # The small rounded app icon next to the name on sign-in screens.
    on(blue_square(192, radius=0.24), white_mark, 0.74).save(ASSETS / "brand" / "app-icon.png")
    # A wide preview of everything, to look at (not used by the app).
    sheet = Image.new("RGBA", (1600, 420), (244, 244, 245, 255))
    sheet.alpha_composite(icon.resize((360, 360), Image.LANCZOS), (30, 30))
    sheet.alpha_composite(on(blue_square(1024), white_mark, 0.56).resize((360, 360), Image.LANCZOS), (420, 30))
    sheet.alpha_composite(light_mark.resize((360, 360), Image.LANCZOS), (810, 30))
    dark = Image.new("RGBA", (360, 360), NAVY)
    dark.alpha_composite(dark_mark.resize((360, 360), Image.LANCZOS))
    sheet.alpha_composite(dark, (1200, 30))
    sheet.convert("RGB").save(Path(__file__).with_name("preview.png"))


if __name__ == "__main__":
    main()
