document.addEventListener('DOMContentLoaded', () => {
  const control = document.querySelector('#animations');
  const preference = globalThis.HabitMotionPreference;
  if (!control || !preference) return;
  const sync = () => {
    const enabled = !preference.reduced();
    control.setAttribute('aria-checked', String(enabled));
    control.querySelector('.motion-switch-state').textContent = enabled ? 'On' : 'Off';
  };
  control.addEventListener('click', () => preference.set(preference.reduced() ? 'on' : 'off'));
  globalThis.addEventListener('habitmotionchange', sync);
  sync();
});
