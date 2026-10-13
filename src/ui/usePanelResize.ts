import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";
import { DISABLE_MOUSE, ENABLE_MOUSE, panelWidths, parseMouse, resizePanels, type PanelWidths } from "./panelResize.js";

export function usePanelResize(columns: number, height: number, enabled: boolean) {
  const { stdout } = useStdout();
  const [proportions, setProportions] = useState<PanelWidths>([0.28, 0.25, 0.47]);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ boundary: 0 | 1; x: number; widths: PanelWidths } | null>(null);
  const widths = panelWidths(Math.max(60, columns), proportions);
  useEffect(() => {
    drag.current = null;
    setResizing(false);
    if (!enabled || !stdout.isTTY) return;
    stdout.write(ENABLE_MOUSE);
    return () => { stdout.write(DISABLE_MOUSE); };
  }, [stdout, enabled, columns, height]);

  const handleMouse = (input: string): boolean => {
    const mouse = parseMouse(input);
    if (!mouse) return false;
    // Consume mouse events even in text fields or overlays.
    if (!enabled) return true;
    const leftButton = (mouse.button & 3) === 0 && (mouse.button & 64) === 0;
    if (mouse.release) {
      if (leftButton && drag.current) {
        const next = resizePanels(drag.current.widths, drag.current.boundary, mouse.x - drag.current.x);
        setProportions(next.map((width) => width / columns) as PanelWidths);
        drag.current = null;
        setResizing(false);
      }
      return true;
    }
    if (!leftButton) return true;
    if ((mouse.button & 32) === 0) {
      drag.current = null;
      setResizing(false);
      if (mouse.y < 2 || mouse.y > height + 1) return true;
      const boundary = [widths[0], widths[0] + widths[1]].findIndex((x) => mouse.x === x || mouse.x === x + 1);
      if (boundary !== -1) {
        drag.current = { boundary: boundary as 0 | 1, x: mouse.x, widths };
        setResizing(true);
      }
    } else if (drag.current) {
      const next = resizePanels(drag.current.widths, drag.current.boundary, mouse.x - drag.current.x);
      setProportions(next.map((width) => width / columns) as PanelWidths);
    }
    return true;
  };
  return { widths, resizing, handleMouse };
}
