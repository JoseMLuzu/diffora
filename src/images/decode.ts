import sharp from "sharp";
import type { ImagePreviewData } from "../core/models.js";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|tiff?)$/i.test(path);
}
export async function decodeImage(
  data: Buffer,
  signal?: AbortSignal,
): Promise<ImagePreviewData> {
  signal?.throwIfAborted();
  if (data.length > MAX_IMAGE_BYTES)
    throw new Error("La imagen supera el límite de 10 MiB.");
  const png = data
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const gif = /^GIF8[79]a$/.test(data.subarray(0, 6).toString("ascii"));
  const webp =
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP";
  const tiff =
    data.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) ||
    data.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]));
  const avif =
    data.subarray(4, 8).toString("ascii") === "ftyp" &&
    /avif|avis/.test(data.subarray(8, 128).toString("ascii"));
  if (!png && !jpeg && !gif && !webp && !tiff && !avif)
    throw new Error(
      "El contenido no es una imagen compatible (PNG, JPEG, WebP, GIF, TIFF o AVIF).",
    );
  const options = {
    limitInputPixels: MAX_IMAGE_PIXELS,
    animated: false,
    failOn: "error" as const,
  };
  const metadata = await sharp(data, options).metadata();
  if (!metadata.width || !metadata.height)
    throw new Error("No se pudieron leer las dimensiones de la imagen.");
  if (
    !["png", "jpeg", "webp", "gif", "tiff", "heif"].includes(
      metadata.format ?? "",
    )
  )
    throw new Error("Formato de imagen no compatible.");
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS)
    throw new Error("La imagen supera el límite de 16 megapíxeles.");
  signal?.throwIfAborted();
  const pipeline = sharp(data, options)
    .rotate()
    .resize({
      width: 160,
      height: 160,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .timeout({ seconds: 5 });
  const abort = () => pipeline.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const { data: pixels, info } = await pipeline.toBuffer({
      resolveWithObject: true,
    });
    signal?.throwIfAborted();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format!,
      bytes: data.length,
      previewWidth: info.width,
      previewHeight: info.height,
      pixels,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
