// The browser's half of a photo (Phase 7, §5, §6, §28): the picked file is
// decoded upright (its EXIF turn applied), drawn on a canvas at the size
// mediaLogic gives and made a JPEG. Plain DOM, no Supabase: the upload itself
// is the web app's (FleetContext `files`).
import { type DrawBox, DOC_PX, fitLongSide, JPEG_QUALITY, LICENCE_PX, PROFILE_PX, squareCrop, THUMB_PX, VEHICLE_PX } from "./mediaLogic";

interface Decoded {
  img: CanvasImageSource;
  w: number;
  h: number;
  close: () => void;
}

const UNREADABLE = { code: "bad_photo", message: "This photo can't be read here. Choose a JPEG or PNG photo." };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { img: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      /* an <img> may still read it */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw UNREADABLE;
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function draw(src: Decoded, box: DrawBox): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = box.w;
  canvas.height = box.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(UNREADABLE);
  // A PNG's transparent parts turn white in the JPEG, not black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, box.w, box.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.img, box.sx, box.sy, box.sw, box.sh, 0, 0, box.w, box.h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(UNREADABLE)), "image/jpeg", JPEG_QUALITY));
}

async function withDecoded<T>(file: Blob, fn: (src: Decoded) => Promise<T>): Promise<T> {
  const src = await decode(file);
  try {
    if (!src.w || !src.h) throw UNREADABLE;
    return await fn(src);
  } finally {
    src.close();
  }
}

/** A driver's profile photo: the centred square at 512 × 512. */
export function profilePhoto(file: Blob): Promise<Blob> {
  return withDecoded(file, (src) => draw(src, squareCrop(src.w, src.h, PROFILE_PX)));
}

/** A vehicle's photo at 1600 px on the long side and its thumbnail at 256 px. */
export function vehiclePhoto(file: Blob): Promise<{ photo: Blob; thumb: Blob }> {
  return withDecoded(file, async (src) => ({
    photo: await draw(src, fitLongSide(src.w, src.h, VEHICLE_PX)),
    thumb: await draw(src, fitLongSide(src.w, src.h, THUMB_PX)),
  }));
}

/** A document photo at 2000 px on the long side, so the text stays readable. */
export function documentPhoto(file: Blob): Promise<Blob> {
  return withDecoded(file, (src) => draw(src, fitLongSide(src.w, src.h, DOC_PX)));
}

/** A photo of a driving licence (Part 3b) at 1600 px on the long side. */
export function licencePhoto(file: Blob): Promise<Blob> {
  return withDecoded(file, (src) => draw(src, fitLongSide(src.w, src.h, LICENCE_PX)));
}
