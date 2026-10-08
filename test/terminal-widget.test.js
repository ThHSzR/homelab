const test = require('node:test');
const assert = require('node:assert/strict');
const { clampTerminalBounds } = require('../public/terminal-widget');

test('floating terminal respects desktop viewport bounds', () => {
  const result = clampTerminalBounds({ left: 9999, top: 9999, width: 700, height: 500 }, { width: 1440, height: 900 });
  assert.deepEqual(result, { left: 728, top: 388, width: 700, height: 500 });
});
test('terminal clamps size on narrow mobile viewports', () => {
  const result = clampTerminalBounds({ left: -300, top: -400, width: 700, height: 500 }, { width: 320, height: 480 });
  assert.deepEqual(result, { left: 12, top: 12, width: 296, height: 456 });
});
test('terminal applies minimum desktop dimensions', () => {
  const result = clampTerminalBounds({ left: 50, top: 90, width: 80, height: 60 }, { width: 1300, height: 780 });
  assert.deepEqual(result, { left: 50, top: 90, width: 340, height: 260 });
});
test('terminal never produces negative geometry on tiny screens', () => {
  const result = clampTerminalBounds({ left: -999, top: 8888, width: 0, height: 0 }, { width: 250, height: 300 });
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(result[key] > 0);
  assert.ok(result.left + result.width <= 250);
  assert.ok(result.top + result.height <= 300);
});
