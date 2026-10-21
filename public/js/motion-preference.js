/* Runs synchronously before styles: the root attribute is the CSS/JS authority. */
(() => {
  const key = 'habitcents-motion-preference';
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const valid = value => value === 'on' || value === 'off' ? value : null;
  let choice = null;
  try { choice = valid(localStorage.getItem(key)); } catch {}
  const reduced = () => choice === 'off' || (choice === null && !!media?.matches);
  const publish = () => {
    document.documentElement.setAttribute('data-motion', reduced() ? 'off' : 'on');
    globalThis.dispatchEvent(new CustomEvent('habitmotionchange', { detail: { choice, reduced: reduced() } }));
  };
  globalThis.HabitMotionPreference = {
    get: () => choice,
    reduced,
    set(value) {
      if (valid(value) === null) return;
      choice = value;
      try { localStorage.setItem(key, choice); } catch {}
      publish();
    },
  };
  media?.addEventListener?.('change', publish);
  globalThis.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { choice = valid(event.newValue); publish(); }
  });
  publish();
})();
