if (!window.__CFG__) {
  window.__CFG__ = fetch('config.json').then((r) => {
    if (!r.ok) throw new Error('Failed to load config.json');
    return r.json();
  }).catch(() => ({}));
}
