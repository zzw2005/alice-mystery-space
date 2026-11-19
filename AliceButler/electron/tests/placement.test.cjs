const { test } = require('node:test');
const assert = require('node:assert/strict');
const { limits, restore, snap } = require('../dist/main/placement');
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 860 } };
const left = { id: 2, workArea: { x: -1024, y: 80, width: 1024, height: 700 } };

test('restore a secondary display position or use the primary lower right', () => {
  const pos = { display: 2, x: -800, y: 120 };
  assert.deepEqual(restore(pos, [primary, left], primary, false), pos);
  const fallback = restore(pos, [primary], primary, false);
  assert.equal(fallback.display, 1);
  assert.equal(fallback.x, limits(primary, false).right - 30);
  assert.equal(fallback.y, limits(primary, false).floor);
});

test('snap against the current display and stand at its taskbar', () => {
  const a = limits(left, false);
  assert.deepEqual(snap(a.right - 8, a.top + 8, a), { x: a.right - 4, y: a.top + 4 });
  assert.deepEqual(snap(a.left + 8, a.floor - 8, a), { x: a.left + 4, y: a.floor - 4 });
  assert.equal(snap(-800, 120, a), undefined);
  const pos = restore({ display: 2, x: -800, y: 120 }, [primary, left], primary, true);
  assert.equal(pos.y + 255, 780);
});
