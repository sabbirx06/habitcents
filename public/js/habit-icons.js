/* Saved icon keys are shared by the Dashboard, cards and editor. */
(() => {
  const paths = {
    check: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    complete: 'M4 12.5l5 5L20 6.5',
    book: 'M3 5c4-2 7-1 9 1 2-2 5-3 9-1v15c-4-2-7-1-9 1-2-2-5-3-9-1zM12 6v15',
    walk: 'M12 3h1M10 7l3 2 3 1M12 8l-3 5-4 2M11 13l3 3 1 5M9 14l-2 7',
    water: 'M12 3s-7 8-7 12a7 7 0 0014 0c0-4-7-12-7-12zM8 15a4 4 0 004 4',
    leaf: 'M4 20C2 8 10 3 21 3c0 12-6 18-17 17zM4 20L16 8',
    focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 8v8M8 12h8'
  };
  function svg(name) {
    const ns = 'http://www.w3.org/2000/svg', icon = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    path.setAttribute('d', paths[name] || paths.focus); icon.append(path); return icon;
  }
  function tile(name) { const tile = document.createElement('span'); tile.className = 'habit-identity'; tile.setAttribute('aria-hidden', 'true'); tile.append(svg(name)); return tile; }
  globalThis.HabitIcons = { svg, tile, completion: () => { const icon=svg('complete'); icon.classList.add('completion-check'); return icon; } };
})();
