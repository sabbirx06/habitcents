(() => {
  const tabs = [...document.querySelectorAll('[data-feature]')];
  function select(tab, focus = false) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(tabs[next], true); }
    });
  });

  const word = document.getElementById('rotating-word');
  const control = document.getElementById('rotation-toggle');
  if (!word || !control || !word.animate) return;
  const words = ['habits', 'money', 'savings'];
  let index = 0, timer, animation, paused = false, inView = true, sequence = 0;
  const reduced = () => globalThis.HabitMotionPreference?.reduced() ?? true;
  const allowed = () => !reduced() && !paused && inView && !document.hidden;
  function stop() {
    sequence++;
    clearTimeout(timer);
    animation?.cancel();
    animation = null;
  }
  function schedule() {
    if (allowed()) timer = setTimeout(flip, 1700);
  }
  async function flip() {
    if (!allowed()) return;
    const token = ++sequence;
    try {
      animation = word.animate([{ transform:'translateY(0) rotateX(0deg)', opacity:1 }, { transform:'translateY(-.12em) rotateX(75deg)', opacity:0 }], { duration:210, easing:'ease-in', fill:'forwards' });
      await animation.finished;
      if (token !== sequence || !allowed()) return;
      animation.cancel();
      index = (index + 1) % words.length;
      word.textContent = words[index];
      word.dataset.word = words[index];
      animation = word.animate([{ transform:'translateY(.12em) rotateX(-75deg)', opacity:0 }, { transform:'translateY(0) rotateX(0deg)', opacity:1 }], { duration:290, easing:'ease-out' });
      await animation.finished;
      if (token !== sequence) return;
      animation = null;
      schedule();
    } catch { /* Cancellation settles the visible word without replaying. */ }
  }
  function sync() {
    stop();
    control.hidden = reduced();
    if (reduced()) { index = 0; word.textContent = words[index]; word.dataset.word = words[index]; }
    schedule();
  }
  control.addEventListener('click', () => {
    paused = !paused;
    control.dataset.paused = String(paused);
    const label = (paused ? 'Resume' : 'Pause') + ' headline animation';
    control.setAttribute('aria-label', label);
    control.title = label;
    sync();
  });
  globalThis.addEventListener('habitmotionchange', sync);
  document.addEventListener('visibilitychange', sync);
  globalThis.addEventListener('pagehide', stop);
  globalThis.addEventListener('pageshow', sync);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    sync();
  }).observe(word);
  sync();
})();
