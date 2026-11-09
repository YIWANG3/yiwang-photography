// Preview first; the full-resolution rung is requested only when the user zooms.
import { fitDimensions, previewSize, zoomSize, clampPan } from "./lightbox-image.js";

let state = null, gesture = null, lastTap = null, lastTouchTime = 0;
const points = new Map();
const els = () => ({ root: document.getElementById("lb"), stage: document.getElementById("lb-stage"), img: document.getElementById("lb-img"), title: document.getElementById("lb-title"), exif: document.getElementById("lb-exif") });
const current = () => state.items[state.cur];
const imageUrl = (it, size) => `${it.base}/${it.id}/${size}.webp`;
const viewport = () => { const { stage } = els(); return { width: stage.clientWidth, height: stage.clientHeight }; };
const previewFor = (it) => { const v = viewport(); return previewSize(it, v.width - 32, v.height - 32, window.devicePixelRatio); };

function loadImage(it, size) {
  if (!state || size <= state.loaded || state.pending.has(size)) return;
  const view = state;
  view.pending.add(size);
  const image = new Image(); image.decoding = "async"; image.src = imageUrl(it, size);
  image.decode().then(() => {
    if (state !== view || size <= view.loaded) return;
    view.loaded = size;
    const { img } = els();
    img.src = image.src;
    img.dataset.loadedSize = String(size);
    img.classList.remove("is-loading");
  }).catch(() => {
    // A failed upgrade leaves the displayed preview intact; a failed preview tries a smaller rung.
    if (state !== view || view.loaded) return;
    const lower = it.sizes.filter((s) => s < size).at(-1);
    if (lower) loadImage(it, lower);
  }).finally(() => view.pending.delete(size));
}

function paint() {
  if (!state) return;
  const { root, img } = els(), v = viewport();
  Object.assign(state, clampPan(state.x, state.y, state.zoom, state.fit, v));
  img.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.zoom})`;
  root.toggleAttribute("data-zoomed", state.zoom > 1.01);
  root.dataset.zoom = state.zoom.toFixed(2);
  const button = root.querySelector("[data-lb-zoom]");
  button?.setAttribute("aria-label", state.zoom > 1.01 ? "Reset zoom" : "Zoom in");
  button?.setAttribute("aria-pressed", String(state.zoom > 1.01));
  if (state.zoom > 1.01) loadImage(current(), zoomSize(current()));
}

function layout() {
  if (!state) return;
  const { img } = els(), v = viewport();
  state.fit = fitDimensions(current(), v.width - 32, v.height - 32);
  img.style.width = `${state.fit.width}px`; img.style.height = `${state.fit.height}px`;
  paint();
}

function zoomAt(zoom, clientX, clientY) {
  if (!state) return;
  const rect = els().stage.getBoundingClientRect();
  const x = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
  const y = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
  const next = Math.max(1, Math.min(6, zoom)), ratio = next / state.zoom;
  state.x = x - (x - state.x) * ratio; state.y = y - (y - state.y) * ratio;
  state.zoom = next;
  if (next === 1) state.x = state.y = 0;
  paint();
}

function show(i) {
  const old = state, { img, title, exif } = els();
  state = { ...old, cur: (i + old.items.length) % old.items.length, zoom: 1, x: 0, y: 0, loaded: 0, pending: new Set() };
  gesture = lastTap = null; points.clear();
  els().root.removeAttribute("data-dragging");
  const it = current();
  // The smallest rung (usually cached from the gallery page) shows at once, blurred, and the preview sharpens
  // over it when decoded; the <img> never sits without a src, which is what flashed the broken-image glyph.
  delete img.dataset.loadedSize;
  img.classList.add("is-loading"); img.src = imageUrl(it, it.sizes[0]);
  img.width = it.w; img.height = it.h;
  img.alt = it.alt || `${it.title ?? state.title} ${state.cur + 1}`;
  title.textContent = `${it.title ?? state.title} · ${String(state.cur + 1).padStart(2, "0")} / ${String(state.items.length).padStart(2, "0")}`;
  exif.replaceChildren(...(it.exif || "").split(" · ").filter(Boolean).map((s) => Object.assign(document.createElement("span"), { textContent: s })));
  layout(); loadImage(it, previewFor(it));
  // Adjacent images are previews, even while the current photograph is zoomed.
  for (const d of [1, -1]) { const n = state.items[(state.cur + d + state.items.length) % state.items.length]; const p = new Image(); p.src = imageUrl(n, previewFor(n)); }
}

export function openLightbox(items, index = 0, { title = "", onClose } = {}) {
  const { root } = els();
  if (!root || !items.length) return;
  state = { items, cur: -1, title, onClose };
  root.setAttribute("data-open", ""); document.body.setAttribute("data-lb-open", "");
  show(index); root.querySelector(".close")?.focus({ preventScroll: true });
}

export function closeLightbox() {
  const { root } = els(); if (!root || !state) return;
  const view = state, it = current();
  state = null; gesture = lastTap = null; points.clear();
  root.removeAttribute("data-open"); root.removeAttribute("data-zoomed"); root.removeAttribute("data-dragging");
  document.body.removeAttribute("data-lb-open");
  view.onClose?.(it, view.cur);
}

export function itemFromImg(el) {
  return { el, id: el.dataset.lbId, base: el.getAttribute("src").split("/").slice(0, -2).join("/"), sizes: el.dataset.lbSizes.split(",").map(Number), w: Number(el.dataset.lbW), h: Number(el.dataset.lbH), exif: el.dataset.lbExif || "", alt: el.alt, index: Number(el.dataset.lbIndex), title: el.dataset.lbTitle || undefined };
}

document.addEventListener("keydown", (e) => {
  if (!state) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowRight" || (e.key === " " && !e.target.closest("button"))) { e.preventDefault(); show(state.cur + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); show(state.cur - 1); }
  else if (["+", "=", "-", "0"].includes(e.key)) { e.preventDefault(); zoomAt(e.key === "0" ? 1 : state.zoom * (e.key === "-" ? 1 / 1.5 : 1.5)); }
});
document.addEventListener("click", (e) => {
  if (!state || !els().root.contains(e.target)) return;
  const nav = e.target.closest("[data-lb-nav]"); if (nav) { show(state.cur + Number(nav.dataset.lbNav)); return; }
  if (e.target.closest("[data-lb-zoom]")) { zoomAt(state.zoom > 1.01 ? 1 : 2); return; }
  if (e.target.closest("[data-lb-close]") || e.target === els().root) closeLightbox();
});
document.addEventListener("dblclick", (e) => {
  if (!state || performance.now() - lastTouchTime < 500 || !els().stage.contains(e.target) || e.target.closest("button")) return;
  e.preventDefault(); zoomAt(state.zoom > 1.01 ? 1 : 2, e.clientX, e.clientY);
});
document.addEventListener("wheel", (e) => {
  if (!state || !els().stage.contains(e.target)) return;
  e.preventDefault();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  zoomAt(state.zoom * Math.exp(-delta * .002), e.clientX, e.clientY);
}, { passive: false });

const centre = () => { const [a, b] = [...points.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }; };
document.addEventListener("pointerdown", (e) => {
  if (!state || e.button > 0 || !els().stage.contains(e.target) || e.target.closest("button")) return;
  if (e.pointerType === "touch") lastTouchTime = performance.now();
  points.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) gesture = { startX: e.clientX, startY: e.clientY, x: state.x, y: state.y, touch: e.pointerType === "touch", multiple: false, moved: false };
  if (points.size === 2) Object.assign(gesture, { multiple: true, pinch: centre(), zoom: state.zoom, x: state.x, y: state.y });
  if (e.pointerType === "touch" || state.zoom > 1.01) { try { els().stage.setPointerCapture(e.pointerId); } catch {} }
});
document.addEventListener("pointermove", (e) => {
  if (!state || !gesture || !points.has(e.pointerId)) return;
  points.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
  if (Math.hypot(dx, dy) > 5) gesture.moved = true;
  if (points.size === 2 && gesture.pinch) {
    const p = centre(), rect = els().stage.getBoundingClientRect(), ratio = Math.max(1, Math.min(6, gesture.zoom * p.distance / Math.max(1, gesture.pinch.distance))) / gesture.zoom;
    state.zoom = gesture.zoom * ratio;
    state.x = (gesture.x - (gesture.pinch.x - rect.left - rect.width / 2)) * ratio + p.x - rect.left - rect.width / 2;
    state.y = (gesture.y - (gesture.pinch.y - rect.top - rect.height / 2)) * ratio + p.y - rect.top - rect.height / 2;
    paint();
  } else if (state.zoom > 1.01) {
    state.x = gesture.x + dx; state.y = gesture.y + dy; els().root.setAttribute("data-dragging", ""); paint();
  }
});
function endPointer(e, cancelled = false) {
  if (!state || !gesture || !points.has(e.pointerId)) return;
  points.delete(e.pointerId); els().root.removeAttribute("data-dragging");
  if (points.size) { const p = [...points.values()][0]; Object.assign(gesture, { startX: p.x, startY: p.y, x: state.x, y: state.y, pinch: null }); return; }
  const g = gesture; gesture = null;
  if (cancelled || g.multiple) { lastTap = null; return; }
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (g.touch && state.zoom <= 1.01 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { show(state.cur + (dx < 0 ? 1 : -1)); return; }
  if (g.touch && !g.moved) {
    if (lastTap && performance.now() - lastTap.time < 300 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 30) { zoomAt(state.zoom > 1.01 ? 1 : 2, e.clientX, e.clientY); lastTap = null; }
    else lastTap = { x: e.clientX, y: e.clientY, time: performance.now() };
  }
}
document.addEventListener("pointerup", (e) => endPointer(e));
document.addEventListener("pointercancel", (e) => endPointer(e, true));
window.addEventListener("resize", () => { if (state) { layout(); loadImage(current(), state.zoom > 1.01 ? zoomSize(current()) : previewFor(current())); } });

function armFigures() {
  const imgs = [...document.querySelectorAll("img[data-lb-id]")]; if (!imgs.length) return;
  const items = imgs.map(itemFromImg).sort((a, b) => a.index - b.index), title = document.querySelector(".series-head h1")?.textContent ?? "";
  items.forEach((it, i) => {
    it.el.setAttribute("tabindex", "0"); it.el.setAttribute("role", "button");
    const open = () => openLightbox(items, i, { title, onClose: (cur) => { cur.el.scrollIntoView({ block: "center", behavior: "instant" }); cur.el.focus?.({ preventScroll: true }); } });
    it.el.addEventListener("click", open);
    it.el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}
document.addEventListener("astro:page-load", armFigures);
document.addEventListener("astro:before-swap", () => { if (state) closeLightbox(); });
