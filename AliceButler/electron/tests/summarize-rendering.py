"""Summarize PNG captures and timestamp logs from rendering.cjs."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

BACKGROUNDS = {"light": 240, "mid": 128, "dark": 32}
# 5×5 patch centers at the same garment/body regions, in each image's own pixels.
PATCHES = {
    "hair": ((260, 248), (264, 112)),
    "shirt": ((198, 423), (238, 193)),
    "skirt": ((256, 456), (263, 213)),
    "skin": ((225, 341), (260, 161)),
}


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=float)


def rgb_linear(rgb):
    srgb = np.asarray(rgb) / 255
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def lab(rgb):
    linear = rgb_linear(rgb)
    xyz = linear @ np.array([[.4124564, .2126729, .0193339],
                             [.3575761, .7151522, .1191920],
                             [.1804375, .0721750, .9503041]])
    xyz /= [.95047, 1, 1.08883]
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    x, y, z = np.moveaxis(f, -1, 0)
    return np.stack([116 * y - 16, 500 * (x - y), 200 * (y - z)], axis=-1)


def patch(image, center):
    x, y = center
    square = image[y-2:y+3, x-2:x+3]
    if square[..., 3].min() < 250:
        raise ValueError(f"Patch {center} is not opaque")
    return np.median(square[..., :3], axis=(0, 1)).astype(int)


def composite(rgba, background):
    alpha = rgba[..., 3:] / 255
    return rgba[..., :3] * alpha + background * (1 - alpha)


def quantiles(values):
    return np.round(np.percentile(values, [50, 95, 100]), 3).tolist()


def color_and_edges(directory, reference):
    result = {}
    standard = load(reference)
    idle = load(directory / "idle-plus-alpha.png")
    wave = load(directory / "wave-plus-alpha.png")
    # Premultiplied interpolation at 50% between the two frozen input frames.
    # The background contributes where the combined alpha is below 100%.
    overlap = (idle[..., 3] >= 250) & (wave[..., 3] >= 250)
    for mode in ("plus", "direct"):
        for name, background in BACKGROUNDS.items():
            shown = load(directory / f"idle-{mode}-{name}.png")
            rgb = shown[..., :3]
            alpha = idle[..., 3]
            solid = alpha >= 128
            edge = (alpha >= 16) & (alpha <= 239)
            outside = ~solid & (np.max(np.abs(rgb - background), axis=-1) >= 3)
            rgb_error = rgb[edge] - composite(idle, background)[edge]
            delta = np.linalg.norm(lab(rgb[edge]) - lab(composite(idle, background)[edge]), axis=-1)
            mixed = load(directory / f"midpoint-{mode}-{name}.png")[..., :3]
            ideal = (composite(idle, background) + composite(wave, background)) / 2
            middle_alpha = load(directory / f"midpoint-{mode}-alpha.png")[..., 3]
            result[f"{mode}-{name}"] = {
                "outsidePixels": int(outside.sum()),
                "haloPx": quantiles(distance_transform_edt(~solid)[outside]),
                "edgePixels": int(edge.sum()),
                "edgeRgbMAE": round(float(np.abs(rgb_error).mean()), 3),
                "edgeRgbMeanSigned": np.round(rgb_error.mean(axis=0), 3).tolist(),
                "edgeDeltaE76": quantiles(delta),
                "midpointOverlapPixels": int(overlap.sum()),
                "midpointOverlapAlphaMedian": float(np.median(middle_alpha[overlap])),
                "midpointOverlapRgbMAE": round(float(np.abs(mixed[overlap] - ideal[overlap]).mean()), 3),
                "patches": {},
            }
            for region, (reference_point, idle_point) in PATCHES.items():
                ref_rgb, idle_rgb = patch(standard, reference_point), patch(shown, idle_point)
                result[f"{mode}-{name}"]["patches"][region] = {
                    "referenceRgb": ref_rgb.tolist(), "idleRgb": idle_rgb.tolist(),
                    "deltaE76": round(float(np.linalg.norm(lab(ref_rgb) - lab(idle_rgb))), 3),
                }
    return result


def dpi(directory):
    rows = json.loads((directory / "dpi.json").read_text())
    for row in rows:
        shot = load(directory / f"bubble-{row['scale']}-{row['label']}.png")
        # Count dark text pixels inside the bubble, outside the anti-aliased border.
        ink = (shot[3:-3, 9:-9, :3].max(axis=-1) < 160) & (shot[3:-3, 9:-9, 3] >= 250)
        row["bubble"]["screenshotPixels"] = list(shot.shape[:2][::-1])
        row["bubble"]["darkPixels"] = int(ink.sum())
    return rows


def timing(directory):
    raw = json.loads((directory / "timing.json").read_text())
    results = {}
    for label, row in raw.items():
        frames, pose = row["frames"], row["pose"]
        refresh = [entry for entry in row["refresh"] if "presented" in entry]
        presented = np.array([entry["presented"] for entry in refresh])
        displays = np.array([item["display"] for item in frames])
        start, end = displays[[0, -1]]
        tick = np.array([item["at"] for item in pose])
        mode = label if label in ("walk", "drag") else "idle"
        selected = (tick >= start) & (tick <= end) & (np.array([entry["mode"] for entry in pose]) == mode)
        poses = [entry for entry, include in zip(pose, selected) if include]
        index = np.searchsorted(tick, displays, side="right") - 1
        valid = (index >= 0) & (index < len(tick) - 1)
        nearest = index[valid]
        phase = displays[valid] - tick[nearest]
        x = np.array([entry["x"] for entry in pose])
        y = np.array([entry["y"] for entry in pose])
        angle = np.array([entry["tilt"] for entry in pose])
        sample_time = displays[valid]
        hold_px = np.hypot(np.interp(sample_time, tick, x) - x[nearest],
                           np.interp(sample_time, tick, y) - y[nearest])
        hold_angle = np.abs(np.interp(sample_time, tick, angle) - angle[nearest])
        # A change that moved in the opposite direction to the test's smooth
        # horizontal input is visible as a backwards step on the sampled poses.
        steps = np.diff([entry["x"] for entry in poses])
        forward = np.sign(np.median(steps)) if len(steps) else 0
        count_steps = np.diff([frame["count"] for frame in frames])
        time_steps = np.diff([frame["media"] for frame in frames])
        rate = 30 if label == "30" else 24
        results[label] = {
            "callbacks": len(frames), "presentedCounterGaps": int(np.maximum(count_steps - 1, 0).sum()),
            "sourceTimelineGaps": int(np.maximum(np.rint(time_steps * rate) - 1, 0).sum()),
            "refreshSamplesAfterFirstFrame": len(refresh),
            "repeatSamples": int((np.diff(presented) == 0).sum()),
            "refreshIntervalMs": quantiles(np.diff([entry["at"] for entry in refresh])),
            "videoExpectedIntervalMs": quantiles(np.diff(displays)),
            "quality": row["quality"],
            "reports": [item["count"] for item in row["reports"] if start <= item["at"] <= end],
            "poseTicks": len(poses), "phaseSamples": int(valid.sum()), "poseAgeMs": quantiles(phase),
            "positionHoldErrorPx": quantiles(hold_px), "tiltHoldErrorDegrees": quantiles(hold_angle),
            "backwardSteps": int((steps * forward < -.05).sum()),
            "transformChanges": sum(a["transform"] != b["transform"] for a, b in zip(refresh, refresh[1:])),
        }
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["dpi", "compositing", "timing"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--reference", type=Path, default=Path(__file__).resolve().parents[2] / "assets/pet-flat.png")
    args = parser.parse_args()
    if args.mode == "compositing":
        result = color_and_edges(args.directory, args.reference)
    elif args.mode == "timing":
        result = timing(args.directory)
    else:
        result = dpi(args.directory)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
