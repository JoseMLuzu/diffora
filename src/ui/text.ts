import stringWidth from "string-width";
import { safeText } from "../core/diff.js";
export function fit(text: string, width: number): string {
  const clean = safeText(text);
  if (width <= 0) return "";
  if (stringWidth(clean) <= width) return clean;
  let result = "";
  let used = 0;
  for (const char of clean) {
    const size = stringWidth(char);
    if (used + size > width - 1) break;
    result += char;
    used += size;
  }
  return result + "…";
}
