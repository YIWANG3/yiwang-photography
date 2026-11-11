// Motion on the pages themselves (see motion.js for the rules): content arriving, a cover travelling to its place
// at the head of its series, and a line along the top while the next page is on its way.
import { arrive, calm, ms, ease, STEP } from "./motion.js";

const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };

// --- Arriving. The heading, then what is on screen, one after another; the rest as it is scrolled to.
let watcher = null;
function enter() {
  watcher?.disconnect(); watcher = null;
  for (const el of document.querySelectorAll("[data-rv]")) el.removeAttribute("data-rv");
  let n = 0;
  for (const el of document.querySelectorAll("main .series-head > *, main .page-title")) arrive(el, STEP * n++);
  watcher = new IntersectionObserver((entries) => {
    let k = 0;
    for (const e of entries) if (e.isIntersecting) { watcher.unobserve(e.target); e.target.removeAttribute("data-rv"); arrive(e.target, STEP * k++); }
  }, { rootMargin: "0px 0px -6% 0px" });
  for (const el of document.querySelectorAll("main .fig, main .cover, main .grid > *")) {
    if (el.querySelector("[data-flown]")) continue; // it has just travelled here
    if (onScreen(el)) arrive(el, STEP * Math.min(n++, 10));
    else { el.setAttribute("data-rv", ""); watcher.observe(el); }
  }
}

// --- A cover travels. Every cover is the first photograph of its series, so between the home page and a series
// the same picture exists on both sides: it is named on the page being left and on the one arrived at, and the
// browser moves it. Its box is first made the picture's own shape (a cover letterboxes inside a fixed frame).
let flight = null;
const head = () => document.querySelector('main .flow img[data-lb-index="0"]');
function name(img, borrowed) {
  img.dataset.flown = ""; img.style.viewTransitionName = "flown";
  img.style.transition = "none"; if (img.complete && img.naturalWidth) img.classList.add("is-loaded"); // it is the picture in flight: no fade of its own
  if (img.closest(".cover")) {
    const frame = img.parentElement.getBoundingClientRect(), w = Number(img.getAttribute("width")), h = Number(img.getAttribute("height"));
    const k = Math.min(frame.width * .86 / w, frame.height * .86 / h);
    Object.assign(img.style, { inset: "auto", left: `${(frame.width - w * k) / 2}px`, top: `${(frame.height - h * k) / 2}px`, width: `${w * k}px`, height: `${h * k}px` });
  }
  // Until its own file arrives it shows the one the other page already had.
  if (borrowed && !(img.complete && img.naturalWidth)) { img.style.background = `url("${borrowed}") center / 100% 100% no-repeat`; img.classList.add("is-loaded"); img.addEventListener("load", () => { img.style.background = ""; }, { once: true }); }
}
function unname() {
  for (const img of document.querySelectorAll("[data-flown]")) { delete img.dataset.flown; for (const k of ["viewTransitionName", "transition", "inset", "left", "top", "width", "height"]) img.style[k] = ""; }
}
document.addEventListener("astro:before-preparation", (e) => {
  flight = null; unname();
  if (calm() || !document.startViewTransition) return;
  const to = e.to.pathname, cover = document.querySelector(`main .cover[href="${to}"] img`), from = cover ?? (to === "/" ? head() : null);
  if (!from || !onScreen(from) || !(from.complete && from.naturalWidth)) return;
  flight = { to: cover ? "series" : "home", back: e.from.pathname, src: from.currentSrc }; // not location: on Back it has already moved
  name(from);
});
document.addEventListener("astro:after-swap", () => {
  if (!flight) return;
  const target = flight.to === "series" ? head() : document.querySelector(`main .cover[href="${flight.back}"] img`);
  if (target && onScreen(target)) name(target, flight.src);
});
document.addEventListener("astro:before-swap", (e) => { e.viewTransition?.finished.finally(() => { flight = null; unname(); }); });

// --- A line along the top edge while the next page is on its way, shown only when that takes a moment.
let bar = null, barTimer = 0, barRun = null;
function barStart() {
  clearTimeout(barTimer);
  barTimer = setTimeout(() => {
    bar ??= document.documentElement.appendChild(Object.assign(document.createElement("div"), { id: "nav-bar" }));
    bar.style.cssText = "position:fixed;z-index:90;left:0;top:0;width:100%;height:2px;background:var(--fg);transform-origin:left;pointer-events:none";
    barRun?.cancel();
    barRun = bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(.85)" }], { duration: 2400, easing: ease(), fill: "both" });
  }, 140);
}
function barEnd() {
  clearTimeout(barTimer);
  if (!bar || !barRun) return;
  const at = getComputedStyle(bar).transform; barRun.cancel(); barRun = null;
  const done = bar.animate([{ transform: at, opacity: 1 }, { transform: "scaleX(1)", opacity: 1, offset: .5 }, { transform: "scaleX(1)", opacity: 0 }], { duration: ms("base") * 1.6, easing: ease(), fill: "both" });
  done.onfinish = () => { if (!barRun) { bar?.remove(); bar = null; } };
}
document.addEventListener("astro:before-preparation", barStart);
document.addEventListener("astro:after-swap", barEnd);

// Arrivals start in the same breath as the content itself (the first parse, or the swap), never a frame later:
// until then the stylesheet keeps what will arrive unseen (<html data-pre>, set in the head on the first load).
document.addEventListener("astro:after-swap", enter);
enter();
delete document.documentElement.dataset.pre;
