# Flat-style clip pipeline: extract -> HSV key -> normalize (no pixelation) -> loop/one-shot trim -> assets/anim-flat
import cv2, numpy as np, os, json, sys
from PIL import Image

SRC = os.path.expanduser('~/workspace/butler-build/clips-flat')
OUT = os.path.expanduser('~/workspace/butler-build/AliceButler/assets/anim-flat')
FPS = 10
TARGET_H = 400
FEET_PAD = 6
CANVAS_W = 460

CLIPS = {
    'breathe':   ('media-generation-alice-flat-breathe-0-089b80cf-c781-4163-b695-cd99f57d8293.mp4', 'loop'),
    'wave':      ('media-generation-alice-flat-wave-0-ed9d0d8f-21bd-4886-acbb-795180ac94e3.mp4', 'oneshot'),
    'walk':      ('media-generation-alice-flat-walk-0-8aff7475-87f3-4c4f-8ab3-82efd8e40252.mp4', 'loop'),
    'doze':      ('media-generation-alice-flat-doze-0-4ab698d4-78c3-40ca-b45b-4e3a1178dcbc.mp4', 'loop'),
    'celebrate': ('media-generation-alice-flat-celebrate-0-cdbad786-781a-4703-a084-a0a088816c87.mp4', 'oneshot'),
    'sit':       ('media-generation-alice-flat-sit-0-0da567c5-6c88-4aff-848e-eb25d694d523.mp4', 'loop'),
}

def key_rgba(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    hue_deg = h.astype(np.float32) * 2.0
    greenish = ((hue_deg >= 70) & (hue_deg <= 170) & (s > 70) & (v > 50)).astype(np.float32)
    dh = np.minimum(np.abs(hue_deg - 120), 360 - np.abs(hue_deg - 120))
    feather = np.clip((dh - 40) / 30.0, 0, 1)
    alpha = 1.0 - greenish * feather
    a8 = (alpha * 255).astype(np.uint8)
    # despill
    out = bgr.astype(np.float32).copy()
    g = out[:, :, 1]; mx = np.maximum(out[:, :, 0], out[:, :, 2])
    spill = (greenish > 0) & (g > mx)
    out[:, :, 1] = np.where(spill, mx, g)
    rgba = cv2.cvtColor(out.astype(np.uint8), cv2.COLOR_BGR2RGB)
    return np.dstack([rgba, a8])

def extract(path):
    cap = cv2.VideoCapture(path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 24
    step = max(1, round(src_fps / FPS))
    frames, i = [], 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        if i % step == 0: frames.append(key_rgba(fr))
        i += 1
    cap.release()
    return frames

def bbox_of(rgba):
    ys, xs = np.where(rgba[:, :, 3] > 12)
    if len(xs) == 0: return None
    return xs.min(), ys.min(), xs.max(), ys.max()

def normalize(frames):
    boxes = [bbox_of(f) for f in frames]
    boxes = [b for b in boxes if b]
    if not boxes: return []
    H = max(b[3] - b[1] + 1 for b in boxes)
    scale = TARGET_H / H
    out = []
    for f, b in zip(frames, [bbox_of(fr) for fr in frames]):
        if b is None: continue
        x0, y0, x1, y1 = b
        crop = f[y0:y1 + 1, x0:x1 + 1]
        nw, nh = max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale))
        im = Image.fromarray(crop).resize((nw, nh), Image.LANCZOS)
        canvas_h = TARGET_H + FEET_PAD + 8
        canvas = Image.new('RGBA', (CANVAS_W, canvas_h), (0, 0, 0, 0))
        cx = (CANVAS_W - nw) // 2
        cy = canvas_h - FEET_PAD - nh
        canvas.paste(im, (cx, cy), im)
        out.append(np.array(canvas))
    return out

def thumb(rgba, size=96):
    im = Image.fromarray(rgba).resize((size, size), Image.LANCZOS)
    return np.asarray(im.convert('RGB'), dtype=np.float32)

def diff(a, b):
    return float(np.abs(a - b).mean())

def trim_loop(frames):
    if len(frames) < 8: return frames
    t0 = thumb(frames[0])
    sims = [diff(t0, thumb(f)) for f in frames]
    lo = len(frames) // 2
    cand = min(range(lo, len(frames)), key=lambda i: sims[i])
    return frames[:cand + 1] if cand >= 6 else frames

def trim_oneshot(frames):
    if len(frames) < 8: return frames
    thumbs = [thumb(f) for f in frames]
    energy = [0.0] + [diff(thumbs[i], thumbs[i - 1]) for i in range(1, len(frames))]
    start = 0
    for i, e in enumerate(energy):
        if e > 1.1: start = max(0, i - 1); break
    end = len(frames)
    for i in range(len(frames) - 1, start + 5, -1):
        if energy[i] > 1.1: end = i + 2; break
    seg = frames[start:end]
    return seg if len(seg) >= 6 else frames

os.makedirs(OUT, exist_ok=True)
summary = {}
for name, (fn, mode) in CLIPS.items():
    frames = extract(os.path.join(SRC, fn))
    frames = normalize(frames)
    frames = trim_loop(frames) if mode == 'loop' else trim_oneshot(frames)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for old in os.listdir(d):
        os.remove(os.path.join(d, old))
    for i, f in enumerate(frames):
        Image.fromarray(f).save(os.path.join(d, 'f%03d.png' % i))
    json.dump({'frames': len(frames), 'fps': FPS, 'mode': mode}, open(os.path.join(d, 'meta.json'), 'w'))
    sheet = Image.new('RGB', (len(frames) * 92, 92), (24, 24, 28))
    for i, f in enumerate(frames):
        im = Image.fromarray(f).resize((92, 92), Image.LANCZOS)
        bg = Image.new('RGBA', (92, 92), (24, 24, 28, 255)); bg.alpha_composite(im)
        sheet.paste(bg.convert('RGB'), (i * 92, 0))
    sheet.save(os.path.join(OUT, name + '-sheet.png'))
    summary[name] = len(frames)
    print(name, mode, '->', len(frames), 'frames')
print(json.dumps(summary))
