#!/usr/bin/env python3
"""App icons and the link preview picture (M20), made from the game's own Gumling art.

    python3 tools/art/make_icons.py apps/sandbox/public [screenshot.png]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PUB = Path(sys.argv[1])
OUT = PUB / 'icons'
OUT.mkdir(exist_ok=True)


def gumling(size, colour=(255, 93, 143)):
    """The grey Gumling body tinted like a team, with eyes."""
    im = Image.open(PUB / 'art/gumling/idle.webp').convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255
    tint = np.array(colour, np.float32) / 255
    rgb = a[..., :3]
    # multiply-tint the light body, keep the dark outline dark
    lum = rgb.mean(axis=2, keepdims=True)
    out = np.where(lum > 0.45, rgb * tint * 1.08 + (lum - 0.45) * 0.35, rgb)
    a[..., :3] = np.clip(out, 0, 1)
    im = Image.fromarray((a * 255).astype(np.uint8), 'RGBA')
    im = im.resize((size, round(size * im.height / im.width)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    w, h = im.size
    for ex in (0.42, 0.62):
        cx, cy, r = w * ex, h * 0.36, w * 0.075
        d.ellipse((cx - r, cy - r * 1.25, cx + r, cy + r * 1.25), fill=(255, 255, 255), outline=(42, 20, 30), width=max(2, w // 64))
        pr = r * 0.5
        d.ellipse((cx - pr + r * 0.2, cy - pr, cx + pr + r * 0.2, cy + pr * 1.1), fill=(26, 19, 32))
    d.arc((w * 0.44, h * 0.44, w * 0.62, h * 0.56), 20, 160, fill=(42, 20, 30), width=max(2, w // 50))
    return im


def icon(size, pad=0.12, round_bg=True):
    s = size * 4
    bg = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    if round_bg:
        d.ellipse((0, 0, s - 1, s - 1), fill=(152, 228, 252), outline=(26, 19, 32), width=s // 32)
    else:
        d.rectangle((0, 0, s, s), fill=(152, 228, 252))
    g = gumling(int(s * (1 - 2 * pad)))
    bg.alpha_composite(g, ((s - g.width) // 2, (s - g.height) // 2 + s // 40))
    return bg.resize((size, size), Image.LANCZOS)


icon(32).save(OUT / 'favicon-32.png')
icon(180, 0.14, False).convert('RGB').save(OUT / 'apple-touch-icon.png')
icon(192).save(OUT / 'icon-192.png')
icon(512).save(OUT / 'icon-512.png')
icon(512, 0.2, False).save(OUT / 'icon-maskable-512.png')

if len(sys.argv) > 2:
    # link preview: a match screenshot, 1200 × 630
    shot = Image.open(sys.argv[2]).convert('RGB')
    w, h = shot.size
    th = round(w * 630 / 1200)
    shot = shot.crop((0, (h - th) // 2, w, (h - th) // 2 + th)).resize((1200, 630), Image.LANCZOS)
    shot.save(PUB / 'og.jpg', quality=86)
print('icons ok')
