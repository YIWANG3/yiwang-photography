// Two languages, one set of pages. Both texts are in the HTML; <html data-lang> (chosen with the switch, else
// the browser's language) picks which one shows, so no URL changes and no reload. Series titles and places come
// translated from the manifest (galleries.yaml `zh:`), the interface strings from here. Build and browser share it.
export const ui = {
  en: {
    htmlLang: "en",
    lbPrevious: "Previous", lbNext: "Next", lbClose: "Close", lbZoomIn: "Zoom in", lbResetZoom: "Reset zoom",
    photographs: (n) => `${n} photographs`,
    approx: "approx.",
    approxTitle: "Approximate: placed at the series' location",
  },
  zh: {
    htmlLang: "zh-Hans",
    lbPrevious: "上一张", lbNext: "下一张", lbClose: "关闭", lbZoomIn: "放大", lbResetZoom: "还原",
    photographs: (n) => `${n} 张照片`,
    approx: "大致位置",
    approxTitle: "大致位置：标在该系列的拍摄地，不是照片的 GPS",
  },
};

// The language the page is showing, for scripts: <html data-lang>, set before paint by the layout.
export const pageLang = () => (typeof document !== "undefined" && document.documentElement.dataset.lang === "zh" ? "zh" : "en");
export const t = (lang = pageLang()) => ui[lang] ?? ui.en;

// A series' title/place/description in a language, falling back to the English field.
export const tr = (g, field, lang) => (lang === "zh" && g.zh?.[field]) || g[field] || "";

// A photo's place: the series' place stands in for most photos, so it is translated with the series.
export const placeOf = (it, g, lang) => (it.place && it.place === g.place ? tr(g, "place", lang) : it.place);

// In the browser: the field of a point/item in the page's language (`x` or `x_zh`).
export const pick = (o, field) => (pageLang() === "zh" && o[`${field}_zh`]) || o[field];
