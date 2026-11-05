// Lightbox: one viewer shared by the series pages (items read from the figures on the page) and the map page
// (items handed over by the map). Picks the right rung for the viewport, preloads neighbours, re-arms on
// every page load including client-side navigations.
let state = null; // { items, cur, title, onClose }

function els() {
  return {
    root: document.getElementById("lb"),
    img: document.getElementById("lb-img"),
    title: document.getElementById("lb-title"),
    exif: document.getElementById("lb-exif"),
  };
}

function urlFor(it) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const need = Math.max(window.innerWidth, window.innerHeight * (it.w / it.h)) * dpr;
  const w = it.sizes.find((s) => s >= need) ?? it.sizes[it.sizes.length - 1];
  return `${it.base}/${it.id}/${w}.webp`;
}

function show(i) {
  const { img, title, exif } = els();
  const { items } = state;
  state.cur = (i + items.length) % items.length;
  const it = items[state.cur];
  img.classList.add("is-switching");
  img.addEventListener("load", () => img.classList.remove("is-switching"), { once: true });
  img.src = urlFor(it);
  if (img.complete) img.classList.remove("is-switching");
  img.width = it.w; img.height = it.h;
  img.alt = it.alt || `${it.title ?? state.title} ${state.cur + 1}`;
  title.textContent = `${it.title ?? state.title} · ${String(state.cur + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;
  exif.replaceChildren(...(it.exif || "").split(" · ").filter(Boolean).map((s) => Object.assign(document.createElement("span"), { textContent: s })));
  for (const d of [1, -1]) { const n = items[(state.cur + d + items.length) % items.length]; const p = new Image(); p.src = urlFor(n); }
}

export function openLightbox(items, index = 0, { title = "", onClose } = {}) {
  const { root } = els();
  if (!root || !items.length) return;
  state = { items, cur: -1, title, onClose };
  root.setAttribute("data-open", "");
  document.body.setAttribute("data-lb-open", "");
  show(index);
  root.querySelector(".close")?.focus({ preventScroll: true });
}

export function closeLightbox() {
  const { root } = els();
  if (!root || !state) return;
  root.removeAttribute("data-open");
  document.body.removeAttribute("data-lb-open");
  const it = state.items[state.cur];
  state.onClose?.(it, state.cur);
  state = null;
}

export function itemFromImg(el) {
  return {
    el,
    id: el.dataset.lbId,
    base: el.getAttribute("src").split("/").slice(0, -2).join("/"),
    sizes: el.dataset.lbSizes.split(",").map(Number),
    w: Number(el.dataset.lbW),
    h: Number(el.dataset.lbH),
    exif: el.dataset.lbExif || "",
    alt: el.alt,
    index: Number(el.dataset.lbIndex),
  };
}

// Global listeners, installed once.
document.addEventListener("keydown", (e) => {
  if (!state) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); show(state.cur + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); show(state.cur - 1); }
});
document.addEventListener("click", (e) => {
  if (!state) return;
  const root = els().root;
  if (!root || !root.contains(e.target)) return;
  const nav = e.target.closest("[data-lb-nav]"); if (nav) { show(state.cur + Number(nav.dataset.lbNav)); return; }
  if (e.target.closest("[data-lb-close]") || e.target === root) closeLightbox();
});
let x0 = null;
document.addEventListener("touchstart", (e) => { if (state) x0 = e.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", (e) => { if (!state || x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) show(state.cur + (dx < 0 ? 1 : -1)); }, { passive: true });

// Series pages: figures with data-lb-* open the viewer; closing scrolls back to the photo.
function armFigures() {
  const imgs = [...document.querySelectorAll("img[data-lb-id]")];
  if (!imgs.length) return;
  const items = imgs.map(itemFromImg).sort((a, b) => a.index - b.index);
  const title = document.querySelector(".series-head h1")?.textContent ?? "";
  items.forEach((it, i) => {
    it.el.setAttribute("tabindex", "0"); it.el.setAttribute("role", "button");
    const open = () => openLightbox(items, i, { title, onClose: (cur) => { cur.el.scrollIntoView({ block: "center", behavior: "instant" }); cur.el.focus?.({ preventScroll: true }); } });
    it.el.addEventListener("click", open);
    it.el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}
document.addEventListener("astro:page-load", armFigures);
document.addEventListener("astro:before-swap", () => { if (state) closeLightbox(); });
