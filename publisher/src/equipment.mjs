// Keep each camera with the lenses actually used with it in the photographs' EXIF.
export function gearOf(items, names = {}) {
  const pretty = (raw) => {
    const clean = raw.replace(/@\d+(?:\.\d+)?$/, "").trim();
    return names[raw] ?? names[clean] ?? clean;
  };
  const cameras = new Map();
  for (const { exif } of items) {
    if (!exif?.camera) continue;
    const camera = pretty(exif.camera);
    if (!cameras.has(camera)) cameras.set(camera, { count: 0, lenses: new Map() });
    const group = cameras.get(camera);
    group.count++;
    // Fixed drone/phone focal-length descriptions do not add useful lens names.
    if (exif.lens && !/^\d+(\.\d+)? ?mm\b/i.test(exif.lens)) {
      const lens = pretty(exif.lens);
      group.lenses.set(lens, (group.lenses.get(lens) ?? 0) + 1);
    }
  }
  return [...cameras].sort((a, b) => b[1].count - a[1].count).map(([camera, group]) => {
    const lenses = [...group.lenses].sort((a, b) => b[1] - a[1]).map(([lens]) => lens);
    return lenses.length ? `${camera} · ${lenses.join(", ")}` : camera;
  });
}
