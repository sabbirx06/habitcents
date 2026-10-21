/* Small, dependency-free presentation timelines. Business values never live here. */
(() => {
  const reduced = () => globalThis.HabitMotionPreference.reduced();
  const records = new Map(), effects = new Set(), seen = new Set();
  const style=globalThis.getComputedStyle && globalThis.document?.documentElement ? getComputedStyle(document.documentElement) : null;
  const token=(name,fallback)=>{const raw=style?.getPropertyValue(name)?.trim();const value=parseFloat(raw);return Number.isFinite(value)?value*(raw.endsWith('ms')?1:raw.endsWith('s')?1000:1):fallback;};
  const timings={data:token('--motion-data',440),layout:token('--motion-layout',220),press:token('--motion-press',130)};
  const duration = timings.data;
  const easing=style?.getPropertyValue('--ease-out')?.trim() || 'cubic-bezier(.2,.75,.25,1)';
  const ease = t => 1 - Math.pow(1 - t, 3);
  const wasSeen = key => seen.has(key);
  const remember = key => seen.add(key);
  const visible = node => {
    if(!node||node.isConnected===false||globalThis.document?.visibilityState==='hidden'||(node.getClientRects&&!node.getClientRects().length))return false;
    const box=node.getBoundingClientRect?.();
    return !box || (box.bottom>0&&box.right>0&&box.top<(globalThis.innerHeight??Infinity)&&box.left<(globalThis.innerWidth??Infinity));
  };
  const same = (a, b) => a && Object.keys(b).every(k => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;
  function finish(record) {
    if (record.frame != null) cancelAnimationFrame(record.frame);
    record.frame = null;
    record.current = { ...record.target };
    record.paint(record.current);
    remember(record.key);
  }
  function values(node, key, target, paint, options = {}) {
    if (!Object.values(target).every(Number.isFinite)) { cancel(key); return; }
    let record = records.get(key);
    if (record && same(record.target, target)) {
      record.node = node;
      record.paint = paint;
      if(reduced() || !visible(node))return finish(record);
      paint(record.current);
      return;
    }
    if (record?.frame != null) cancelAnimationFrame(record.frame);
    const current = record?.current || Object.fromEntries(Object.keys(target).map(k => [k, options.initial?.[k] ?? 0]));
    const immediate = reduced() || !visible(node) || typeof requestAnimationFrame !== 'function' || (!record && wasSeen(key));
    record = { key, node, current: { ...current }, target: { ...target }, paint, frame: null };
    records.set(key, record);
    if (immediate || same(current, target)) return finish(record);
    const start = performance.now(), from = { ...current }, ms = options.duration ?? duration;
    paint(record.current);
    const tick = now => {
      if (reduced() || record.node?.isConnected===false || globalThis.document?.visibilityState==='hidden' || record.node?.closest?.('[hidden]')) return finish(record);
      const t = Math.min(1, Math.max(0, (now - start) / ms)), p = ease(t);
      record.current = Object.fromEntries(Object.keys(target).map(k => [k, t === 1 ? target[k] : from[k] + (target[k] - from[k]) * p]));
      record.paint(record.current);
      if (t < 1) record.frame = requestAnimationFrame(tick);
      else { record.frame = null; remember(key); }
    };
    record.frame = requestAnimationFrame(tick);
  }
  function cancel(key) {
    const record = records.get(key);
    if (record?.frame != null) cancelAnimationFrame(record.frame);
    records.delete(key);
  }
  function effect(node, frames, options) {
    if (reduced() || !visible(node) || !node.animate) return;
    const animation = node.animate(frames, options);
    effects.add(animation);
    const cleanup = () => effects.delete(animation);
    animation.addEventListener?.('finish', cleanup, { once: true });
    animation.addEventListener?.('cancel', cleanup, { once: true });
    return animation;
  }
  function bars(container, key) {
    if (!container || wasSeen(key)) return;
    remember(key);
    if(!visible(container))return;
    [...container.children].forEach((bar, index) => effect(bar,
      [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
      { duration, delay: Math.min(index * 12, 84), easing, fill: 'backwards' }));
  }
  function radial(node, key) {
    if(wasSeen(key)){cancel(key);return;}
    if(!visible(node)){remember(key);cancel(key);return;}
    values(node,key,{sweep:360},frame=>{node.style.maskImage=frame.sweep>=360?'none':`conic-gradient(#000 0deg ${frame.sweep}deg,transparent ${frame.sweep}deg 360deg)`;});
  }
  function replace(container, children, keyAttribute) {
    if (!container) return;
    const priorChildren=[...container.children];
    const old = new Map([...container.children].map(n => [n.getAttribute(keyAttribute), n.getBoundingClientRect?.()]));
    container.replaceChildren(...children);
    for(const [key,record] of records){
      const prior=priorChildren.find(child=>child===record.node||child.contains?.(record.node));
      if(!prior)continue;
      const replacement=children.find(child=>child.getAttribute(keyAttribute)===prior.getAttribute(keyAttribute));
      if(replacement)record.node=replacement;else cancel(key);
    }
    if (!old.size || reduced() || !visible(container)) return;
    [...container.children].slice(0, 12).forEach(node => {
      const before = old.get(node.getAttribute(keyAttribute)), after = node.getBoundingClientRect?.();
      if (!after) return;
      if (before && (Math.abs(before.top - after.top) > 1 || Math.abs(before.left - after.left) > 1))
        effect(node, [{ transform: `translate(${before.left - after.left}px,${before.top - after.top}px)` }, { transform: 'translate(0,0)' }], { duration: timings.layout, easing });
      else if (!before) effect(node, [{ opacity: .3, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: timings.layout, easing });
    });
  }
  function pop(node) {
    return effect(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: .4 }, { transform: 'scale(1)' }], { duration: timings.layout, easing });
  }
  const settle = () => {
    for (const record of records.values()) if (record.frame != null) finish(record);
    for (const animation of effects) animation.cancel();
    effects.clear();
  };
  const onReduced=()=>{if(reduced())settle();};
  const onVisibility=()=>{if(document.visibilityState==='hidden')settle();};
  const listen=()=>{globalThis.addEventListener?.('habitmotionchange',onReduced);globalThis.document?.addEventListener('visibilitychange',onVisibility);};
  listen();
  globalThis.addEventListener?.('pagehide', () => { settle();globalThis.removeEventListener?.('habitmotionchange',onReduced);globalThis.document?.removeEventListener?.('visibilitychange',onVisibility); });
  globalThis.addEventListener?.('pageshow', listen);
  globalThis.HabitMotion = { values, cancel, bars, radial, replace, pop, effect, timings, reduced };
})();
