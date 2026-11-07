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
    zoomControl: matchMedia("(hover: hover)").matches, // phones pinch; the buttons would sit under the photo panel
    gestureHandling: "greedy",
    clickableIcons: false,
  });
  // Follow the theme toggle without reloading.
  new MutationObserver(() => {
    map.setOptions({ styles: isDark() ? DARK : LIGHT, backgroundColor: isDark() ? "#101214" : "#dde3e6" });
    iconCache.clear();
    for (const m of markers) { m.__iconKey = null; if (m.getMap()) wantIcon(m, m.__p.thumb, PIN, undefined, m.__p.approx); }
    for (const m of clusterMarkers) { m.__iconKey = null; wantIcon(m, m.__thumb, CLUSTER, m.__count, m.__approx); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Thumbnails are drawn onto a canvas, so a CDN-hosted image must be fetched with CORS (the R2 bucket allows
  // the site's origins); without it the canvas would be tainted and the icon could not be exported.
  // The gallery pages load the same files without CORS and the browser may reuse that cached response for a
  // CORS request and fail it, so the canvas copy uses its own URL (a query string, which R2 ignores).
  // `ready` holds decoded images so a cluster that appears later can get its icon synchronously, in the same
  // frame it is created; a failed load is forgotten so the next request retries instead of staying a dot.
  const thumbs = new Map(), ready = new Map();
  const loadThumb = (url) => thumbs.get(url) ?? thumbs.set(url, new Promise((res) => {
    const im = new Image(); im.decoding = "async";
    const cross = new URL(url, location.href).origin !== location.origin;
    if (cross) im.crossOrigin = "anonymous";
    im.onload = () => { ready.set(url, im); res(im); };
    im.onerror = () => { thumbs.delete(url); res(null); };
    im.src = cross ? `${url}${url.includes("?") ? "&" : "?"}canvas` : url;
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
  function drawThumb(im, size, count, approx) {
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
    if (approx) { // placed at the series' location, not where the camera stood: a dashed ring says so
      x.setLineDash([3, 3]); x.strokeStyle = isDark() ? "#9a9b9e" : "#6b6b66"; x.lineWidth = 1.5;
      x.beginPath(); x.arc(size / 2, size / 2 + pad, size / 2 - 1, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
    }
    if (count) {
      const [bg, fg] = badge(); const t = String(count);
      x.font = `500 11px Poppins, system-ui, sans-serif`; const tw = Math.max(10, x.measureText(t).width);
      const bw = tw + 12, bh = 20, bx = W - bw - 1, by = 1;
      x.fillStyle = bg; x.beginPath(); x.roundRect(bx, by, bw, bh, 10); x.fill();
      x.fillStyle = fg; x.textBaseline = "middle"; x.textAlign = "center"; x.fillText(t, bx + bw / 2, by + bh / 2 + 0.5);
    }
    return { url: c.toDataURL(), scaledSize: new google.maps.Size(W, W), anchor: new google.maps.Point(size / 2, size / 2 + pad) };
  }

  // Icons are cached per (image, size, badge, theme). A marker whose image is already decoded gets its
  // thumbnail at once; the others start as a dot and swap as soon as the image arrives.
  const iconCache = new Map();
  function cachedIcon(url, size, count, approx) {
    const k = `${url}|${size}|${count ?? 0}|${approx ? 1 : 0}|${isDark()}`;
    let ic = iconCache.get(k);
    if (!ic) {
      const im = ready.get(url);
      if (!im) return null;
      try { ic = drawThumb(im, size, count, approx); } catch { ic = dotIcon(size); }
      iconCache.set(k, ic);
    }
    return ic;
  }
  function wantIcon(marker, url, size, count, approx) {
    const k = `${url}|${size}|${count ?? 0}|${approx ? 1 : 0}|${isDark()}`;
    if (marker.__iconKey === k) return;
    const hit = cachedIcon(url, size, count, approx);
    if (hit) { marker.__iconKey = k; marker.setIcon(hit); return; }
    loadThumb(url).then((im) => {
      if (!im || marker.__iconKey === k) return;
      const ic = cachedIcon(url, size, count, approx);
      if (ic) { marker.__iconKey = k; marker.setIcon(ic); }
    });
  }
  // Thumbnails of the points in view are decoded ahead, a few at a time, so zooming into an area finds them
  // ready; nothing outside the view is fetched (334 photographs would be too much on a phone).
  const warmQueue = []; let warming = 0;
  function warm() {
    const b = map.getBounds(); if (!b || map.getZoom() < 5) return; // the world view only needs one image per cluster
    const seen = new Set();
    warmQueue.length = 0;
    for (const p of points) if (!ready.has(p.thumb) && !seen.has(p.thumb) && b.contains({ lat: p.lat, lng: p.lng })) { seen.add(p.thumb); warmQueue.push(p.thumb); }
    while (warming < 6 && warmQueue.length) {
      warming++;
      loadThumb(warmQueue.shift()).then(() => { warming--; if (warmQueue.length) warm(); });
    }
  }

  const markers = points.map((p) => {
    const m = new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, icon: dotIcon(PIN), title: p.label, optimized: true });
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

  const clusterMarkers = new Set();
  const clusterer = new MarkerClusterer({
    map, markers,
    algorithm: new SuperClusterAlgorithm({ radius: 70, maxZoom: 16 }),
    renderer: {
      render({ count, position, markers: ms }) {
        const thumb = ms[0].__p.thumb, approx = ms.every((mk) => mk.__p.approx); // dashed only when nothing in it is exact
        const m = new google.maps.Marker({ position, icon: cachedIcon(thumb, CLUSTER, count, approx) ?? dotIcon(CLUSTER), zIndex: 1000 + count, optimized: true });
        m.__thumb = thumb; m.__count = count; m.__approx = approx;
        if (cachedIcon(thumb, CLUSTER, count, approx)) m.__iconKey = `${thumb}|${CLUSTER}|${count}|${approx ? 1 : 0}|${isDark()}`; else wantIcon(m, thumb, CLUSTER, count, approx);
        clusterMarkers.add(m);
        m.addListener("map_changed", () => { if (!m.getMap()) clusterMarkers.delete(m); });
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
  // Single markers get their thumbnail once they are actually on the map (the clusterer takes them off while clustered).
  // Clusters are asked again too: a thumbnail that failed to load the first time gets another chance.
  // Past the clusterer's maxZoom every marker is on the map; only the ones in view fetch their thumbnail.
  // The clusterer itself (re)places markers on its own idle handler, so the pass runs again when it is done.
  function refreshIcons() {
    const b = map.getBounds();
    const inView = (m) => m.getMap() && (!b || b.contains(m.getPosition()));
    for (const m of markers) if (inView(m)) wantIcon(m, m.__p.thumb, PIN, undefined, m.__p.approx);
    for (const m of clusterMarkers) if (inView(m)) wantIcon(m, m.__thumb, CLUSTER, m.__count, m.__approx);
    warm();
  }
  map.addListener("idle", refreshIcons);
  google.maps.event.addListener(clusterer, "clusteringend", refreshIcons);

  function showStrip(ps, title) {
    panelTitle.textContent = title;
    panelTitle.title = ps.every((p) => p.approx) ? "Approximate: placed at the series' location" : "";
    panelTitle.dataset.approx = ps.every((p) => p.approx) ? "1" : "";
    strip.replaceChildren(...ps.map((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      // The header already says where; under each photo goes the series (or the month for map-only photos),
      // or the place when the header is the series.
      const cap = p.caption === title ? p.label : p.caption || p.label;
      b.style.setProperty("--r", (p.w / p.h).toFixed(4));
      b.innerHTML = `<img src="${p.thumb}" width="${p.w}" height="${p.h}" alt="${p.label}" loading="lazy" decoding="async"><span>${cap}</span>`;
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
  if (import.meta.env.DEV) Object.assign(window, { __pmap: map, __pmapDebug: { ready, thumbs, iconCache, markers, clusterMarkers } }); // dev only: lets us drive the map from the console
}

document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => { instance = null; });
