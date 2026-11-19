"""Evaluate disposable high-quality VP9 candidates; never replace formal media.

Requires ffmpeg, numpy. The strict seam gate is automatic. A passing candidate
still needs human frame-by-frame review before it can replace accepted art.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "AliceButler/electron/media"
FRAME_BYTES = 640 * 360 * 4


def frames(file):
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-threads", "2", "-c:v", "libvpx-vp9", "-i", str(file),
                             "-f", "rawvideo", "-pix_fmt", "rgba", "-"], stdout=subprocess.PIPE)
    try:
        while raw := proc.stdout.read(FRAME_BYTES):
            if len(raw) != FRAME_BYTES:
                raise ValueError("truncated frame")
            yield np.frombuffer(raw, np.uint8).reshape(360, 640, 4).copy()
        if proc.wait():
            raise RuntimeError("decode failed")
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def endpoints(file):
    first = last = None
    for frame in frames(file):
        if first is None:
            first = frame
        last = frame
    if first is None:
        raise ValueError("empty clip")
    return first, last


def mae(a, b):
    return float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--crf", type=int, default=12)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"crf": args.crf, "formalMediaReplaced": False, "candidates": {}, "seams": {},
              "ffmpegVersion": subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0],
              "numpyVersion": np.__version__,
              "formalSha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(MEDIA.glob("*.webm"))}}
    original_ends, candidate_ends = {}, {}
    for clip in ["idle", "walk", "doze"]:
        source, candidate = MEDIA / f"{clip}.webm", args.output / f"{clip}.webm"
        # Retain independent endpoint keys, matching the accepted loop profile.
        count = int(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                    "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(source)], text=True).strip())
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-c:v", "libvpx-vp9", "-i", str(source), "-an",
                        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", str(args.crf), "-b:v", "0",
                        "-auto-alt-ref", "0", "-row-mt", "1", "-threads", "4", "-deadline", "good", "-cpu-used", "3",
                        "-force_key_frames", f"expr:eq(n,0)+eq(n,{count - 1})", str(candidate)], check=True)
        mean, face, worst = [], [], 0
        first_a = first_b = None
        last_a = last_b = None
        from itertools import zip_longest
        for a, b in zip_longest(frames(source), frames(candidate)):
            if a is None or b is None:
                raise ValueError("frame count changed")
            if first_a is None:
                first_a, first_b = a, b
            last_a, last_b = a, b
            mean.append(mae(a, b))
            face.append(mae(a[45:180, 255:390], b[45:180, 255:390]))
            worst = max(worst, int(np.abs(a.astype(np.int16) - b.astype(np.int16)).max()))
        assert len(mean) == count
        original_ends[clip], candidate_ends[clip] = (first_a, last_a), (first_b, last_b)
        report["candidates"][clip] = {"originalBytes": source.stat().st_size, "candidateBytes": candidate.stat().st_size,
            "candidateSha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
            "frames": count, "allFrameRgbaMae": float(np.mean(mean)), "worstFrameRgbaMae": max(mean),
            "faceAhogeRegionMae": float(np.mean(face)), "maxChannelDelta": worst,
            "originalLoopMae": mae(first_a, last_a), "candidateLoopMae": mae(first_b, last_b),
            "visualReview": "not approved; retain original unless both gates pass"}
        print(clip, report["candidates"][clip], flush=True)
    for clip in ["sleepstart", "wakeup"]:
        original_ends[clip] = candidate_ends[clip] = endpoints(MEDIA / f"{clip}.webm")
    for left, right in [("sleepstart", "doze"), ("doze", "wakeup"), ("wakeup", "idle")]:
        before = mae(original_ends[left][1], original_ends[right][0])
        after = mae(candidate_ends[left][1], candidate_ends[right][0])
        report["seams"][f"{left}->{right}"] = {"beforeMae": before, "afterMae": after, "notWorse": after <= before}
    report["seamGatePassed"] = all(v["candidateLoopMae"] <= v["originalLoopMae"] for v in report["candidates"].values()) and all(v["notWorse"] for v in report["seams"].values())
    (args.output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["seams"], indent=2), flush=True)


if __name__ == "__main__":
    main()
