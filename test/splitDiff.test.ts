import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { spawnSync } from "node:child_process";
import stringWidth from "string-width";
import { parseDiff, addedContent } from "../src/core/diff.js";
import { splitDiff, changedSpans } from "../src/core/splitDiff.js";
import { TextDiff } from "../src/ui/TextDiff.js";
import { reducer, initialState, diffKey, filesKey, diffRowCount, diffPageSize, isSplitDiff } from "../src/application/state.js";
import type { Diff, DiffLine } from "../src/core/models.js";

const patch = "@@ -10,4 +20,5 @@\n context\n-old A\n-old B\n+new A\n+new B\n+new C\n final";
const diff = parseDiff(patch);

test("vista paralela alinea cambios desiguales y conserva números de ambos lados", () => {
  const rows = splitDiff(diff.lines);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1]?.before, { kind: "context", text: "context", old: 10, new: 20 });
  assert.equal(rows[1]?.after, rows[1]?.before);
  assert.equal(rows[2]?.before?.old, 11);
  assert.equal(rows[2]?.after?.new, 21);
  assert.equal(rows[4]?.before, undefined);
  assert.equal(rows[4]?.after?.new, 23);
  assert.equal(rows[5]?.before?.old, 13);
  assert.equal(rows[5]?.after?.new, 24);
  assert.deepEqual(rows.flatMap((r) => r.sourceIndices).sort((a, b) => a - b), diff.lines.map((_, i) => i));
});

test("no empareja cambios de hunks diferentes ni pierde avisos de ausencia de salto de línea", () => {
  const lines = parseDiff("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n@@ -4,1 +4,0 @@\n-gone").lines;
  const rows = splitDiff(lines);
  assert.equal(rows[1]?.before?.text, "old");
  assert.equal(rows[1]?.after?.text, "new");
  assert.equal(rows.filter((r) => r.shared?.text.startsWith("\\ No newline")).length, 2);
  assert.equal(rows.at(-1)?.before?.text, "gone");
  assert.equal(rows.at(-1)?.after, undefined);
  assert.deepEqual(rows.flatMap((r) => r.sourceIndices).sort((a, b) => a - b), lines.map((_, i) => i));
});

test("archivos nuevos, eliminados, líneas vacías, metadatos y binarios siguen disponibles", () => {
  const added = splitDiff(addedContent(Buffer.from("one\n\ntwo"), false).lines);
  assert.ok(added.filter((r) => r.after).every((r) => !r.before));
  assert.ok(added.some((r) => r.after?.text === ""));
  const deleted = splitDiff(parseDiff("@@ -1,2 +0,0 @@\n-one\n-").lines);
  assert.equal(deleted.at(-1)?.before?.text, "");
  const binary = parseDiff("diff --git a/p.png b/p.png\nBinary files a/p.png and b/p.png differ");
  assert.deepEqual(splitDiff(binary.lines).map((r) => r.shared), binary.lines);
});

test("énfasis usa caracteres completos y no marca prefijos o sufijos iguales", () => {
  assert.deepEqual(changedSpans("😀 old final", "😀 new final"), { before: { start: 2, end: 5 }, after: { start: 2, end: 5 } });
  assert.deepEqual(changedSpans("same", "same"), { before: { start: 4, end: 4 }, after: { start: 4, end: 4 } });
  assert.deepEqual(changedSpans("", "x"), { before: { start: 0, end: 0 }, after: { start: 0, end: 1 } });
});

function loaded() {
  const lines: DiffLine[] = [
    { kind: "header", text: "@@ -1,17 +1,17 @@" },
    ...Array.from({ length: 15 }, (_, i): DiffLine => ({ kind: "delete", text: `old ${i}`, old: i + 1 })),
    ...Array.from({ length: 15 }, (_, i): DiffLine => ({ kind: "add", text: `new ${i}`, new: i + 1 })),
    { kind: "context", text: "last", old: 16, new: 16 },
    { kind: "context", text: "end", old: 17, new: 17 },
  ];
  let state = reducer(initialState, { type: "mode", mode: "pending" });
  state = reducer(state, { type: "files", key: filesKey(state), files: [{ path: "a.ts", status: "M" }] });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines, binary: false, truncated: false } });
  return reducer(state, { type: "panel", panel: 2 });
}

test("alternar conserva el bloque visible, las marcas y la identidad de consulta", () => {
  let state = loaded();
  state = reducer(state, { type: "review-needs-toggle" });
  state = reducer(state, { type: "move", delta: 4, pageSize: 4 });
  const key = diffKey(state);
  const marks = state.needsReview;
  state = reducer(state, { type: "diff-layout-toggle", rows: 4 });
  assert.equal(isSplitDiff(state), true);
  assert.equal(state.scroll, 4);
  assert.equal(diffRowCount(state), 18);
  assert.equal(diffPageSize(state, 4), 3);
  assert.equal(diffKey(state), key);
  assert.equal(state.needsReview, marks);
  state = reducer(state, { type: "diff-layout-toggle", rows: 4 });
  assert.equal(state.scroll, 4);
  assert.equal(state.diffLayout, "unified");
});

test("scroll paralelo se limita a filas emparejadas y mantiene contexto al redimensionar", () => {
  let state = reducer(loaded(), { type: "diff-layout-toggle", rows: 4 });
  state = reducer(state, { type: "move", delta: 100, pageSize: 3 });
  assert.equal(state.scroll, 15);
  state = reducer(state, { type: "diff-viewport", columns: 40, rows: 4 });
  assert.equal(isSplitDiff(state), false);
  assert.equal(state.diffLayout, "split");
  assert.equal(state.scroll, 15);
  assert.equal(diffRowCount(state), 33);
  state = reducer(state, { type: "diff-viewport", columns: 140, rows: 4 });
  assert.equal(isSplitDiff(state), true);
  assert.equal(state.scroll, 15);
  state = reducer(state, { type: "diff-viewport", columns: 140, rows: 100 });
  assert.equal(state.scroll, 0);
});

test("preferencia paralela sobrevive a navegación; s no afecta a listas ni imágenes", () => {
  let state = reducer(loaded(), { type: "diff-layout-toggle", rows: 10 });
  state = reducer(state, { type: "panel", panel: 1 });
  assert.equal(reducer(state, { type: "diff-layout-toggle", rows: 10 }), state);
  state = reducer(state, { type: "refresh" });
  assert.equal(state.diffLayout, "split");
  const image: Diff = { lines: [], binary: true, truncated: false, image: { beforeNotice: "", afterNotice: "" } };
  const withImage = { ...loaded(), diff: image };
  assert.equal(reducer(withImage, { type: "diff-layout-toggle", rows: 10 }), withImage);
  assert.equal(isSplitDiff({ ...withImage, diffLayout: "split" }), false);
  assert.equal(diffPageSize({ ...withImage, diffLayout: "split" }, 10), 10);
});

test("cabeceras, lados vacíos y números reales aparecen en la interfaz", () => {
  const output = stripVTControlCharacters(renderToString(createElement(TextDiff, {
    lines: diff.lines, width: 90, rows: 10, scroll: 0, split: true,
  }), { columns: 90 }));
  assert.match(output, /Anterior \(−\).*Nueva \(\+\)/);
  assert.match(output, /11 - old A.*21 \+ new A/);
  const extra = output.split("\n").find((l) => l.includes("new C"))!;
  assert.match(extra, /^\s+│\s+23 \+ new C/);
});

test("columnas largas y Unicode se recortan sin desbordar ni partir caracteres", () => {
  const lines = parseDiff("@@ -1 +1 @@\n-" + "😀漢字 old ".repeat(20) + "\n+" + "😀漢字 new ".repeat(20)).lines;
  for (const width of [38, 78, 138]) {
    const output = stripVTControlCharacters(renderToString(createElement(TextDiff, {
      lines, width, rows: 10, scroll: 0, split: true,
    }), { columns: width }));
    assert.ok(output.split("\n").every((line) => stringWidth(line) <= width), output);
    assert.match(output, /…/);
    assert.doesNotMatch(output, /[\uD800-\uDFFF](?![\uD800-\uDFFF])/u);
  }
});

test("vista unificada y aviso de ventana estrecha siguen legibles", () => {
  const output = stripVTControlCharacters(renderToString(createElement(TextDiff, {
    lines: diff.lines, width: 38, rows: 4, scroll: 2, split: false, fallback: true,
  }), { columns: 38 }));
  assert.match(output, /Amplía a 80 columnas/);
  assert.match(output, /11\s+- old A/);
  assert.ok(output.split("\n").length <= 5);
});

test("la interfaz neutraliza controles incluso en vista paralela", () => {
  const output = stripVTControlCharacters(renderToString(createElement(TextDiff, {
    lines: [{ kind: "add", new: 1, text: "\u001b[2J\u001b]0;unsafe\u0007text" }],
    width: 90, rows: 4, scroll: 0, split: true,
  }), { columns: 90 }));
  assert.match(output, /unsafe/);
  assert.doesNotMatch(output, /\u001b/);
  assert.ok(output.split("\n").every((line) => stringWidth(line) <= 90));
});

test("fondos rojo/verde y énfasis interno se renderizan como colores distintos", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import {createElement} from 'react';
    import {renderToString} from 'ink';
    import {TextDiff} from './src/ui/TextDiff.tsx';
    process.stdout.write(renderToString(createElement(TextDiff, {
      lines:[{kind:'delete',old:1,text:'const x = 1;'},{kind:'add',new:1,text:'const x = 2;'}],
      width:90,rows:4,scroll:0,split:true
    }), {columns:90}));
  `], { cwd: new URL("..", import.meta.url), env: { ...process.env, FORCE_COLOR: "3" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  for (const rgb of ["50;27;34", "24;51;38", "102;44;57", "36;87;59"])
    assert.ok(result.stdout.includes(`48;2;${rgb}m`), result.stdout);
});
