const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function landing({ reduced = false, saved = null, blocked = false } = {}) {
  const listeners = {}, timers = new Map();
  const word = { textContent: 'habits', dataset: {}, animate: () => ({ finished: Promise.resolve(), cancel() {} }) };
  const context = {
    document: {
      hidden: false,
      documentElement: { setAttribute() {} },
      querySelectorAll: () => [],
      getElementById: id => id === 'rotating-word' ? word : null,
      addEventListener() {},
    },
    localStorage: {
      getItem() { if (blocked) throw Error('Storage unavailable'); return saved; },
      setItem(key, value) { if (blocked) throw Error('Storage unavailable'); saved = value; },
    },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    CustomEvent: class { constructor(type) { this.type = type; } },
    addEventListener(type, callback) { listeners[type] = callback; },
    dispatchEvent(event) { listeners[event.type]?.(); },
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context;
  vm.createContext(context);
  for (const script of ['motion-preference', 'landing']) {
    vm.runInContext(fs.readFileSync(`public/js/${script}.js`, 'utf8'), context);
  }
  return { word, timers, preference: context.HabitMotionPreference, async tick() {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    await callback();
  } };
}

test('fresh private tabs autoplay without a control, including reduced motion and blocked storage', async () => {
  for (const reduced of [false, true]) {
    for (const blocked of [false, true]) {
      const h = landing({ reduced, blocked });
      assert.equal(h.preference.get(), null, 'Autoplay does not change the shared preference');
      await h.tick();
      assert.equal(h.word.textContent, 'money');
      await h.tick();
      assert.equal(h.word.textContent, 'savings');
      await h.tick();
      assert.equal(h.word.textContent, 'habits');
    }
  }
});

test('explicit app animation preferences still stop and restart the headline', async () => {
  for (const reduced of [false, true]) {
    const h = landing({ reduced, saved: 'off' });
    assert.equal(h.timers.size, 0);
    assert.equal(h.word.textContent, 'habits');
    h.preference.set('on');
    await h.tick();
    assert.equal(h.word.textContent, 'money');
    h.preference.set('off');
    assert.equal(h.timers.size, 0);
    assert.equal(h.word.textContent, 'habits');
  }
});
