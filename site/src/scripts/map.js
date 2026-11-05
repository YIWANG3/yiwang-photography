// Map page: Google Maps (classic, custom-styled) with clustered photo markers. Markers and clusters are
// circular thumbnails drawn on a canvas; clicking a marker, or a cluster that cannot split further,
// opens a strip of the photos there; a thumbnail in the strip opens the shared lightbox.
import { Loader } from "@googlemaps/js-api-loader";
import { MarkerClusterer, SuperClusterAlgorithm } from "@googlemaps/markerclusterer";
import { openLightbox } from "./lightbox.js";
import { LIGHT, DARK } from "./mapStyles.js";

let instance = null;
const PIN = 36, CLUSTER = 48, DPR = Math.min(window.devicePixelRatio || 1, 2);

async function init() {
  const page = document.querySelector(".map-page");
  if (!page || instance?.page === page) return;
  const key = page.dataset.key;
  if (!key) return;
  const points = JSON.parse(page.dataset.points);
  const base = page.dataset.base;
  const canvas = document.getElementById("map");
  const panel = document.getElementById("map-panel");
  const strip = document.getElementById("map-strip");
  const panelTitle = document.getElementById("map-panel-title");
  const isDark = () => document.documentElement.dataset.theme === "dark";

  const loader = new Loader({ apiKey: key, version: "weekly" });
  const { Map: GMap } = await loader.importLibrary("maps");
  await loader.importLibrary("marker");

  const map = new GMap(canvas, {
    center: { lat: 35.6586, lng: 139.7454 },
    zoom: 3,
    minZoom: 2,
    styles: isDark() ? DARK : LIGHT,
    backgroundColor: isDark() ? "#101214" : "#dde3e6",
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    clickableIcons: false,
  });
  // Follow the theme toggle without reloading.
  new MutationObserver(() => {
    map.setOptions({ styles: isDark() ? DARK : LIGHT, backgroundColor: isDark() ? "#101214" : "#dde3e6" });
    for (const m of markers) m.setIcon(dotIcon(PIN));
    iconCache.clear(); scheduleIcons();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const thumbs = new Map();
  // Thumbnails are drawn onto a canvas, so a CDN-hosted image must be fetched with CORS (the R2 bucket allows
  // the site's origins); without it the canvas would be tainted and the icon could not be exported.
  const loadThumb = (url) => thumbs.get(url) ?? thumbs.set(url, new Promise((res) => {
    const im = new Image(); im.decoding = "async";
    if (new URL(url, location.href).origin !== location.origin) im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
  })).get(url);

  function ring() { return isDark() ? "#2a2b2e" : "#ffffff"; }
  function badge() { return isDark() ? ["#f7f6f3", "#1b1b1a"] : ["#1b1b1a", "#ffffff"]; }
  function dotIcon(size) {
    const c = document.createElement("canvas"); c.width = c.height = size * DPR;
    const x = c.getContext("2d"); x.scale(DPR, DPR);
    x.beginPath(); x.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); x.fillStyle = isDark() ? "#3a3b3e" : "#dcdbd5"; x.fill();
    x.lineWidth = 2; x.strokeStyle = ring(); x.stroke();
    return { url: c.toDataURL(), scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size / 2, size / 2) };
  }
  async function thumbIcon(url, size, count) {
    const im = await loadThumb(url);
    if (!im) return dotIcon(size);
    try { return drawThumb(im, size, count); } catch { return dotIcon(size); }
  }
  function drawThumb(im, size, count) {
    const pad = count ? 8 : 0, W = size + pad; // room for the badge on clusters
    const c = document.createElement("canvas"); c.width = c.height = W * DPR;
    const x = c.getContext("2d"); x.scale(DPR, DPR);
    x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 6; x.shadowOffsetY = 2;
    x.beginPath(); x.arc(size / 2, size / 2 + pad, size / 2 - 2, 0, Math.PI * 2); x.fillStyle = ring(); x.fill();
    x.shadowColor = "transparent";
    x.save(); x.beginPath(); x.arc(size / 2, size / 2 + pad, size / 2 - 4, 0, Math.PI * 2); x.clip();
    const s = Math.max(size / im.naturalWidth, size / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    x.drawImage(im, size / 2 - dw / 2, size / 2 + pad - dh / 2, dw, dh); x.restore();
    x.lineWidth = 2; x.strokeStyle = ring(); x.beginPath(); x.arc(size / 2, size / 2 + pad, size / 2 - 3, 0, Math.PI * 2); x.stroke();
    if (count) {
      const [bg, fg] = badge(); const t = String(count);
      x.font = `500 11px Poppins, system-ui, sans-serif`; const tw = Math.max(10, x.measureText(t).width);
      const bw = tw + 12, bh = 20, bx = W - bw - 1, by = 1;
      x.fillStyle = bg; x.beginPath(); x.roundRect(bx, by, bw, bh, 10); x.fill();
      x.fillStyle = fg; x.textBaseline = "middle"; x.textAlign = "center"; x.fillText(t, bx + bw / 2, by + bh / 2 + 0.5);
    }
    return { url: c.toDataURL(), scaledSize: new google.maps.Size(W, W), anchor: new google.maps.Point(size / 2, size / 2 + pad) };
  }

  // Icons are drawn lazily so 235 thumbnails never block the first paint.
  const iconCache = new Map();
  const pending = new Set();
  let rafId = 0;
  function scheduleIcons() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(drainIcons); }
  async function drainIcons() {
    for (const job of [...pending]) { pending.delete(job); await job(); }
  }
  function wantIcon(marker, url, size, count) {
    const k = `${url}|${size}|${count ?? 0}|${isDark()}`;
    const hit = iconCache.get(k);
    if (hit) { marker.setIcon(hit); return; }
    pending.add(async () => { const ic = await thumbIcon(url, size, count); iconCache.set(k, ic); if (marker.getMap()) marker.setIcon(ic); });
    scheduleIcons();
  }

  const markers = points.map((p) => {
    const m = new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, icon: dotIcon(PIN), title: p.series, optimized: true });
    m.addListener("click", () => showStrip([p], p.label));
    m.__p = p;
    return m;
  });

  // Initial view: span the shortest arc that contains every point, which may cross the antimeridian
  // (Tokyo, San Francisco and Newcastle fit together only when the Pacific is in the middle).
  if (points.length) {
    const lngs = points.map((p) => p.lng).sort((a, b) => a - b);
    let gapStart = lngs[lngs.length - 1], gapEnd = lngs[0] + 360, maxGap = gapEnd - gapStart;
    for (let i = 0; i < lngs.length - 1; i++) if (lngs[i + 1] - lngs[i] > maxGap) { maxGap = lngs[i + 1] - lngs[i]; gapStart = lngs[i]; gapEnd = lngs[i + 1]; }
    const lats = points.map((p) => p.lat);
    const norm = (l) => ((l + 540) % 360) - 180;
    map.fitBounds(new google.maps.LatLngBounds({ lat: Math.min(...lats), lng: norm(gapEnd) }, { lat: Math.max(...lats), lng: norm(gapStart) }), 48);
    // On narrow screens the whole arc cannot fit at minZoom; centre on where most photographs are instead.
    const offsets = points.map((p) => ((p.lng - gapEnd) % 360 + 360) % 360);
    const meanLng = norm(gapEnd + offsets.reduce((a, b) => a + b, 0) / offsets.length);
    const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    google.maps.event.addListenerOnce(map, "idle", () => {
      const b = map.getBounds(); if (!b) return;
      const visible = (((b.getNorthEast().lng() - b.getSouthWest().lng()) % 360) + 360) % 360 || 360;
      if (visible < 360 - maxGap - 1) map.setCenter({ lat: meanLat, lng: meanLng });
    });
  }

  new MarkerClusterer({
    map, markers,
    algorithm: new SuperClusterAlgorithm({ radius: 70, maxZoom: 16 }),
    renderer: {
      render({ count, position, markers: ms }) {
        const m = new google.maps.Marker({ position, icon: dotIcon(CLUSTER), zIndex: 1000 + count, optimized: true });
        wantIcon(m, ms[0].__p.thumb, CLUSTER, count);
        return m;
      },
    },
    onClusterClick(_e, cluster, m) {
      if (m.getZoom() >= 16) {
        const ps = cluster.markers.map((mk) => mk.__p);
        showStrip(ps, ps.every((p) => p.label === ps[0].label) ? ps[0].label : ps.every((p) => p.slug === ps[0].slug) ? ps[0].series : `${ps.length} photographs`);
      } else {
        m.fitBounds(cluster.bounds, 80);
      }
    },
  });
  // Single markers get their thumbnail once they are actually on the map.
  map.addListener("idle", () => { for (const m of markers) if (m.getMap() && !m.__thumbed) { m.__thumbed = true; wantIcon(m, m.__p.thumb, PIN); } });

  function showStrip(ps, title) {
    panelTitle.textContent = title;
    strip.replaceChildren(...ps.map((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<img src="${p.thumb}" width="${p.w}" height="${p.h}" alt="${p.label}" loading="lazy" decoding="async"><span>${p.label}</span>`;
      b.addEventListener("click", () => openLightbox(ps.map((q) => ({ id: q.id, base, sizes: q.sizes, w: q.w, h: q.h, exif: q.exif, alt: q.label, title: q.label })), i));
      return b;
    }));
    panel.hidden = false;
  }
  // Map / Satellite. Styles only apply to the road map; hybrid keeps Google's own labels.
  const typeButtons = [...page.querySelectorAll("[data-map-type]")];
  function setType(t) {
    map.setMapTypeId(t);
    typeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapType === t)));
    page.dataset.mapType = t;
    try { localStorage.setItem("mapType", t); } catch {}
  }
  typeButtons.forEach((b) => b.addEventListener("click", () => setType(b.dataset.mapType)));
  let savedType = null; try { savedType = localStorage.getItem("mapType"); } catch {}
  if (savedType === "hybrid") setType("hybrid");

  panel.querySelector("[data-panel-close]").addEventListener("click", () => { panel.hidden = true; });
  map.addListener("click", () => { panel.hidden = true; });

  instance = { page, map };
  if (import.meta.env.DEV) window.__pmap = map; // dev only: lets us drive the map from the console
}

document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => { instance = null; });
