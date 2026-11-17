import numpy as np, os, subprocess, sys, json
from PIL import Image
CLIPS = {
    'dance':    ('media-generation-pet-dance-test-0-cfb24771-8f5d-424f-8fd3-60d244f699ec.mp4', 12, 'once'),
    'breathe':  ('media-generation-pet-breathe-0-6ffc4fd4-4345-4394-9603-7f50406af4d1.mp4', 8, 'loop'),
    'wave':     ('media-generation-pet-wave-0-a29554f4-1757-47a0-8e4b-9ca42b469efb.mp4', 12, 'once'),
    'walk':     ('media-generation-pet-walk-0-1ffb5462-b22c-4cac-8c0a-96d25c869a62.mp4', 12, 'loop'),
    'doze':     ('media-generation-pet-doze-0-45a41b65-276d-4205-af12-e4939436c9fc.mp4', 8, 'loop'),
    'celebrate':('media-generation-pet-celebrate-0-0023811b-bbbe-43fa-a5ac-086e40543036.mp4', 12, 'once'),
}
BASE = '/home/hatch/workspace/butler-build'
TARGET_H = 400
def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    hue = np.zeros_like(mx); nz = d > 1e-6
    idx = nz & (mx == r); hue[idx] = (60 * ((g - b)[idx] / d[idx]) + 360) % 360
    idx = nz & (mx == g); hue[idx] = 60 * ((b - r)[idx] / d[idx]) + 120
    idx = nz & (mx == b); hue[idx] = 60 * ((r - g)[idx] / d[idx]) + 240
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    return hue, sat, mx
def key_frames(mp4, fps, tmp):
    os.makedirs(tmp, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-vf', 'fps=%d' % fps, os.path.join(tmp, 'f%03d.png')], check=True)
    files = sorted(os.listdir(tmp))
    frames = []; union = None
    for fn in files:
        im = np.asarray(Image.open(os.path.join(tmp, fn)).convert('RGB')).astype(np.float32) / 255.0
        hue, sat, val = rgb_to_hsv(im)
        lo, hi, feather = 70.0, 170.0, 18.0
        in_hue = np.clip((hue - (lo - feather)) / feather, 0, 1) * np.clip(((hi + feather) - hue) / feather, 0, 1)
        bg = in_hue * np.clip((sat - 0.18) / 0.15, 0, 1) * np.clip((val - 0.08) / 0.12, 0, 1)
        alpha = 1.0 - bg
        r, g, b = im[..., 0].copy(), im[..., 1].copy(), im[..., 2].copy()
        g = np.minimum(g, np.maximum(r, b) + 0.12 * alpha + 0.02)
        out = np.dstack([r, g, b, alpha])
        frames.append(out)
        m = alpha > 0.5
        ys, xs = np.where(m)
        box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        union = box if union is None else (min(union[0], box[0]), min(union[1], box[1]), max(union[2], box[2]), max(union[3], box[3]))
    return frames, union
def thumb(fr):
    im = Image.fromarray((np.clip(fr, 0, 1) * 255).astype(np.uint8), 'RGBA').resize((48, 48), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)
meta = {}
for name, (fn, fps, kind) in CLIPS.items():
    tmp = '/tmp/clip-' + name
    frames, (x0, y0, x1, y1) = key_frames(os.path.join(BASE, 'clips', fn), fps, tmp)
    W, H = x1 - x0 + 1, y1 - y0 + 1
    scale = TARGET_H / H
    nW, nH = int(W * scale), TARGET_H
    imgs = []
    for fr in frames:
        crop = fr[y0:y1 + 1, x0:x1 + 1]
        im = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), 'RGBA').resize((nW, nH), Image.LANCZOS)
        small = im.resize((max(8, nW // 4), max(8, nH // 4)), Image.LANCZOS)
        imgs.append(small.resize((nW, nH), Image.NEAREST))
    start, end = 0, len(imgs)
    if kind == 'loop':
        t0 = thumb(np.asarray(imgs[0]).astype(np.float32) / 255.0)
        best, bestd = len(imgs) - 1, 1e18
        for i in range(int(fps * 1.2), len(imgs)):
            d = np.abs(thumb(np.asarray(imgs[i]).astype(np.float32) / 255.0) - t0).mean()
            if d < bestd: bestd, best = d, i
        end = best + 1
    else:
        # trim static head/tail: frame-to-frame motion energy
        th = [thumb(np.asarray(im).astype(np.float32) / 255.0) for im in imgs]
        energy = [0] + [float(np.abs(th[i] - th[i - 1]).mean()) for i in range(1, len(imgs))]
        act = [i for i, e in enumerate(energy) if e > 0.6]
        if act:
            start = max(0, act[0] - int(fps * 0.4)); end = min(len(imgs), act[-1] + int(fps * 0.5))
    out = os.path.join(BASE, 'AliceButler/assets/anim', name)
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out): os.remove(os.path.join(out, old))
    for i in range(start, end):
        imgs[i].save(os.path.join(out, 'f%03d.png' % (i - start)))
    meta[name] = {'fps': fps, 'kind': kind, 'frames': end - start, 'w': nW, 'h': nH}
    print(name, meta[name], flush=True)
    # contact sheet
    cnt = end - start
    picks = [start + int(cnt * k / 5) for k in range(5)]
    sheet = Image.new('RGBA', (nW // 2 * 5, nH // 2), (38, 48, 60, 255))
    for j, idx in enumerate(picks):
        fr = imgs[idx].resize((nW // 2, nH // 2), Image.LANCZOS)
        sheet.paste(fr, (j * nW // 2, 0), fr)
    sheet.convert('RGB').save(os.path.join(BASE, 'sheet-' + name + '.png'))
json.dump(meta, open(os.path.join(BASE, 'AliceButler/assets/anim/meta.json'), 'w'), indent=1)
print('ALL DONE', meta)
