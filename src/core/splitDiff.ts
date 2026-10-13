import type { DiffLine } from "./models.js";

export interface SplitRow {
  before?: DiffLine;
  after?: DiffLine;
  shared?: DiffLine;
  /** Original unified indexes, so toggling layouts keeps the reading position. */
  sourceIndices: number[];
}

/** Pair removals/additions within one change block, never across hunk boundaries. */
export function splitDiff(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === "add" || line.kind === "delete") {
      const before: { line: DiffLine; index: number }[] = [];
      const after: { line: DiffLine; index: number }[] = [];
      const notices: SplitRow[] = [];
      while (index < lines.length) {
        const changed = lines[index]!;
        if (changed.kind === "delete") before.push({ line: changed, index });
        else if (changed.kind === "add") after.push({ line: changed, index });
        else if (changed.kind === "meta" && changed.text.startsWith("\\ No newline"))
          notices.push({ shared: changed, sourceIndices: [index] });
        else break;
        index++;
      }
      for (let n = 0; n < Math.max(before.length, after.length); n++) {
        const old = before[n];
        const next = after[n];
        rows.push({
          ...(old ? { before: old.line } : {}),
          ...(next ? { after: next.line } : {}),
          sourceIndices: [old?.index, next?.index].filter((i): i is number => i !== undefined),
        });
      }
      rows.push(...notices);
    } else {
      rows.push(line.kind === "context"
        ? { before: line, after: line, sourceIndices: [index] }
        : { shared: line, sourceIndices: [index] });
      index++;
    }
  }
  return rows;
}

/** Codepoint offsets of the changed middle; a bounded linear comparison. */
export function changedSpans(before: string, after: string) {
  const old = Array.from(before);
  const next = Array.from(after);
  let start = 0;
  while (start < Math.min(old.length, next.length) && old[start] === next[start]) start++;
  let suffix = 0;
  while (suffix < Math.min(old.length, next.length) - start
    && old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  return {
    before: { start, end: old.length - suffix },
    after: { start, end: next.length - suffix },
  };
}
