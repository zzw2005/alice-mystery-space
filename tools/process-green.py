"""Approved green source -> HSV key -> fixed calibration -> VP9-alpha WebM.

The nine files in clips-green/v2 are the complete formal action set. The
pipeline never reads legacy animation frames and never generates video.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZE = (640, 360)
CLIPS = {
    "idle": ("standing", True),
    "walk": ("standing", True),
    "wave": ("standing", False),
    "clickhappy": ("standing", False),
    "clickshy": ("standing", False),
    "clicktsun": ("standing", False),
    "sleepstart": ("standing", False),
    "doze": ("sleep", True),
    "wakeup": ("sleep", False),
}
TARGETS = {
    "standing": {"center": 0.51, "top": 0.17, "foot": 0.85, "height": 0.68},
    "sleep": {"center": 0.51, "top": 0.33, "foot": 0.85, "height": 0.52},
}


def key_rgba(bgr: np.ndarray) -> np.ndarray:
    """Key only the green backdrop and remove spill from its feathered edge."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hue, sat, value = hsv[:, :, 0] * 2, hsv[:, :, 1], hsv[:, :, 2]
    hue_key = np.clip((hue - 65) / 15, 0, 1) * np.clip((175 - hue) / 15, 0, 1)
    matte = hue_key * np.clip((sat - 35) / 55, 0, 1) * np.clip((value - 35) / 45, 0, 1)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).copy()
    edge = (matte > 0) & (matte < 1)
    rgb[:, :, 1][edge] = np.minimum(
        rgb[:, :, 1][edge], np.maximum(rgb[:, :, 0][edge], rgb[:, :, 2][edge])
    )
    alpha = np.round((1 - matte) * 255).astype(np.uint8)
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def body_metrics(rgba: np.ndarray, threshold: int = 32) -> dict:
    """Measure the largest connected opaque body, excluding Zzz and hearts."""
    mask = (rgba[:, :, 3] > threshold).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        raise ValueError("Empty keyed character")
    areas = stats[1:, cv2.CC_STAT_AREA]
    label = int(np.argmax(areas)) + 1
    x, y, w, h = (int(v) for v in stats[label, :4])
    return {
        "x0": x,
        "y0": y,
        "x1": x + w,
        "y1": y + h,
        "width": w,
        "height": h,
        "components": count - 1,
        "largestArea": int(areas[label - 1]),
    }


def normalized_box(box: dict) -> dict:
    return {
        "left": box["x0"] / SIZE[0],
        "right": box["x1"] / SIZE[0],
        "top": box["y0"] / SIZE[1],
        "foot": box["y1"] / SIZE[1],
        "center": (box["x0"] + box["x1"]) / 2 / SIZE[0],
        "width": box["width"] / SIZE[0],
        "height": box["height"] / SIZE[1],
    }


def registration(anchor: np.ndarray, calibration: str) -> np.ndarray:
    """Return one fixed transform for the whole clip."""
    body = body_metrics(anchor)
    target = TARGETS[calibration]
    source_center = (body["x0"] + body["x1"]) / 2
    scale = target["height"] * SIZE[1] / body["height"]
    x = target["center"] * SIZE[0] - source_center * scale
    y = target["foot"] * SIZE[1] - body["y1"] * scale
    return np.float32([[scale, 0, x], [0, scale, y]])


def normalize(rgba: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Premultiplied interpolation avoids dark/green fringes on transparency."""
    f = rgba.astype(np.float32) / 255
    f[:, :, :3] *= f[:, :, 3:4]
    f = cv2.warpAffine(
        f,
        matrix,
        SIZE,
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
    )
    alpha = np.clip(f[:, :, 3:4], 0, 1)
    rgb = np.divide(
        f[:, :, :3],
        alpha,
        out=np.zeros_like(f[:, :, :3]),
        where=alpha > 0.001,
    )
    return np.round(
        np.clip(np.concatenate((rgb, alpha), axis=2), 0, 1) * 255
    ).astype(np.uint8)


def encode(
    ffmpeg: str, frames: list[np.ndarray], fps: float, dest: Path, loop: bool
) -> None:
    pending = dest.with_suffix(".tmp.webm")
    cmd = [
        ffmpeg, "-v", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", f"{SIZE[0]}x{SIZE[1]}", "-framerate", str(fps), "-i", "-",
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-row-mt", "1", "-threads", "4", "-deadline", "good", "-cpu-used", "3",
    ]
    if loop:
        # Exact terminal frame plus an independent terminal key frame guarantees
        # a deterministic decoded loop point while retaining normal prediction.
        cmd += [
            "-lossless", "1", "-auto-alt-ref", "0",
            "-force_key_frames", f"expr:eq(n,0)+eq(n,{len(frames) - 1})",
        ]
    else:
        cmd += ["-b:v", "0", "-crf", "28", "-auto-alt-ref", "0"]
    cmd.append(str(pending))
    with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
        try:
            assert proc.stdin is not None
            for frame in frames:
                proc.stdin.write(frame.tobytes())
            proc.stdin.close()
        except BaseException:
            proc.kill()
            raise
        if proc.wait() != 0:
            raise RuntimeError("VP9 encode failed")
    os.replace(pending, dest)


def decode_frames(ffmpeg: str, file: Path) -> list[np.ndarray]:
    cmd = [
        ffmpeg, "-v", "error", "-c:v", "libvpx-vp9", "-i", str(file),
        "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ]
    frames = []
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as proc:
        assert proc.stdout is not None
        while True:
            raw = proc.stdout.read(SIZE[0] * SIZE[1] * 4)
            if not raw:
                break
            if len(raw) != SIZE[0] * SIZE[1] * 4:
                raise ValueError("Truncated decoded frame")
            frames.append(
                np.frombuffer(raw, np.uint8).reshape(SIZE[1], SIZE[0], 4).copy()
            )
        if proc.wait() != 0 or not frames:
            raise ValueError("Decode failed")
    return frames


def target_error(box: dict, calibration: str) -> dict:
    target = TARGETS[calibration]
    return {
        "topPx": abs(box["y0"] - target["top"] * SIZE[1]),
        "footPx": abs(box["y1"] - target["foot"] * SIZE[1]),
        "heightPx": abs(box["height"] - target["height"] * SIZE[1]),
        "centerPx": abs(
            (box["x0"] + box["x1"]) / 2 - target["center"] * SIZE[0]
        ),
        "actual": normalized_box(box),
    }


def inspect(
    ffmpeg: str, file: Path, calibration: str, loop: bool
) -> tuple[dict, np.ndarray, np.ndarray]:
    decoded = decode_frames(ffmpeg, file)
    worst_black = 0.0
    boxes32, boxes128 = [], []
    max_components = 0
    for frame in decoded:
        if not (frame[:, :, 3] == 0).any():
            raise ValueError(f"No transparent pixels: {file}")
        black = np.all(frame[:, :, :3] < 5, axis=2) & (frame[:, :, 3] >= 250)
        worst_black = max(worst_black, float(black.mean()))
        b32 = body_metrics(frame, 32)
        boxes32.append(b32)
        boxes128.append(body_metrics(frame, 128))
        max_components = max(max_components, b32["components"])
    if worst_black >= 0.05:
        raise ValueError(f"Opaque-black gate failed: {file}, {worst_black}")
    first, last = decoded[0], decoded[-1]
    delta = np.abs(first.astype(np.int16) - last.astype(np.int16))
    endpoint_mae = float(delta.mean())
    endpoint_exact = bool(np.array_equal(first, last))
    if loop and not endpoint_exact:
        raise ValueError(f"Loop endpoints differ after decode: {file}, MAE={endpoint_mae}")
    metrics = {
        "frames": len(decoded),
        "bytes": file.stat().st_size,
        "alphaPresent": True,
        "maxOpaqueBlackRatio": worst_black,
        "firstBodyBBoxPxAlpha32": boxes32[0],
        "lastBodyBBoxPxAlpha32": boxes32[-1],
        "firstBodyBBoxPxAlpha128": boxes128[0],
        "firstBodyBBoxPercent": normalized_box(boxes32[0]),
        "targetError": target_error(boxes32[0], calibration),
        "topRangePercent": [
            min(b["y0"] for b in boxes32) / SIZE[1],
            max(b["y0"] for b in boxes32) / SIZE[1],
        ],
        "footRangePercent": [
            min(b["y1"] for b in boxes32) / SIZE[1],
            max(b["y1"] for b in boxes32) / SIZE[1],
        ],
        "maxDetachedComponents": max_components,
        "loopSeam": {
            "exact": endpoint_exact,
            "rgbaMeanAbsoluteError": endpoint_mae,
            "maxChannelDelta": int(delta.max()),
            "changedChannels": int((delta != 0).sum()),
        },
    }
    return metrics, first, last


def process_clip(name: str, ffmpeg: str, output: Path, report_dir: Path) -> dict:
    if name not in CLIPS:
        raise ValueError(f"Unknown formal clip: {name}")
    calibration, loop = CLIPS[name]
    source = ROOT / "clips-green" / "v2" / f"{name}.mp4"
    if not source.is_file():
        raise ValueError(f"Missing formal source: {source}")
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError(f"Cannot open source: {source}")
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    keyed = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        keyed.append(key_rgba(bgr))
    cap.release()
    if not keyed or fps <= 0:
        raise ValueError(f"Invalid source: {source}")
    matrix = registration(keyed[0], calibration)
    frames = [normalize(frame, matrix) for frame in keyed]
    if loop:
        frames[-1] = frames[0].copy()
    output.mkdir(parents=True, exist_ok=True)
    dest = output / f"{name}.webm"
    encode(ffmpeg, frames, fps, dest, loop)
    metrics, first, last = inspect(ffmpeg, dest, calibration, loop)
    report = {
        "clip": name,
        "source": source.relative_to(ROOT).as_posix(),
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "sourceSize": [640, 360],
        "sourceFps": fps,
        "mode": "loop" if loop else "once",
        "calibration": calibration,
        "calibrationTarget": TARGETS[calibration],
        "fixedAffine": matrix.tolist(),
        "output": dest.relative_to(ROOT).as_posix(),
        **metrics,
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"{name}.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf8"
    )
    preview_dir = report_dir / "previews"
    preview_dir.mkdir(exist_ok=True)
    Image.fromarray(first).save(preview_dir / f"{name}-first.png")
    Image.fromarray(last).save(preview_dir / f"{name}-last.png")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument(
        "--clip", action="append", choices=sorted(CLIPS),
        help="formal clip to process; repeat for multiple clips",
    )
    parser.add_argument(
        "--output", type=Path, default=ROOT / "AliceButler/electron/media"
    )
    parser.add_argument(
        "--report-dir", type=Path,
        default=ROOT / "docs/green-assets-validation",
    )
    args = parser.parse_args()
    for name in args.clip or CLIPS:
        print(
            json.dumps(process_clip(name, args.ffmpeg, args.output, args.report_dir)),
            flush=True,
        )


if __name__ == "__main__":
    main()
