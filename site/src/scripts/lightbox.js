// Preview first; the full-resolution rung is requested only when the user zooms.
import { fitDimensions, previewSize, zoomSize, clampPan } from "./lightbox-image.js";
import { t, pick } from "../i18n/ui.js";
import { calm, ms, ease } from "./motion.js";

const PHOTO_HASH = /^#[0-9a-f]{12}$/;
let state = null, gesture = null, lastTap = null, lastTouchTime = 0;
const points = new Map();
let closing = null; // the viewer on its way out: { finish }, so that opening again can cut it short
const els = () => ({ root: document.getElementById("lb"), bg: document.getElementById("lb-bg"), stage: document.getElementById("lb-stage"), img: document.getElementById("lb-img"), title: document.getElementById("lb-title"), exif: document.getElementById("lb-exif") });
const current = () => state.items[state.cur];
const imageUrl = (it, size) => `${it.base}/${it.id}/${size}.webp`;
const viewport = () => { const { stage } = els(); return { width: stage.clientWidth, height: stage.clientHeight }; };
const previewFor = (it) => { const v = viewport(); return previewSize(it, v.width - 32, v.height - 32, window.devicePixelRatio); };

// Motion (the rules are in motion.js). The photograph travels between its place on the page and the viewer;
// everything else only fades.
const live = new Set();
const chrome = () => [...els().root.querySelectorAll(".bar, .close, .zoom")];
function run(el, frames, length, { then } = {}) {
  const a = el.animate(frames, { duration: typeof length === "number" ? length : ms(length), easing: ease(), fill: "both" });
  live.add(a);
  // Once it has run, the element's own style is the truth again.
  a.onfinish = () => { live.delete(a); a.cancel(); then?.(); };
  return a;
}
function settle(el) { for (const a of [...live]) if (!el || a.effect?.target === el) { live.delete(a); a.cancel(); } }
// While the photograph is in flight its thumbnail is lifted off the page, so there is only ever one of it.
let lifted = null, plain = false; // plain: opened by a link to the photograph, which has no place it was clicked from
function lift(el) { putBack(); lifted = el; el.style.visibility = "hidden"; }
function putBack() { if (lifted) lifted.style.visibility = ""; lifted = null; }
function dropGhosts() { for (const g of els().stage.querySelectorAll(".lb-ghost")) g.remove(); }

// Where the photograph sits on the page: the drawn picture inside its box (thumbnails letterbox, never crop).
// Null when it is not there to travel to: no thumbnail, not loaded yet, or outside the window.
function placeOnPage(it) {
  const el = it.el; if (!el?.isConnected || !el.complete || !el.naturalWidth) return null;
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const k = Math.min(r.width / it.w, r.height / it.h), w = it.w * k, h = it.h * k;
  const x = r.left + (r.width - w) / 2, y = r.top + (r.height - h) / 2;
  return x + w < 0 || y + h < 0 || x > innerWidth || y > innerHeight ? null : { x, y, w, h };
}
// The transform that lays the fitted image (centred in the stage) over a place on the page.
function over(place, fit) {
  const s = els().stage.getBoundingClientRect();
  return `translate3d(${place.x + place.w / 2 - s.left - s.width / 2}px, ${place.y + place.h / 2 - s.top - s.height / 2}px, 0) scale(${place.w / fit.width})`;
}
// The thumbnail's own file is already decoded: the viewer starts from it rather than from the smallest rung.
function seedFrom(it) {
  const el = it.el; if (!el?.complete || !el.naturalWidth) return null;
  const m = /\/(\d+)\.webp(?:$|\?)/.exec(el.currentSrc || "");
  return m ? { src: el.currentSrc, size: Number(m[1]) } : null;
}

function comeIn(it) {
  const { root, bg, img } = els();
  const from = calm() || plain ? null : placeOnPage(it), rest = img.style.transform;
  if (from) {
    lift(it.el); root.setAttribute("data-moving", "");
    run(img, [{ transform: over(from, state.fit) }, { transform: rest }], "move", { then: () => { putBack(); root.removeAttribute("data-moving"); } });
  } else run(img, [{ opacity: 0 }, { opacity: 1 }], "base"); // no place to come from: it fades, like everything else
  const length = from ? "move" : "base";
  run(bg, [{ opacity: 0 }, { opacity: 1 }], length);
  for (const el of chrome()) run(el, [{ opacity: 0 }, { opacity: 1 }], length);
}

// Paging: the photograph being left stays for a moment as a copy and fades out under the new one.
// carried: the photograph was already dragged sideways by that much; it keeps going and the next follows it in.
function turn(img, dir, carried) {
  const g = img.cloneNode(false); g.removeAttribute("id"); g.alt = ""; g.setAttribute("aria-hidden", "true"); g.decoding = "sync"; g.classList.add("lb-ghost");
  Object.assign(g.style, { position: "absolute", left: "50%", top: "50%", marginLeft: `${-img.offsetWidth / 2}px`, marginTop: `${-img.offsetHeight / 2}px` });
  const was = img.style.transform;
  img.before(g);
  if (carried != null) {
    const gone = dir * viewport().width + carried;
    run(g, [{ transform: was }, { transform: `translate3d(${-gone}px, 0, 0) ${was}` }], "move", { then: () => g.remove() });
    return (rest) => run(img, [{ transform: `translate3d(${gone}px, 0, 0) ${rest}` }, { transform: rest }], "move");
  }
  run(g, [{ opacity: 1 }, { opacity: 0 }], "base", { then: () => g.remove() });
  return () => run(img, [{ opacity: 0 }, { opacity: 1 }], "base");
}

// A pull (drag up or down at rest) carries the photograph with the finger and thins the black; letting go either
// closes the viewer from wherever the photograph is, or lets it settle back.
function paintPull() {
  const { bg } = els(), p = state?.pull, far = p ? Math.min(Math.abs(p.y) / (viewport().height * .5), 1) : 0;
  bg.style.opacity = p ? String(1 - far * .85) : "";
  for (const el of chrome()) el.style.opacity = p ? String(Math.max(0, 1 - Math.abs(p.y) / 60)) : "";
  els().root.toggleAttribute("data-moving", !!p && !p.side);
}
function release() {
  const { bg, img } = els(), was = getComputedStyle(img).transform, dim = getComputedStyle(bg).opacity, faded = chrome().map((el) => [el, getComputedStyle(el).opacity]);
  state.pull = null; paint(); paintPull();
  run(img, [{ transform: was }, { transform: img.style.transform }], "base");
  run(bg, [{ opacity: dim }, { opacity: 1 }], "base");
  for (const [el, o] of faded) run(el, [{ opacity: o }, { opacity: 1 }], "base");
}

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
    img.classList.remove("is-loading", "is-arriving");
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
  const p = state.pull, k = p ? 1 - Math.min(Math.abs(p.y) / v.height, 1) * .3 : 1;
  img.style.transform = `translate3d(${state.x + (p?.x ?? 0)}px, ${state.y + (p?.y ?? 0)}px, 0) scale(${state.zoom * k})`;
  root.toggleAttribute("data-zoomed", state.zoom > 1.01);
  root.dataset.zoom = state.zoom.toFixed(2);
  const button = root.querySelector("[data-lb-zoom]");
  button?.setAttribute("aria-label", state.zoom > 1.01 ? t().lbResetZoom : t().lbZoomIn);
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

// smooth: a step the user asked for in one go (button, double click, key) glides; wheel and pinch already move by hand.
function zoomAt(zoom, clientX, clientY, smooth = false) {
  if (!state) return;
  const was = smooth && !calm() ? getComputedStyle(els().img).transform : null;
  const rect = els().stage.getBoundingClientRect();
  const x = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
  const y = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
  const next = Math.max(1, Math.min(6, zoom)), ratio = next / state.zoom;
  state.x = x - (x - state.x) * ratio; state.y = y - (y - state.y) * ratio;
  state.zoom = next;
  if (next === 1) state.x = state.y = 0;
  paint();
  if (was) { const { img } = els(); settle(img); run(img, [{ transform: was }, { transform: img.style.transform }], "base"); }
}

function show(i, { opening = false, carried } = {}) {
  const old = state, { img, title, exif } = els();
  settle(img); dropGhosts(); putBack();
  const enter = opening ? null : turn(img, i < old.cur ? -1 : 1, carried);
  state = { ...old, pull: null, cur: (i + old.items.length) % old.items.length, zoom: 1, x: 0, y: 0, loaded: 0, pending: new Set() };
  gesture = lastTap = null; points.clear();
  els().root.removeAttribute("data-dragging");
  const it = current();
  // The smallest rung (usually cached from the gallery page) shows at once, blurred, and the preview sharpens
  // over it when decoded; the <img> never sits without a src, which is what flashed the broken-image glyph.
  // Opened from its thumbnail, it starts from the thumbnail's own file instead, sharp at the size it leaves from.
  const seed = opening && !calm() ? seedFrom(it) : null;
  delete img.dataset.loadedSize;
  img.classList.remove("is-arriving"); img.classList.toggle("is-loading", !seed); img.src = seed ? seed.src : imageUrl(it, it.sizes[0]);
  img.width = it.w; img.height = it.h;
  img.alt = it.el?.alt || it.alt || `${pick(it, "title") ?? state.title} ${state.cur + 1}`; // the figure's own, in the page's current language
  // On cross-series pages (Recent) the series name links to its page.
  const name = pick(it, "title") ?? state.title, counter = ` · ${String(state.cur + 1).padStart(2, "0")} / ${String(state.items.length).padStart(2, "0")}`;
  title.replaceChildren(it.href ? Object.assign(document.createElement("a"), { href: it.href, textContent: name }) : name, counter);
  exif.replaceChildren(...(pick(it, "exif") || "").split(" · ").filter(Boolean).map((s) => Object.assign(document.createElement("span"), { textContent: s })));
  // The address bar names the photograph while it is open, so the link can be copied or shared: its series page
  // plus #<id>. Replaced, never pushed: paging adds no history, and Back still leaves the page.
  if (it.page || it.id) history.replaceState(history.state, "", `${it.page ?? location.pathname}#${it.id}`);
  layout();
  if (seed) {
    // Good enough already: nothing to fetch until the user zooms. Too small for the screen: it softens as it grows.
    if (seed.size >= previewFor(it)) { state.loaded = seed.size; img.dataset.loadedSize = String(seed.size); }
    else if (seed.size < Math.max(state.fit.width, state.fit.height) * .75) { void img.offsetWidth; img.classList.add("is-loading", "is-arriving"); }
  }
  paintPull(); enter?.(img.style.transform);
  loadImage(it, previewFor(it));
  // Adjacent images are previews, even while the current photograph is zoomed.
  for (const d of [1, -1]) { const n = state.items[(state.cur + d + state.items.length) % state.items.length]; const p = new Image(); p.src = imageUrl(n, previewFor(n)); }
}

export function openLightbox(items, index = 0, { title = "", onClose } = {}) {
  const { root } = els();
  if (!root || !items.length) return;
  closing?.finish();
  // Where the address goes back to on close: this page, without a photograph's hash.
  state = { items, cur: -1, title, onClose, url: location.pathname + location.search + (PHOTO_HASH.test(location.hash) ? "" : location.hash) };
  root.setAttribute("data-open", ""); document.body.setAttribute("data-lb-open", "");
  show(index, { opening: true }); comeIn(current());
  root.querySelector(".close")?.focus({ preventScroll: true });
}

// restoreUrl is false when the page is already being left by Back/Forward: the address then belongs to the page
// being arrived at.
// animate is false when the page itself is going away.
export function closeLightbox({ restoreUrl = true, animate = true } = {}) {
  const { root, bg, img } = els(); if (!root || !state) return;
  const view = state, it = current(), fit = view.fit;
  if (restoreUrl) history.replaceState(history.state, "", view.url);
  // How it looks at this instant (mid-open, zoomed, or pulled halfway down) is where the way out starts.
  const was = getComputedStyle(img), start = { transform: was.transform, opacity: was.opacity }, dim = getComputedStyle(bg).opacity;
  const faded = chrome().map((el) => [el, getComputedStyle(el).opacity]);
  settle(); dropGhosts(); putBack();
  state = null; gesture = lastTap = null; points.clear();
  root.removeAttribute("data-zoomed"); root.removeAttribute("data-dragging");
  it.el?.closest("[data-rv]")?.removeAttribute("data-rv"); // not scrolled to before: it is simply there
  view.onClose?.(it, view.cur); // the page scrolls to the photograph under the black, and takes the focus back
  const focused = document.activeElement; // lifting the thumbnail off the page drops its focus; it gets it back at the end
  const finish = () => {
    closing = null; settle(); putBack();
    root.removeAttribute("data-open"); root.removeAttribute("data-closing"); root.removeAttribute("data-moving");
    document.body.removeAttribute("data-lb-open");
    bg.style.opacity = ""; for (const [el] of faded) el.style.opacity = "";
    if (focused?.isConnected && document.activeElement === document.body) focused.focus?.({ preventScroll: true });
  };
  if (!animate) return finish();
  const to = calm() ? null : placeOnPage(it);
  closing = { finish };
  root.setAttribute("data-closing", ""); root.setAttribute("data-moving", "");
  img.classList.remove("is-loading", "is-arriving");
  if (to) lift(it.el);
  const length = to ? ms("move") * .8 : ms("base") * .8; // the way out is a little quicker than the way in
  run(img, [start, to ? { transform: over(to, fit), opacity: 1 } : { transform: start.transform, opacity: 0 }], length, { then: () => closing?.finish === finish && finish() });
  run(bg, [{ opacity: dim }, { opacity: 0 }], length);
  for (const [el, o] of faded) run(el, [{ opacity: o }, { opacity: 0 }], "quick");
}

export function itemFromImg(el) {
  // Both languages ride along; show() picks the page's current one, so a switch while the page is open counts.
  const d = el.dataset;
  return { el, page: d.lbHref || undefined, id: d.lbId, base: el.getAttribute("src").split("/").slice(0, -2).join("/"), sizes: d.lbSizes.split(",").map(Number), w: Number(d.lbW), h: Number(d.lbH), exif: d.lbExif || "", exif_zh: d.lbExifZh, alt: el.alt, index: Number(d.lbIndex), title: d.lbTitle || undefined, title_zh: d.lbTitleZh, href: d.lbHref || undefined };
}

document.addEventListener("keydown", (e) => {
  if (!state) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowRight" || (e.key === " " && !e.target.closest("button"))) { e.preventDefault(); show(state.cur + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); show(state.cur - 1); }
  else if (["+", "=", "-", "0"].includes(e.key)) { e.preventDefault(); zoomAt(e.key === "0" ? 1 : state.zoom * (e.key === "-" ? 1 / 1.5 : 1.5), undefined, undefined, true); }
});
document.addEventListener("click", (e) => {
  if (!state || !els().root.contains(e.target)) return;
  const nav = e.target.closest("[data-lb-nav]"); if (nav) { show(state.cur + Number(nav.dataset.lbNav)); return; }
  if (e.target.closest("[data-lb-zoom]")) { zoomAt(state.zoom > 1.01 ? 1 : 2, undefined, undefined, true); return; }
  if (e.target.closest("[data-lb-close]") || e.target === els().root) closeLightbox();
});
document.addEventListener("dblclick", (e) => {
  if (!state || performance.now() - lastTouchTime < 500 || !els().stage.contains(e.target) || e.target.closest("button")) return;
  e.preventDefault(); zoomAt(state.zoom > 1.01 ? 1 : 2, e.clientX, e.clientY, true);
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
  if (points.size === 2) {
    if (state.pull) { state.pull = null; paint(); paintPull(); }
    Object.assign(gesture, { multiple: true, pinch: centre(), zoom: state.zoom, x: state.x, y: state.y });
  }
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
  } else if (!gesture.multiple) {
    // At rest the first few pixels decide: up or down pulls the photograph away, sideways drags it to the next.
    if (!gesture.axis && Math.hypot(dx, dy) > 8) {
      gesture.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      gesture.held = gesture.axis === "y" || !calm();
      if (gesture.held) { settle(); dropGhosts(); try { els().stage.setPointerCapture(e.pointerId); } catch {} }
    }
    if (gesture.held) {
      const now = performance.now(), d = gesture.axis === "y" ? dy : dx;
      if (gesture.at) gesture.v = .7 * (d - gesture.d) / Math.max(1, now - gesture.at) + .3 * (gesture.v ?? 0);
      gesture.at = now; gesture.d = d;
      state.pull = gesture.axis === "y" ? { x: dx, y: dy } : { x: dx, y: 0, side: true }; paint(); paintPull();
    }
  }
});
function endPointer(e, cancelled = false) {
  if (!state || !gesture || !points.has(e.pointerId)) return;
  points.delete(e.pointerId); els().root.removeAttribute("data-dragging");
  if (points.size) { const p = [...points.values()][0]; Object.assign(gesture, { startX: p.x, startY: p.y, x: state.x, y: state.y, pinch: null }); return; }
  const g = gesture; gesture = null;
  if (cancelled || g.multiple) { lastTap = null; if (state.pull) release(); return; }
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (state.pull) {
    // Far enough, or a flick: a quick short pull counts as well as a long slow one.
    const side = state.pull.side, d = side ? dx : dy, far = Math.abs(d) > (side ? 70 : Math.min(140, viewport().height * .2));
    const flick = Math.abs(d) > 24 && Math.abs(g.v ?? 0) > .5 && Math.sign(g.v) === Math.sign(d);
    if (!(far || flick)) release();
    else if (side) show(state.cur + (dx < 0 ? 1 : -1), { carried: state.pull.x });
    else closeLightbox();
    return;
  }
  if (g.touch && state.zoom <= 1.01 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { show(state.cur + (dx < 0 ? 1 : -1)); return; }
  if (g.touch && !g.moved) {
    if (lastTap && performance.now() - lastTap.time < 300 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 30) { zoomAt(state.zoom > 1.01 ? 1 : 2, e.clientX, e.clientY, true); lastTap = null; }
    else lastTap = { x: e.clientX, y: e.clientY, time: performance.now() };
  }
}
document.addEventListener("pointerup", (e) => endPointer(e));
document.addEventListener("pointercancel", (e) => endPointer(e, true));
window.addEventListener("resize", () => { if (state) { layout(); loadImage(current(), state.zoom > 1.01 ? zoomSize(current()) : previewFor(current())); } });

function armFigures() {
  const imgs = [...document.querySelectorAll("img[data-lb-id]")]; if (!imgs.length) return;
  const items = imgs.map(itemFromImg).sort((a, b) => a.index - b.index), title = "";
  items.forEach((it, i) => {
    it.el.setAttribute("tabindex", "0"); it.el.setAttribute("role", "button");
    const open = () => openLightbox(items, i, { title, onClose: (cur) => { cur.el.scrollIntoView({ block: "center", behavior: "instant" }); cur.el.focus?.({ preventScroll: true }); } });
    it.el.addEventListener("click", open);
    it.el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  openFromHash();
}
// A link to one photograph (/series/#<id>) opens it: on arrival, and when the address is changed on the page itself.
function openFromHash() {
  if (!state && PHOTO_HASH.test(location.hash)) { plain = true; document.querySelector(`img[data-lb-id="${location.hash.slice(1)}"]`)?.click(); plain = false; }
}
document.addEventListener("astro:page-load", armFigures);
// The address changed under an open viewer (Back over a typed link, or an edited hash): follow it.
window.addEventListener("hashchange", () => {
  if (!state) return openFromHash();
  if (!PHOTO_HASH.test(location.hash)) return closeLightbox({ restoreUrl: false });
  const i = state.items.findIndex((it) => it.id === location.hash.slice(1));
  if (i >= 0 && i !== state.cur) show(i);
});
// Leaving the page closes the viewer. A link puts this page's own address back first, so the history entry being
// left is the page and not the photograph; Back/Forward has already moved on.
document.addEventListener("astro:before-preparation", (e) => { if (state) closeLightbox({ restoreUrl: e.navigationType !== "traverse", animate: false }); });
document.addEventListener("astro:before-swap", () => { closing?.finish(); if (state) closeLightbox({ restoreUrl: false, animate: false }); });
