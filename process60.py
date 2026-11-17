# 60fps pipeline: detect trim at 24fps -> minterpolate segment -> key -> normalize -> 400x462 frames
import cv2, numpy as np, os, json, sys, subprocess
from PIL import Image

BB = os.path.expanduser('~/workspace/butler-build')
SRC = os.path.join(BB, 'clips-flat2')
OUT = os.path.join(BB, 'AliceButler', 'assets', 'anim60')
FILES = {
 'breathe': 'media-generation-alice2-breathe-0-399bee34-ce5f-4cbe-bfa1-19219c08faf3.mp4',
 'wave': 'media-generation-alice2-wave-0-1f111cb1-447e-4db4-b967-a75c2cfa65ba.mp4',
 'walk': 'media-generation-alice2-walk-0-699b2a5a-09d2-426d-af72-6aa943909b5c.mp4',
 'doze': 'media-generation-alice2-doze-0-8d528b30-3d7f-45ff-9ad3-337348e1b375.mp4',
 'celebrate': 'media-generation-alice2-celebrate-0-62afa0f9-e8c6-4718-8cd2-e62a15f16439.mp4',
 'sit': 'media-generation-alice2-sit-0-343984b6-1336-4c03-9358-58052f50c5b9.mp4',
 'water': 'media-generation-alice2-water-0-11fbfecb-c710-4169-9678-83058f14988d.mp4',
 'fish': 'media-generation-alice2-fish-0-1aaea2af-5e42-4450-8d19-e215b1476c2c.mp4',
 'wiggle': 'media-generation-alice2-wiggle-0-a60e50e0-1fc0-431f-915a-6fc14616f3bd.mp4',
}
MODES = {'breathe': 'loop', 'walk': 'loop', 'doze': 'loop', 'sit': 'loop', 'wave': 'oneshot', 'celebrate': 'oneshot', 'water': 'loop', 'fish': 'loop', 'wiggle': 'loop'}

def key_rgba(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    hue = h.astype(np.float32) * 2.0
    greenish = ((hue >= 70) & (hue <= 170) & (s > 70) & (v > 50)).astype(np.float32)
    dh = np.minimum(np.abs(hue - 120), 360 - np.abs(hue - 120))
    feather = np.clip((dh - 40) / 30.0, 0, 1)
    a8 = ((1.0 - greenish * feather) * 255).astype(np.uint8)
    out = bgr.astype(np.float32).copy()
    g = out[:, :, 1]; mx = np.maximum(out[:, :, 0], out[:, :, 2])
    spill = (greenish > 0) & (g > mx)
    out[:, :, 1] = np.where(spill, mx, g)
    rgb = cv2.cvtColor(out.astype(np.uint8), cv2.COLOR_BGR2RGB)
    return np.dstack([rgb, a8])

def extract24(path):
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok: break
        frames.append(key_rgba(fr))
    cap.release()
    return frames

def thumb_rgba(rgba, size=96):
    return np.asarray(Image.fromarray(rgba).resize((size, size), Image.LANCZOS).convert('RGB'), dtype=np.float32)

def detect_segments(name, frames24):
    if name == 'breathe':
        return [(0, 16), (38, 57)]  # 0-0.7s + 1.6-2.4s at 24fps (matches hand trim)
    if MODES[name] == 'loop':
        t0 = thumb_rgba(frames24[0])
        sims = [float(np.abs(t0 - thumb_rgba(f)).mean()) for f in frames24]
        lo = len(frames24) // 2
        cand = min(range(lo, len(frames24)), key=lambda i: sims[i])
        end = cand if cand >= 24 else len(frames24) - 1
        if name == 'walk': end = max(24, end - 10)  # drop turn-to-front tail
        return [(0, end)]
    thumbs = [thumb_rgba(f) for f in frames24]
    energy = [0.0] + [float(np.abs(thumbs[i] - thumbs[i - 1]).mean()) for i in range(1, len(frames24))]
    start = 0
    for i, e in enumerate(energy):
        if e > 1.1: start = max(0, i - 2); break
    end = len(frames24) - 1
    for i in range(len(frames24) - 1, start + 12, -1):
        if energy[i] > 1.1: end = i + 4; break
    return [(start, end)]

def interpolate(src_path, a_idx, b_idx, out_path):
    a, b = a_idx / 24.0, b_idx / 24.0
    cmd = ['ffmpeg', '-y', '-v', 'error', '-ss', '%.3f' % a, '-to', '%.3f' % b, '-i', src_path,
           '-vf', 'minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1',
           '-an', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', out_path]
    subprocess.run(cmd, check=True)

def normalize(frames, target_h=400):
    def bbox_of(rgba):
        ys, xs = np.where(rgba[:, :, 3] > 12)
        if len(xs) == 0: return None
        return xs.min(), ys.min(), xs.max(), ys.max()
    boxes = [bbox_of(f) for f in frames]
    boxes = [b for b in boxes if b]
    if not boxes: return []
    H = max(b[3] - b[1] + 1 for b in boxes)
    scale = target_h / H
    out = []
    for f in frames:
        b = bbox_of(f)
        if b is None: continue
        x0, y0, x1, y1 = b
        crop = f[y0:y1 + 1, x0:x1 + 1]
        nw, nh = max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale))
        im = Image.fromarray(crop).resize((nw, nh), Image.LANCZOS)
        canvas = Image.new('RGBA', (460, 414), (0, 0, 0, 0))
        canvas.paste(im, ((460 - nw) // 2, 414 - 6 - nh), im)
        out.append(canvas)
    return out

def to_frame_file(im460):
    rs = im460.resize((627, 564), Image.LANCZOS)
    canvas = Image.new('RGBA', (520, 600), (0, 0, 0, 0))
    canvas.paste(rs, (-53, 29), rs)
    return canvas.resize((400, 462), Image.LANCZOS)

def main(name):
    src_path = os.path.join(SRC, FILES[name])
    frames24 = extract24(src_path)
    segs = detect_segments(name, frames24)
    print(name, 'segments(24fps idx):', segs, flush=True)
    all_frames = []
    for si, (a, b) in enumerate(segs):
        seg60 = '/tmp/seg60-%s-%d.mp4' % (name, si)
        interpolate(src_path, a, b, seg60)
        cap = cv2.VideoCapture(seg60)
        while True:
            ok, fr = cap.read()
            if not ok: break
            all_frames.append(key_rgba(fr))
        cap.release()
        print(' seg', si, 'total frames so far', len(all_frames), flush=True)
    norm = normalize(all_frames)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for old in os.listdir(d): os.remove(os.path.join(d, old))
    for i, fr in enumerate(norm):
        to_frame_file(fr).save(os.path.join(d, 'f%03d.png' % i), optimize=True)
    json.dump({'frames': len(norm), 'fps': 60, 'mode': MODES[name]}, open(os.path.join(d, 'meta.json'), 'w'))
    sheet = Image.new('RGB', (min(len(norm), 60) * 32, 32), (24, 24, 28))
    for i, f in enumerate(norm[::max(1, len(norm) // 60)][:60]):
        im = f.resize((32, 32), Image.LANCZOS)
        bg = Image.new('RGBA', (32, 32), (24, 24, 28, 255)); bg.alpha_composite(im)
        sheet.paste(bg.convert('RGB'), (i * 32, 0))
    sheet.save(os.path.join(OUT, name + '-sheet60.png'))
    print(name, 'DONE frames:', len(norm), flush=True)

if __name__ == '__main__':
    main(sys.argv[1])
