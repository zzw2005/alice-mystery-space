# Legacy Action Asset Removal

Date: 2026-11-18 (Asia/Tokyo).

The authoritative deletion set is the exact set removed by mainline commit
`4c43f67698e3479660672692ecee4a6d49096562`. The
`material/v2-9-calibrated` branch was audited against that commit's parent:
before cleanup all 7360 paths were present, and after cleanup there are zero
extra paths and zero missing paths.

| Removed path | Files |
|---|---:|
| `AliceButler/assets/anim60/` | 6361 |
| `AliceButler/assets/anim-flat/` | 707 |
| `AliceButler/assets/anim/` | 120 |
| `AliceButler/assets/sprites/` | 36 |
| `clips-flat2/` | 46 |
| `sprite-frames/` | 33 |
| `clips/` | 19 |
| `clips-flat/` | 19 |
| `clips60/` | 19 |
| **Total** | **7360** |

The removed Git blobs total 305,003,974 bytes (290.87 MiB).

Preserved by this cleanup:

- `clips-green/v2/` formal green-screen sources and anchors.
- `AliceButler/electron/` Electron/TypeScript player, config, tests and
  calibrated VP9-alpha WebMs.
- `AliceButler/assets/` static avatar and reference images.
- AliceButler runner, watchdog, deployment compatibility files and WinForms
  source archives.

No `material/v2-9-calibrated` content was merged into `main` as part of this
removal.
