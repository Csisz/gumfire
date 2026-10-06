#!/usr/bin/env python3
"""
Turn raw generated art (Higgsfield downloads) into the game's art pack (M15 art pass).

    python3 tools/art/process_pack.py <raw-dir> apps/sandbox/public/art
    python3 tools/art/process_pack.py --webp apps/sandbox/public/art   (convert an existing pack)

The pack is stored as WebP (M20): a third of the PNG size, alpha kept almost lossless so the
object outlines (and the maps built from them) do not change.

Raw files expected in <raw-dir>:
  {frozen,picnic,toys,garage,bath}_bg.png            wide painted backdrops
  tex_*.png                                           square terrain textures (see TEXTURES)
  props_{frozen,picnic,toys,garage,bath}.png          4 props each, on white (see PROPS)
  gumling_sheet.png                                   4 poses (idle, walk, jump, hurt), on white
  hats.png                                            8 hats in a 4x2 grid, on white

Cut-outs: the white background is flood-filled from the image border (so white icing inside an
outline survives), edges are feathered, and the separate objects are found as connected parts.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = Path(sys.argv[1])
OUT = Path(sys.argv[2])


def to_webp(out, manifest):
    """Store every picture of the pack as WebP and point the manifest at the new files."""
    for group, items in manifest.items():
        if not isinstance(items, dict):
            continue
        for key, rel in items.items():
            src = out / rel
            if src.suffix == '.webp':
                continue
            dst = src.with_suffix('.webp')
            im = Image.open(src)
            if src.suffix == '.jpg':
                im.convert('RGB').save(dst, 'WEBP', quality=84, method=6)
            else:
                im.convert('RGBA').save(dst, 'WEBP', quality=88, alpha_quality=100, method=6)
            src.unlink()
            items[key] = str(Path(rel).with_suffix('.webp'))
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def load(name):
    return Image.open(RAW / name).convert('RGBA')


def cutout(img, thr=48):
    """Background (near-white, connected to the border) → transparent, with a soft edge."""
    a = np.asarray(img).astype(np.float32)
    rgb = a[..., :3]
    dist = np.sqrt(((255 - rgb) ** 2).sum(axis=2))
    near = dist < thr
    lab, _ = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # feather: pixels next to the background fade by their whiteness
    grown = ndimage.binary_dilation(bg, iterations=2) & ~bg
    alpha = np.where(bg, 0.0, 255.0)
    soft = np.clip(dist / thr, 0, 1) * 255
    alpha = np.where(grown, np.minimum(alpha, soft), alpha)
    out = a.copy()
    out[..., 3] = alpha
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def parts(img, n, attach=40):
    """The n biggest opaque parts (small bits nearby are merged in), left→right then top→bottom."""
    al = np.asarray(img)[..., 3] > 24
    lab, k = ndimage.label(al)
    sizes = ndimage.sum(al, lab, range(1, k + 1))
    order = np.argsort(sizes)[::-1]
    big = [int(i) + 1 for i in order[:n]]
    boxes = {b: list(ndimage.find_objects((lab == b).astype(int))[0]) for b in big}
    for i in order[n:]:
        lbl = int(i) + 1
        sl = ndimage.find_objects((lab == lbl).astype(int))[0]
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        best, bd = None, 1e9
        for b, (sy, sx) in boxes.items():
            dy = max(sy.start - cy, 0, cy - sy.stop)
            dx = max(sx.start - cx, 0, cx - sx.stop)
            d = max(dx, dy)
            if d < bd:
                best, bd = b, d
        if best is not None and bd < attach:
            sy, sx = boxes[best]
            boxes[best] = [slice(min(sy.start, sl[0].start), max(sy.stop, sl[0].stop)), slice(min(sx.start, sl[1].start), max(sx.stop, sl[1].stop))]
            lab[lab == lbl] = best
    items = []
    for b, (sy, sx) in boxes.items():
        crop = np.asarray(img)[sy, sx].copy()
        mask = lab[sy, sx] == b
        crop[..., 3] = np.where(mask, crop[..., 3], 0)
        items.append(((sy.start, sx.start), Image.fromarray(crop, 'RGBA')))
    # reading order: rows (by top, bucketed by height/3) then x
    h = img.height
    items.sort(key=lambda it: (round(it[0][0] / (h / 3)), it[0][1]))
    return [im for _, im in items]


def fit(im, max_side):
    s = max_side / max(im.width, im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def tileable(im, size=512, crop=0.0):
    """Square texture at `size`, made seamless by cross-fading with a half-offset copy."""
    w, h = im.size
    if crop:
        im = im.crop((int(w * crop), int(h * crop), int(w * (1 - crop)), int(h * (1 - crop))))
    im = im.convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    b = np.roll(a, (size // 2, size // 2), axis=(0, 1))
    y, x = np.mgrid[0:size, 0:size]
    # weight of the original: 1 in the middle, 0 at the edges
    wx = 1 - np.abs((x + 0.5) / size * 2 - 1)
    wy = 1 - np.abs((y + 0.5) / size * 2 - 1)
    w8 = np.clip(np.minimum(wx, wy) * 4, 0, 1)[..., None]
    out = a * w8 + b * (1 - w8)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGB')


THEMES = ('frozen', 'picnic', 'toys', 'garage', 'bath')
TEXTURES = (
    'sponge', 'pink', 'brownie', 'ice', 'soil', 'biscuit',  # frozen, picnic
    'cardboard', 'paper', 'eraser', 'wood',  # toy desk
    'dirt', 'steel', 'rubber', 'crate',  # garage
    'spongey', 'spongeg', 'soap', 'tile',  # bathroom harbour
)
PROPS = (
    ('props_frozen', ['tub', 'cone', 'popsicle', 'icecubes']),
    ('props_picnic', ['strawberry', 'daisy', 'biscuits', 'bush']),
    ('props_toys', ['crayon', 'block', 'paintpot', 'sharpener']),
    ('props_garage', ['nut', 'spring', 'trafficcone', 'oilcan']),
    ('props_bath', ['duck', 'soapbottle', 'toothbrushes', 'bubbles']),
)
# terrain objects for object-built maps: one picture each in <raw-dir>/pieces/<name>.png
PIECES = (
    'soap_pink', 'soap_green', 'sponge_yellow', 'sponge_blue', 'tile_slab', 'toothbrush', 'duck_big', 'shampoo',  # bath
    'tires', 'crate', 'toolbox', 'steel_beam', 'drum', 'bricks', 'gear', 'plank',  # garage
    'book_red', 'book_stack', 'pencil', 'eraser_big', 'toy_block', 'crayon_box', 'ruler', 'pencil_mug',  # toy desk
    'donut_pink', 'donut_choc', 'donut_mint', 'donut_stack', 'icecream_tub', 'ice_block', 'cake_slab', 'icecream_sandwich', 'popsicle', 'wafer',  # frozen
    'soil_chunk', 'biscuit_stack', 'sandwich', 'watermelon', 'cheese', 'basket', 'apple', 'breadstick', 'spoon',  # picnic
)
# sheets whose objects come in loose pieces (a bubble cluster)
ATTACH = {'props_bath': 120}
# objects with a see-through hole in the middle
HOLES = {'nut', 'gear', 'donut_pink', 'donut_choc', 'donut_mint', 'basket'}


def punch_holes(img, thr=40, min_area=400):
    """Near-white regions enclosed by the object (the hole in a nut) become transparent."""
    a = np.asarray(img).astype(np.float32)
    dist = np.sqrt(((255 - a[..., :3]) ** 2).sum(axis=2))
    white = (dist < thr) & (a[..., 3] > 0)
    lab, k = ndimage.label(white)
    out = a.copy()
    for i in range(1, k + 1):
        m = lab == i
        if m.sum() >= min_area:
            out[..., 3] = np.where(ndimage.binary_dilation(m, iterations=1), 0, out[..., 3])
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def main():
    (OUT / 'tex').mkdir(parents=True, exist_ok=True)
    for d in (*THEMES, 'props', 'gumling', 'hats'):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'textures': {}, 'backdrops': {}, 'props': {}, 'gumling': {}, 'hats': {}, 'pieces': {}}

    for theme in THEMES:
        bg = Image.open(RAW / f'{theme}_bg.png').convert('RGB')
        bg = bg.resize((2560, round(2560 * bg.height / bg.width)), Image.LANCZOS)
        bg.save(OUT / theme / 'bg.jpg', quality=86)
        manifest['backdrops'][theme] = f'{theme}/bg.jpg'

    crops = {'biscuit': 0.12}
    for t in TEXTURES:
        tileable(Image.open(RAW / f'tex_{t}.png'), 512, crops.get(t, 0)).save(OUT / 'tex' / f'{t}.png', optimize=True)
        manifest['textures'][t] = f'tex/{t}.png'

    for sheet, names in PROPS:
        for name, im in zip(names, parts(cutout(load(f'{sheet}.png')), 4, attach=ATTACH.get(sheet, 40))):
            if name in HOLES:
                im = punch_holes(im)
            fit(im, 512).save(OUT / 'props' / f'{name}.png', optimize=True)
            manifest['props'][name] = f'props/{name}.png'

    poses = parts(cutout(load('gumling_sheet.png')), 4, attach=80)
    for name, im in zip(['idle', 'walk', 'jump', 'hurt'], poses):
        fit(im, 256).save(OUT / 'gumling' / f'{name}.png', optimize=True)
        manifest['gumling'][name] = f'gumling/{name}.png'

    hats = parts(cutout(load('hats.png')), 8, attach=20)
    for name, im in zip(['helmet', 'aviator', 'chef', 'bandana', 'miner', 'beret', 'hardhat', 'captain'], hats):
        if name == 'helmet':
            im = im.crop((0, 0, im.width, int(im.height * 0.66)))  # drop the chin strap loop
        fit(im, 192).save(OUT / 'hats' / f'{name}.png', optimize=True)
        manifest['hats'][name] = f'hats/{name}.png'

    (OUT / 'pieces').mkdir(parents=True, exist_ok=True)
    for name in PIECES:
        src = RAW / 'pieces' / f'{name}.png'
        if not src.exists():
            continue
        im = parts(cutout(Image.open(src).convert('RGBA')), 1, attach=400)[0]
        if name in HOLES:
            im = punch_holes(im)
        fit(im, 1024).save(OUT / 'pieces' / f'{name}.png', optimize=True)
        manifest['pieces'][name] = f'pieces/{name}.png'

    to_webp(OUT, manifest)
    print('ok', sum(len(v) for v in manifest.values() if isinstance(v, dict)), 'assets')


if __name__ == '__main__':
    if RAW.name == '--webp':
        to_webp(OUT, json.loads((OUT / 'manifest.json').read_text()))
        print('converted', OUT)
    else:
        main()
