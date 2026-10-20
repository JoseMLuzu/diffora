import type { Diff, DiffLine } from "./models.js";
import { tr } from "./i18n.js";
// Replace controls visibly; never allow file contents to issue terminal commands.
export function safeText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, (c) =>
    c === "\t" ? "    " : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
export const MAX_DIFF_LINES = 10_000;
export function parseDiff(patch: string, truncated = false): Diff {
  const lines: DiffLine[] = [];
  let old = 0,
    next = 0,
    inHunk = false,
    binary = false;
  for (const raw of patch.split("\n")) {
    if (lines.length >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: "header", text: safeText(raw) });
    } else if (raw.startsWith("diff --git ")) {
      inHunk = false;
      lines.push({ kind: "meta", text: safeText(raw) });
    } else if (/^(Binary files |GIT binary patch)/.test(raw)) {
      binary = true;
      lines.push({
        kind: "meta",
        text: tr("Archivo binario: diferencia no disponible como texto.", "Binary file: diff unavailable as text."),
      });
    } else if (inHunk && raw.startsWith("+"))
      lines.push({ kind: "add", text: safeText(raw.slice(1)), new: next++ });
    else if (inHunk && raw.startsWith("-"))
      lines.push({ kind: "delete", text: safeText(raw.slice(1)), old: old++ });
    else if (inHunk && raw.startsWith(" "))
      lines.push({
        kind: "context",
        text: safeText(raw.slice(1)),
        old: old++,
        new: next++,
      });
    else if (raw) lines.push({ kind: "meta", text: safeText(raw) });
  }
  return { lines, binary, truncated };
}
export function addedContent(content: Buffer, truncated: boolean): Diff {
  if (content.subarray(0, 8000).includes(0))
    return {
      lines: [
        {
          kind: "meta",
          text: tr("Archivo binario: contenido no disponible como texto.", "Binary file: content unavailable as text."),
        },
      ],
      binary: true,
      truncated,
    };
  const text = content.toString("utf8");
  const rows = text.split("\n");
  if (rows.at(-1) === "") rows.pop();
  return {
    binary: false,
    truncated: truncated || rows.length > MAX_DIFF_LINES,
    lines: [
      {
        kind: "header",
        text: `@@ -0,0 +1,${rows.length} @@ ${tr("(sin seguimiento)", "(untracked)")}`,
      },
      ...rows.slice(0, MAX_DIFF_LINES).map((row, i): DiffLine => ({
        kind: "add",
        text: safeText(row),
        new: i + 1,
      })),
    ],
  };
}
