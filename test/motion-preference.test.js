const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function preferenceHarness({ reduced = false, saved = null, blocked = false } = {}) {
  const attributes = {}, listeners = {}, writes = [];
  const media = { matches: reduced, addEventListener(type, callback) { this.change = callback; } };
  const context = {
    document: { documentElement: { setAttribute(key, value) { attributes[key] = value; } } },
    localStorage: {
      getItem() { if (blocked) throw Error('Storage unavailable'); return saved; },
      setItem(key, value) { if (blocked) throw Error('Storage unavailable'); writes.push([key, value]); saved = value; },
    },
    matchMedia: () => media,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(type, callback) { listeners[type] = callback; },
    dispatchEvent(event) { listeners[event.type]?.(event); },
  };
  const path = 'public/js/motion-preference.js';
  vm.runInNewContext(fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '', context);
  return { preference: context.HabitMotionPreference, attributes, media, writes, context, listeners };
}

test('explicit animations on overrides operating-system reduced motion before styles load', () => {
  const h = preferenceHarness({ reduced: true, saved: 'on' });
  assert.ok(h.preference, 'The shared preference controller must exist');
  assert.equal(h.preference.reduced(), false);
  assert.equal(h.attributes['data-motion'], 'on');
  assert.equal(h.preference.get(), 'on');
});

test('system is the default; explicit choices update immediately and persist', () => {
  const h = preferenceHarness({ reduced: false });
  assert.ok(h.preference);
  assert.equal(h.preference.get(), null);
  h.media.matches = true; h.media.change();
  assert.equal(h.preference.reduced(), true);
  h.preference.set('on');
  assert.equal(h.preference.reduced(), false);
  assert.deepEqual(h.writes.at(-1), ['habitcents-motion-preference', 'on']);
  h.preference.set('off');
  assert.equal(h.preference.reduced(), true);
  assert.equal(h.attributes['data-motion'], 'off');
});

test('corrupt and unavailable storage fall back to system while allowing an in-memory choice', () => {
  for (const options of [{ saved: 'garbage' }, { blocked: true }]) {
    const h = preferenceHarness({ ...options, reduced: true });
    assert.ok(h.preference);
    assert.equal(h.preference.get(), null);
    assert.equal(h.preference.reduced(), true);
    h.preference.set('on');
    assert.equal(h.preference.reduced(), false);
  }
});

test('storage events synchronize explicit choices and removal returns to system', () => {
  const h = preferenceHarness({ reduced: true });
  assert.ok(h.preference);
  h.listeners.storage({ key: 'habitcents-motion-preference', newValue: 'on' });
  assert.equal(h.preference.reduced(), false);
  h.listeners.storage({ key: 'habitcents-motion-preference', newValue: null });
  assert.equal(h.preference.reduced(), true);
});

test('preference bootstrap precedes styles and all motion checks use the controller', () => {
  for (const view of ['partials/head', 'login', 'signup']) {
    const head = fs.readFileSync('views/' + view + '.ejs', 'utf8');
    assert.ok(head.includes('/js/motion-preference.js'), view + ' loads the motion controller');
    assert.ok(head.includes('/css/motion-preference.css'), view + ' loads shared motion styles');
    assert.ok(head.indexOf('/js/motion-preference.js') < head.indexOf('<link'));
  }
  for (const name of ['motion.js', 'dashboard.js', 'expenses.js', 'workspace.js']) {
    assert.doesNotMatch(fs.readFileSync('public/js/' + name, 'utf8'), /prefers-reduced-motion/);
  }
  for (const name of fs.readdirSync('public/css')) {
    assert.doesNotMatch(fs.readFileSync('public/css/' + name, 'utf8'), /prefers-reduced-motion/);
  }
});
