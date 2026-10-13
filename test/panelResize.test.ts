import { test } from "node:test";
import assert from "node:assert/strict";
import { panelWidths, parseMouse, resizePanels } from "../src/ui/panelResize.js";

test("cada borde mueve sus dos paneles vecinos y respeta mínimos", () => {
  const widths = panelWidths(140, [0.28, 0.25, 0.47]);
  assert.deepEqual(widths, [39, 35, 66]);
  assert.deepEqual(resizePanels(widths, 0, 10), [49, 25, 66]);
  assert.deepEqual(resizePanels(widths, 1, -10), [39, 25, 76]);
  assert.deepEqual(resizePanels(widths, 0, 1000), [54, 20, 66]);
  assert.deepEqual(resizePanels(widths, 1, -1000), [39, 20, 81]);
  assert.deepEqual(widths, [39, 35, 66]);
});

test("los tamaños se conservan y se adaptan a la ventana sin perder columnas", () => {
  const dragged = resizePanels([39, 35, 66], 0, 15);
  const proportions = dragged.map((width) => width / 140) as [number, number, number];
  assert.deepEqual(panelWidths(140, proportions), dragged);
  for (const columns of [110, 140, 180, 500]) {
    const widths = panelWidths(columns, proportions);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), columns);
    assert.ok(widths.every((width) => width >= 20));
  }
});

test("mouse SGR distingue presión, arrastre y liberación con y sin Escape", () => {
  assert.deepEqual(parseMouse("\x1b[<0;39;5M"), { button: 0, x: 39, y: 5, release: false });
  assert.deepEqual(parseMouse("[<32;49;5M"), { button: 32, x: 49, y: 5, release: false });
  assert.deepEqual(parseMouse("[<0;49;5m"), { button: 0, x: 49, y: 5, release: true });
  for (const input of ["q", "[A", "[<0;39;", "file.txt"]) assert.equal(parseMouse(input), null);
});
