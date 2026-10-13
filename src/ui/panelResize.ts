export type PanelWidths = [number, number, number];
export const ENABLE_MOUSE = "\x1b[?1002h\x1b[?1006h";
export const DISABLE_MOUSE = "\x1b[?1002l\x1b[?1006l";
const MIN_PANEL_WIDTH = 20;

export function panelWidths(columns: number, proportions: PanelWidths): PanelWidths {
  const left = Math.max(MIN_PANEL_WIDTH, Math.min(Math.round(columns * proportions[0]), columns - MIN_PANEL_WIDTH * 2));
  const files = Math.max(MIN_PANEL_WIDTH, Math.min(Math.round(columns * proportions[1]), columns - left - MIN_PANEL_WIDTH));
  return [left, files, columns - left - files];
}

/** Resize the two panels bordering the grabbed edge; leave the third alone. */
export function resizePanels(widths: PanelWidths, boundary: 0 | 1, delta: number): PanelWidths {
  const next: PanelWidths = [...widths];
  const change = Math.max(MIN_PANEL_WIDTH - widths[boundary],
    Math.min(Math.round(delta), widths[boundary + 1]! - MIN_PANEL_WIDTH));
  next[boundary] += change;
  next[boundary + 1] = widths[boundary + 1]! - change;
  return next;
}

export function parseMouse(input: string): { button: number; x: number; y: number; release: boolean } | null {
  // Ink removes the leading Escape from unrecognised CSI sequences.
  const match = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
  if (!match) return null;
  return { button: Number(match[1]), x: Number(match[2]), y: Number(match[3]), release: match[4] === "m" };
}
