const test = require('node:test');
const assert = require('node:assert/strict');
const { terminalPopupFeatures } = require('../public/terminal-widget');

function readFeatures(screen) {
  return Object.fromEntries(terminalPopupFeatures(screen).split(',').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, true] : [part.slice(0, i), part.slice(i + 1)];
  }));
}
test('browser SSH popup is centered and resizable on a desktop', () => {
  const f = readFeatures({ availWidth: 1920, availHeight: 1080, availLeft: 0, availTop: 0 });
  assert.equal(f.width, '980');
  assert.equal(f.height, '680');
  assert.equal(f.left, '470');
  assert.equal(f.top, '200');
  assert.equal(f.resizable, 'yes');
  assert.equal(f.scrollbars, 'yes');
});
test('popup dimensions fit a small mobile screen', () => {
  const f = readFeatures({ availWidth: 375, availHeight: 667 });
  assert.equal(f.width, '343');
  assert.equal(f.height, '635');
  assert.equal(f.left, '16');
  assert.equal(f.top, '16');
});
test('popup respects screen offsets for secondary monitors', () => {
  const f = readFeatures({ availWidth: 1600, availHeight: 900, availLeft: -1600, availTop: 50 });
  assert.equal(f.left, '-1290');
  assert.equal(f.top, '160');
});
test('popup does not retain opener or referrer', () => {
  const f = readFeatures({});
  assert.equal(f.noopener, true);
  assert.equal(f.noreferrer, true);
  assert.equal(f.popup, 'yes');
});
