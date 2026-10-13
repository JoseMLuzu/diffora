import type { ImagePreviewData } from "../core/models.js";
export interface PixelSpan {
  text: string;
  foreground: string;
  background: string;
}
export function rasterRows(
  image: ImagePreviewData,
  columns: number,
  rows: number,
): PixelSpan[][] {
  const scale = Math.min(
    Math.min(120, Math.max(1, columns)) / image.previewWidth,
    Math.min(120, Math.max(1, rows) * 2) / image.previewHeight,
  );
  const width = Math.max(
    1,
    Math.min(120, Math.floor(image.previewWidth * scale)),
  );
  const height = Math.max(
    1,
    Math.min(120, Math.floor(image.previewHeight * scale)),
  );
  function pixel(x: number, y: number): string {
    const sx = Math.min(
      image.previewWidth - 1,
      Math.floor((x * image.previewWidth) / width),
    );
    const sy = Math.min(
      image.previewHeight - 1,
      Math.floor((Math.min(y, height - 1) * image.previewHeight) / height),
    );
    const index = (sy * image.previewWidth + sx) * 4;
    const alpha = (image.pixels[index + 3] ?? 255) / 255;
    const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 56 : 32;
    return (
      "#" +
      [0, 1, 2]
        .map((c) =>
          Math.round(
            (image.pixels[index + c] ?? 0) * alpha + checker * (1 - alpha),
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  const result: PixelSpan[][] = [];
  for (let y = 0; y < height; y += 2) {
    const spans: PixelSpan[] = [];
    for (let x = 0; x < width; x++) {
      const foreground = pixel(x, y),
        background = pixel(x, Math.min(y + 1, height - 1));
      const last = spans.at(-1);
      if (last?.foreground === foreground && last.background === background)
        last.text += "▀";
      else spans.push({ text: "▀", foreground, background });
    }
    result.push(spans);
  }
  return result;
}
