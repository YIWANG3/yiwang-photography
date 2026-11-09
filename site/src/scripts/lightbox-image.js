// Rendered size, not the window's longest dimension, determines the preview rung.
export function fitDimensions(item, width, height) {
  const scale = Math.max(0, Math.min(width / item.w, height / item.h, 1));
  return { width: item.w * scale, height: item.h * scale };
}

export function previewSize(item, width, height, dpr = 1) {
  const fit = fitDimensions(item, width, height);
  const need = Math.max(fit.width, fit.height) * Math.min(dpr || 1, 2);
  const sizes = item.sizes.filter((s) => s <= 3200);
  return sizes.find((s) => s >= need) ?? sizes.at(-1) ?? item.sizes[0];
}

export function zoomSize(item) {
  return item.sizes.filter((s) => s <= 6000).at(-1) ?? item.sizes.at(-1);
}

export function clampPan(x, y, zoom, fit, viewport) {
  const dx = Math.max(0, (fit.width * zoom - viewport.width) / 2);
  const dy = Math.max(0, (fit.height * zoom - viewport.height) / 2);
  return { x: dx ? Math.max(-dx, Math.min(dx, x)) : 0, y: dy ? Math.max(-dy, Math.min(dy, y)) : 0 };
}
