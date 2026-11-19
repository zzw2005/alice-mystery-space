"""Check decoded seams against the accepted phase-one baseline; optionally measure every body."""
import argparse
import json
from pathlib import Path
import runpy

media_tools = runpy.run_path(str(Path(__file__).with_name('evaluate-electron-media.py')))
frames, mae = media_tools['frames'], media_tools['mae']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    parser.add_argument('--audit', type=Path, help='write per-clip body ranges and endpoint measurements')
    parser.add_argument('--sleep-only', action='store_true', help='measure only the sleep relay and idle loop')
    args = parser.parse_args()
    config = json.loads((args.app / 'config.json').read_text(encoding='utf8'))
    clips = config['clips']
    loops = ('idle', 'doze') if args.sleep_only else ('idle', 'walk', 'doze', 'dangle', 'peek')
    limits = {(name, name): 0 for name in loops if name != 'walk' or name in clips}
    # Compare with the accepted phase-one RGBA measurements.
    limits.update({('sleepstart', 'doze'): .132886, ('doze', 'wakeup'): .132886, ('wakeup', 'idle'): 1.316981})
    if args.sleep_only:
        clips = {name: clips[name] for pair in limits for name in pair}
    if args.audit:
        pipeline = runpy.run_path(str(Path(__file__).with_name('process-green.py')))
    ends, boxes = {}, {}
    for name, entry in clips.items():
        first = last = None
        measurements = []
        for frame in frames(args.app / 'media' / entry['file']):
            if first is None:
                first = frame
            last = frame
            if args.audit:
                measurements.append(pipeline['normalized_box'](pipeline['body_metrics'](frame)))
        if first is None:
            raise ValueError(f'Empty video: {name}')
        ends[name] = (first, last)
        if args.audit:
            boxes[name] = {
                'frames': len(measurements), 'first': measurements[0], 'last': measurements[-1],
                'ranges': {k: [min(b[k] for b in measurements), max(b[k] for b in measurements)]
                           for k in ('left', 'right', 'top', 'foot', 'height')}}
    failures = []
    for (left, right), limit in limits.items():
        value = mae(ends[left][1], ends[right][0])
        print(f'{left}->{right} MAE={value:.6f} limit={limit:.6f}', flush=True)
        if value > limit:
            failures.append(f'{left}->{right}')
    if args.audit:
        args.audit.write_text(json.dumps(boxes, indent=2) + '\n', encoding='utf8')
    if failures:
        raise SystemExit('Seam regression: ' + ', '.join(failures))


if __name__ == '__main__':
    main()
