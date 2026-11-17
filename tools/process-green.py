"""Approved green source -> HSV key -> fixed anchor registration -> VP9-alpha.

Requires numpy, opencv-python, Pillow and ffmpeg with libvpx-vp9.
No video generation, old animation frames or downloaded reference assets.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZE = (640, 360)


def key_rgba(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hue, sat, value = hsv[:, :, 0] * 2, hsv[:, :, 1], hsv[:, :, 2]
    hue_key = np.clip((hue - 65) / 15, 0, 1) * np.clip((175 - hue) / 15, 0, 1)
    matte = hue_key * np.clip((sat - 35) / 55, 0, 1) * np.clip((value - 35) / 45, 0, 1)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).copy()
    # Only suppress green spill in the keyed boundary, never recolor opaque skin/clothes.
    edge = (matte > 0) & (matte < 1)
    rgb[:, :, 1][edge] = np.minimum(rgb[:, :, 1][edge], np.maximum(rgb[:, :, 0][edge], rgb[:, :, 2][edge]))
    alpha = np.round((1 - matte) * 255).astype(np.uint8)
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def bbox(rgba):
    ys, xs = np.where(rgba[:, :, 3] > 128)
    if not len(xs):
        raise ValueError('Empty keyed character')
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def registration(anchor):
    x0, y0, x1, y1 = bbox(anchor)
    scale = SIZE[1] * .65 / (y1 - y0)
    return np.float32([[scale, 0, SIZE[0] / 2 - (x0 + x1) / 2 * scale],
                       [0, scale, SIZE[1] * .85 - y1 * scale]])


def match_sleep(frame, target):
    x0, y0, x1, y1 = bbox(frame)
    a, b, c, d = bbox(target)
    scale = (d - b) / (y1 - y0)
    return np.float32([[scale, 0, (a + c) / 2 - (x0 + x1) / 2 * scale], [0, scale, d - y1 * scale]])


def normalize(rgba, matrix):
    # Premultiplied interpolation avoids green/black fringes on transparent edges.
    f = rgba.astype(np.float32) / 255
    f[:, :, :3] *= f[:, :, 3:4]
    f = cv2.warpAffine(f, matrix, SIZE, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    a = np.clip(f[:, :, 3:4], 0, 1)
    rgb = np.divide(f[:, :, :3], a, out=np.zeros_like(f[:, :, :3]), where=a > .001)
    return np.round(np.clip(np.concatenate((rgb, a), axis=2), 0, 1) * 255).astype(np.uint8)


def encode(ffmpeg, frames, fps, dest):
    pending = dest.with_suffix('.tmp.webm')
    cmd = [ffmpeg, '-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '640x360',
           '-framerate', str(fps), '-i', '-', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
           '-b:v', '0', '-crf', '28', '-auto-alt-ref', '0', '-row-mt', '1', '-threads', '4',
           '-deadline', 'good', '-cpu-used', '4', str(pending)]
    with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
        try:
            for frame in frames:
                proc.stdin.write(frame.tobytes())
            proc.stdin.close()
        except BaseException:
            proc.kill()
            raise
        if proc.wait() != 0:
            raise RuntimeError('VP9 encode failed')
    os.replace(pending, dest)


def inspect(ffmpeg, file, first_png=None, last_png=None):
    cmd = [ffmpeg, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(file), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']
    count = 0
    worst_black = 0
    transparent = False
    first = last = None
    boxes = []
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as proc:
        while True:
            raw = proc.stdout.read(SIZE[0] * SIZE[1] * 4)
            if not raw:
                break
            if len(raw) != SIZE[0] * SIZE[1] * 4:
                raise ValueError('Truncated decoded frame')
            arr = np.frombuffer(raw, np.uint8).reshape(SIZE[1], SIZE[0], 4).copy()
            transparent |= bool((arr[:, :, 3] == 0).any())
            black = np.all(arr[:, :, :3] < 5, axis=2) & (arr[:, :, 3] >= 250)
            worst_black = max(worst_black, float(black.mean()))
            boxes.append(bbox(arr))
            if first is None:
                first = arr
            last = arr
            count += 1
        if proc.wait() != 0 or count == 0:
            raise ValueError('Decode failed')
    if not transparent or worst_black >= .05:
        raise ValueError(f'Alpha/black gate failed: {file}, {worst_black}')
    if first_png:
        Image.fromarray(first).save(first_png)
        Image.fromarray(last).save(last_png)
    return {'frames': count, 'bytes': file.stat().st_size, 'maxOpaqueBlackRatio': worst_black,
            'alphaPresent': transparent, 'firstBox': boxes[0], 'lastBox': boxes[-1],
            'topRange': [min(b[1] for b in boxes), max(b[1] for b in boxes)],
            'footRange': [min(b[3] for b in boxes), max(b[3] for b in boxes)],
            'endpointMeanAbsoluteDifference': float(np.abs(first.astype(float) - last).mean()),
            'endpointExact': bool(np.array_equal(first, last))}, first, last


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'AliceButler/electron/media')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/green-assets-validation.json')
    args = parser.parse_args()
    source = ROOT / 'clips-green/v2'
    args.output.mkdir(parents=True, exist_ok=True)
    endpoints = {}
    report = {'sourceRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'route': 'green HSV; fixed per-clip affine; standing start registration, sleeping clips registered to approved entry tail', 'size': list(SIZE), 'clips': {}}
    files = sorted(source.glob('*.mp4'), key=lambda p: (p.stem != 'sleepstart', p.name))
    for file in files:
        cap = cv2.VideoCapture(str(file))
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not cap.isOpened() or fps <= 0:
            raise ValueError(f'Cannot open {file}')
        # v2 has a common canvas/anchor; never recenter individual frames (causes jitter).
        frames = []
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            frames.append(key_rgba(bgr))
        cap.release()
        if not frames:
            raise ValueError(f'No frames: {file}')
        matrix = match_sleep(frames[0], sleep_tail) if file.stem in ('doze', 'wakeup') else registration(frames[0])
        frames = [normalize(frame, matrix) for frame in frames]
        if file.stem == 'sleepstart':
            sleep_tail = frames[-1]
        dest = args.output / (file.stem + '.webm')
        encode(args.ffmpeg, frames, fps, dest)
        metrics, first, last = inspect(args.ffmpeg, dest)
        metrics.update({'source': file.relative_to(ROOT).as_posix(), 'sourceSha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'fps': fps, 'fixedAffine': matrix.tolist()})
        report['clips'][file.stem] = metrics
        endpoints[file.stem] = first, last
        print(file.stem, json.dumps(metrics), flush=True)
    report['seams'] = {}
    for name, left, right in [('entry-loop', ('sleepstart', 1), ('doze', 0)), ('loop-loop', ('doze', 1), ('doze', 0)),
                              ('loop-wake', ('doze', 1), ('wakeup', 0)), ('wake-entry', ('wakeup', 1), ('sleepstart', 0))]:
        a, b = endpoints[left[0]][left[1]], endpoints[right[0]][right[1]]
        report['seams'][name] = {'exact': bool(np.array_equal(a, b)), 'rgbaMAE': float(np.abs(a.astype(float) - b).mean())}
    report['totalWebmBytes'] = sum(c['bytes'] for c in report['clips'].values())
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
