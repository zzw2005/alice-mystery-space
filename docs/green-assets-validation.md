# Green Animation Asset Validation

Validation date: 2026-11-18 (Asia/Tokyo). The complete formal action set is
the nine files in `clips-green/v2/`. The pipeline did not read, convert, or
restore the legacy 22 animations, and it did not generate any video.

## Processing Contract

- Source key: HSV green key with feathered alpha and edge-only green-spill
  suppression.
- Canvas and playback: 640x360, source 24 fps, VP9-alpha (`yuva420p`) WebM.
- Body measurement: the largest connected alpha component at alpha > 32.
  Detached effects such as the Zzz marks are retained but excluded from body
  placement.
- Standing calibration: center 51%, top 17%, foot 85%, body height 68%.
- Sleeping calibration: center 51%, top 33%, foot 85%, body height 52%.
- Every frame in one clip uses the same affine transform. The width comes from
  the source pose and aspect ratio; the pipeline does not stretch the Q-style
  body horizontally.
- Sleep source v5 comes from mainline `4b1a5da`. After keying and canvas
  normalization, the same 24-frame anchors are applied: `sleepstart` tail to
  `doze` first, `wakeup` head to `doze` last, and `wakeup` tail to `idle`
  first. Sleep segments use lossless VP9 to preserve those endpoint anchors.
- `idle`, `walk`, and `doze` have identical decoded first/last RGBA frames.
  Non-loop clips intentionally retain their action endpoints.
- All decoded frames contain alpha. Opaque pure black is below 5% in every
  frame of every clip.

## First-Frame Body Measurement

Percentages are calculated from the 640x360 frame using alpha > 32.

| Clip | Mode | BBox px `[left,top,right,foot]` | Left | Right | Top | Foot | Width | Height | Center | Bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle | loop | 221, 61, 432, 306 | 34.53% | 67.50% | 16.94% | 85.00% | 32.97% | 68.06% | 51.02% | 4,543,101 |
| walk | loop | 221, 61, 433, 306 | 34.53% | 67.66% | 16.94% | 85.00% | 33.13% | 68.06% | 51.09% | 5,760,282 |
| wave | once | 221, 61, 433, 306 | 34.53% | 67.66% | 16.94% | 85.00% | 33.13% | 68.06% | 51.09% | 1,113,100 |
| clickhappy | once | 221, 61, 432, 306 | 34.53% | 67.50% | 16.94% | 85.00% | 32.97% | 68.06% | 51.02% | 823,553 |
| clickshy | once | 223, 61, 430, 306 | 34.84% | 67.19% | 16.94% | 85.00% | 32.34% | 68.06% | 51.02% | 661,080 |
| clicktsun | once | 223, 61, 430, 306 | 34.84% | 67.19% | 16.94% | 85.00% | 32.34% | 68.06% | 51.02% | 712,291 |
| sleepstart | once | 222, 61, 431, 306 | 34.69% | 67.34% | 16.94% | 85.00% | 32.66% | 68.06% | 51.02% | 4,542,496 |
| doze | loop | 235, 119, 419, 306 | 36.72% | 65.47% | 33.06% | 85.00% | 28.75% | 51.94% | 51.09% | 4,271,743 |
| wakeup | once | 235, 119, 419, 306 | 36.72% | 65.47% | 33.06% | 85.00% | 28.75% | 51.94% | 51.09% | 4,056,911 |

The first-frame height error against the requested calibration is 0.2 px for
all nine clips. Standing horizontal-center error is at most 0.6 px. All
standing clips keep their source aspect ratio; the measured visible width is
32.34-33.13%, compatible with the specified approximately 33% Q-style body.

The `doze` report observes up to 15 detached alpha components in a frame,
confirming that the built-in Zzz/effects survive keying. Its decoded first and
last frames are byte-for-byte RGBA-equal. The same exact loop-seam check passes
for `idle` and `walk`.

Per-clip machine-readable evidence is in
`docs/green-assets-validation/<clip>.json`; first/last decoded PNGs are in
`docs/green-assets-validation/previews/`.

## Sleep Relay Boundary Evidence

The runtime sequence `sleepstart -> doze -> wakeup -> idle` is wired and
tested. The source clips themselves do not share exact boundary pixels:

| Boundary | Exact | RGBA MAE | Changed channels |
|---|---:|---:|---:|
| sleepstart tail -> doze first | no | 0.0943 | 59,733 |
| doze tail -> wakeup first | no | 0.0943 | 59,733 |
| wakeup tail -> idle first | no | 0.1359 | 91,252 |

The remaining difference is YUVA420 color round-trip rounding: maximum channel
delta is 11-13 although the normalized endpoint geometry is identical. This is
below the mainline source seam measurements (0.99/1.57/1.51). The player keeps
the 180 ms alpha crossfade as insurance; it is no longer required to hide a
pose or scale discontinuity.

## Verification

- `py -m unittest discover -s tests -p test_green_pipeline.py`: 5 passed.
- Full decode of all nine WebMs: 240 frames each, 24 fps, 640x360, alpha
  present, and maximum opaque-black ratio below 5% per frame.
- Electron integration, hidden windows with an isolated runtime directory:
  all nine clips played, alpha decoded, sleep relay completed, and renderer
  page-error list was empty.
- Player tests cover weighted non-repeating picks, idle-loop versus
  wave-one-shot behavior, click scheduling, sleep relay, and presence fallback.

Total current video payload: 26,484,557 bytes (25.26 MiB). Loop clips and the
two sleep-seam clips use lossless VP9 plus explicit endpoint key frames; other
one-shot clips remain CRF 28.
