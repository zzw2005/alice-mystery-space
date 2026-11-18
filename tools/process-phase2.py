#!/usr/bin/env python3
"""Phase-2 materials: key green sources, anchor to standing calibration
(bottom 85%, center 51%, height 68% of 640x360), encode VP9-alpha WebM.
Accessories: key + crop to alpha PNG."""
import sys, subprocess, json
from pathlib import Path
import cv2, numpy as np

BASE = Path(__file__).parent
OUT = BASE / "processed"; OUT.mkdir(exist_ok=True)
W, H = 640, 360
FOOT, CX, HEIGHT = 0.85 * H, 0.51 * W, 0.68 * H

sys.path.insert(0, str(Path.home() / "workspace/butler-build/tools"))
import importlib.util
spec = importlib.util.spec_from_file_location("pg", Path.home() / "workspace/butler-build/tools/process-green.py")
# process-green.py runs argparse at import; instead copy its key function logic inline:
def key_rgba(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hue, sat, value = hsv[:, :, 0] * 2, hsv[:, :, 1], hsv[:, :, 2]
    hue_key = np.clip((hue - 65) / 15, 0, 1) * np.clip((175 - hue) / 15, 0, 1)
    matte = hue_key * np.clip((sat - 35) / 55, 0, 1) * np.clip((value - 35) / 45, 0, 1)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).copy()
    edge = (matte > 0) & (matte < 1)
    rgb[:, :, 1][edge] = np.minimum(rgb[:, :, 1][edge], np.maximum(rgb[:, :, 0][edge], rgb[:, :, 2][edge]))
    alpha = ((1 - matte) * 255).astype(np.uint8)
    return np.dstack([rgb, alpha])

def bbox_of(alpha):
    ys, xs = np.where(alpha > 16)
    if len(xs) == 0: return None
    return xs.min(), ys.min(), xs.max(), ys.max()

def process_video(src, name, frame_range=None):
    cap = cv2.VideoCapture(str(src))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok: break
        frames.append(key_rgba(fr))
    cap.release()
    if frame_range: frames = frames[frame_range[0]:frame_range[1]]
    boxes = [bbox_of(f[:, :, 3]) for f in frames]
    heights = np.array([b[3] - b[1] + 1 for b in boxes if b])
    standing_h = np.percentile(heights, 90)  # neutral standing height in source px
    scale = HEIGHT / standing_h
    tmp = OUT / f"{name}-raw.mkv"
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
                            "-s", f"{W}x{H}", "-r", "24", "-i", "-", "-c:v", "ffv1", str(tmp)],
                           stdin=subprocess.PIPE)
    stats = []
    for fr, b in zip(frames, boxes):
        canvas = np.zeros((H, W, 4), np.uint8)
        if b:
            x0, y0, x1, y1 = b
            sw, sh = int((x1 - x0 + 1) * scale), int((y1 - y0 + 1) * scale)
            crop = fr[y0:y1 + 1, x0:x1 + 1]
            crop = cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_AREA)
            dx = int(round(CX - (x0 + (x1 - x0 + 1) / 2 - x0) * scale - sw / 2 + (x0 * 0)))  # placeholder, recomputed below
            # place: source center-x -> CX, source bottom -> FOOT
            cx_src = (x0 + x1 + 1) / 2
            dx = int(round(CX - cx_src * scale + x0 * scale))
            dy = int(round(FOOT - (y1 + 1) * scale + y0 * scale))
            # simpler: dx = CX - (cx_src - x0)*scale - ... -> use direct paste offsets:
            dx = int(round(CX - (cx_src - x0) * scale))
            dy = int(round(FOOT - (y1 + 1 - y0) * scale))
            xs, ys = max(dx, 0), max(dy, 0)
            xe, ye = min(dx + sw, W), min(dy + sh, H)
            if xe > xs and ye > ys:
                canvas[ys:ye, xs:xe] = crop[ys - dy:ye - dy, xs - dx:xe - dx]
            nb = bbox_of(canvas[:, :, 3])
            if nb: stats.append((nb[3] + 1, (nb[0] + nb[2] + 1) / 2, nb[3] - nb[1] + 1))
        # production format is character-on-black (player composites additively)
        a = canvas[:, :, 3:4].astype(np.float32) / 255
        bgr = cv2.cvtColor((canvas[:, :, :3].astype(np.float32) * a).astype(np.uint8), cv2.COLOR_RGB2BGR)
        enc.stdin.write(bgr.tobytes())
    enc.stdin.close(); enc.wait()
    out = OUT / f"{name}.webm"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-c:v", "libvpx-vp9",
                    "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", "28", "-an", str(out)], check=True)
    tmp.unlink()
    bots = np.array([s[0] for s in stats]); cens = np.array([s[1] for s in stats]); hts = np.array([s[2] for s in stats])
    print(f"{name}: frames={len(frames)} bottom med={np.median(bots):.1f} center med={np.median(cens):.1f} "
          f"height p90={np.percentile(hts, 90):.1f} size={out.stat().st_size}")
    # loop seam: first vs last frame alpha MAE
    a0 = frames[0][:, :, 3].astype(float); a1 = frames[-1][:, :, 3].astype(float)
    print(f"{name}: source first/last alpha MAE={np.abs(a0 - a1).mean():.2f}")

def process_image(src, name):
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    rgba = key_rgba(img)
    b = bbox_of(rgba[:, :, 3])
    x0, y0, x1, y1 = b
    pad = 8
    x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
    x1, y1 = min(x1 + pad, rgba.shape[1] - 1), min(y1 + pad, rgba.shape[0] - 1)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    out = OUT / f"{name}.png"
    cv2.imwrite(str(out), cv2.cvtColor(crop, cv2.COLOR_RGBA2BGRA))
    print(f"{name}: {crop.shape[1]}x{crop.shape[0]} size={out.stat().st_size}")

if __name__ == "__main__":
    process_video(BASE / "media-generation-headpat-source-v2-0-e80f7d2b-9f26-4ece-bde8-9b9635ffd573.mp4", "headpat")
    process_video(BASE / "media-generation-tickle-source-0-11b4bf3e-e2a1-46c0-8641-19581897d8aa.mp4", "tickle", frame_range=(98, 173))
    process_image(BASE / "media-generation-fest-christmas-hat-0-79722d58-8c2c-42bc-acab-434a6e78b5d1.webp", "overlay-christmas-hat")
    process_image(BASE / "media-generation-fest-spring-ornament-0-02208f8c-3d6d-4d12-8410-296cbc23f6a7.webp", "overlay-spring-knot")
    process_image(BASE / "media-generation-fest-birthday-crown-0-4908168c-1c7e-49ae-9051-0c85ad89b9c7.webp", "overlay-birthday-crown")
