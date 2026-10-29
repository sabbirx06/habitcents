/* Saved icon keys are shared by the Dashboard, cards and editor. */
(() => {
  const paths = {
    check: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    complete: 'M4 12.5l5 5L20 6.5',
    history: 'M3 12a9 9 0 1 0 2.7-6.4L3 8M3 3v5h5M12 7v5l4 2',
    book: 'M3 5c4-2 7-1 9 1 2-2 5-3 9-1v15c-4-2-7-1-9 1-2-2-5-3-9-1zM12 6v15',
    walk: 'M12 3h1M10 7l3 2 3 1M12 8l-3 5-4 2M11 13l3 3 1 5M9 14l-2 7',
    water: 'M12 3s-7 8-7 12a7 7 0 0014 0c0-4-7-12-7-12zM8 15a4 4 0 004 4',
    leaf: 'M4 20C2 8 10 3 21 3c0 12-6 18-17 17zM4 20L16 8',
    focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 8v8M8 12h8',
    heart: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 00-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 000-7.8z',
    sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M17 12a5 5 0 11-10 0 5 5 0 0110 0z',
    dumbbell: 'M6 8v8m12-8v8M3 10v4m18-4v4M6 12h12',
    music: 'M9 18V5l12-2v13M9 18a3 3 0 11-3-3c1.7 0 3 1.3 3 3zm12-2a3 3 0 11-3-3c1.7 0 3 1.3 3 3z',
    food: 'M4 3v7m4-7v7M4 6h4m-2 4v11m10-18v18m0-18c5 2 5 9 0 10',
    sleep: 'M20 15.5A8 8 0 018.5 4 8 8 0 1020 15.5z',
    code: 'M8 8l-4 4 4 4m8-8 4 4-4 4m-3-11-2 14'
  };
  function svg(name) {
    const ns = 'http://www.w3.org/2000/svg', icon = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    path.setAttribute('d', paths[name] || paths.focus); icon.append(path); return icon;
  }
  function tile(name) { const tile = document.createElement('span'); tile.className = 'habit-identity'; tile.setAttribute('aria-hidden', 'true'); tile.append(svg(name)); return tile; }
  globalThis.HabitIcons = { svg, tile, completion: () => { const icon=svg('complete'); icon.classList.add('completion-check'); return icon; } };
})();
