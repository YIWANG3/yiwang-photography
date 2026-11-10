// Theme: an explicit choice beats the page's tone, which beats the system setting.
// Runs once (the index and topbar persist across client navigations) and re-applies after each swap.
// Also marks images as loaded so they can fade in, and keeps the index's current item in sync.
const root = document.documentElement;

function apply() {
  let pref = null, lang = null;
  try { pref = localStorage.getItem("theme"); lang = localStorage.getItem("lang"); } catch {}
  const tone = root.dataset.tone;
  const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.theme = pref === "light" || pref === "dark" ? pref : tone === "dark" ? "dark" : sys;
  setLang(lang === "zh" || lang === "en" ? lang : /^zh\b/i.test(navigator.language || "") ? "zh" : "en");
}

// Language: the visible text switches by CSS (<html data-lang>); labels, tooltips, image descriptions and the tab title are swapped here.
// An element names its Chinese attribute as data-zh-<attr>; the English one is kept in data-en-<attr> the first time.
function setLang(lang) {
  const zh = lang === "zh";
  root.dataset.lang = lang; root.lang = zh ? "zh-Hans" : "en";
  for (const el of document.querySelectorAll("[data-zh-aria-label], [data-zh-title], [data-zh-alt]")) {
    for (const [attr, key] of [["aria-label", "AriaLabel"], ["title", "Title"], ["alt", "Alt"]]) {
      if (!(`zh${key}` in el.dataset)) continue;
      if (!(`en${key}` in el.dataset)) el.dataset[`en${key}`] = el.getAttribute(attr) ?? "";
      el.setAttribute(attr, el.dataset[zh ? `zh${key}` : `en${key}`]);
    }
  }
  const title = document.querySelector("title");
  if (title) { if (!("en" in title.dataset)) title.dataset.en = title.textContent; document.title = zh && title.dataset.zh ? title.dataset.zh : title.dataset.en; }
}

function markCurrent() {
  const current = document.querySelector("main")?.dataset.current;
  for (const a of document.querySelectorAll("[data-slug]")) {
    if (a.dataset.slug === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  closeSide();
  // Keep the current series in view inside the index's own scroll area.
  document.querySelector(`.index .series-list a[data-slug="${current}"]`)?.scrollIntoView({ block: "nearest" });
}

function watchImages() {
  for (const img of document.querySelectorAll("main img:not(.is-loaded)")) {
    if (img.complete && img.naturalWidth > 0) img.classList.add("is-loaded");
    else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => img.classList.add("is-loaded"), { once: true });
  }
}

// Mobile side panel (the index, slid in from the left).
const side = document.getElementById("side");
function openSide() {
  if (!side) return;
  side.dataset.open = "";
  side.setAttribute("aria-hidden", "false");
  root.classList.add("no-scroll");
  side.querySelector('.series-list a[aria-current="page"]')?.scrollIntoView({ block: "center" });
}
function closeSide() {
  if (!side || !("open" in side.dataset)) return;
  delete side.dataset.open;
  side.setAttribute("aria-hidden", "true");
  root.classList.remove("no-scroll");
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-lang-switch]")) {
    const next = root.dataset.lang === "zh" ? "en" : "zh";
    try { localStorage.setItem("lang", next); } catch {}
    setLang(next); return;
  }
  if (e.target.closest("[data-side-open]")) return openSide();
  if (e.target.closest("[data-side-close]") || e.target.closest(".side a[href]")) closeSide();
  if (!e.target.closest("[data-theme-toggle]")) return;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSide(); });
document.addEventListener("astro:before-swap", closeSide);
document.addEventListener("astro:after-swap", () => { apply(); markCurrent(); });
document.addEventListener("astro:page-load", watchImages);
apply();
markCurrent();
watchImages();
