// EXIF of an original on disk, reduced to what the site publishes: capture time, coordinates when the camera
// wrote any, and the camera/lens/exposure line. Nothing else leaves the file.
import exifr from "exifr";
import { exifOf, isoFromExif } from "./sources/onsite.mjs";

export async function describe(file) {
  const ex = (await readExif(file)) ?? {};
  const taken = ex.DateTimeOriginal instanceof Date && !Number.isNaN(+ex.DateTimeOriginal)
    ? wallClock(ex.DateTimeOriginal) : ex.DateTimeOriginal ? isoFromExif(ex.DateTimeOriginal) : null;
  // (0, 0) is what some devices write for "no fix".
  const geo = Number.isFinite(ex.latitude) && Number.isFinite(ex.longitude) && (ex.latitude || ex.longitude)
    ? { lat: +ex.latitude.toFixed(5), lng: +ex.longitude.toFixed(5), precision: "exact" } : null;
  // Small sensors (drones, phones) are quoted by their 35 mm equivalent; larger ones by the lens' own focal length.
  const focalLength = ex.FocalLengthIn35mmFormat > (ex.FocalLength ?? 0) ? ex.FocalLengthIn35mmFormat : ex.FocalLength;
  return {
    taken, geo,
    exif: exifOf({ make: ex.Make, model: ex.Model, lens: ex.LensModel, focalLength, fNumber: ex.FNumber, exposureTime: ex.ExposureTime, iso: ex.ISO }, taken),
  };
}

async function readExif(file) {
  try {
    // The *Ref tags must be picked too, or exifr returns western/southern coordinates without their sign.
    return await exifr.parse(file, { pick: ["DateTimeOriginal", "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength", "FocalLengthIn35mmFormat", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"], gps: true });
  } catch { return null; }
}

// EXIF timestamps carry no zone; exifr builds a Date from the digits in this machine's zone. Read the same
// digits back as local time, so "2025:05:12 10:37:02" stays 10:37 wherever the import runs.
const pad = (n) => String(n).padStart(2, "0");
const wallClock = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
