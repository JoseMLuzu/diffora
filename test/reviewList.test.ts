import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { spawnSync } from "node:child_process";
import stringWidth from "string-width";
import { ReviewList, visibleListRows } from "../src/ui/ReviewList.js";

test("el separador ocupa una fila sin cambiar la selección de commits", () => {
  const items = [
    { label: "↑ local", highlighted: true, reviewStatus: "unreviewed" as const },
    { label: "remote", separatorBefore: "Publicados", reviewStatus: "reviewed" as const },
    { label: "older" },
  ];
  const output = stripVTControlCharacters(renderToString(createElement(ReviewList, {
    items, index: 1, width: 30, rows: 3, empty: "Vacío",
  }), { columns: 30 }));
  assert.match(output, /↑ local\n--- Publicados -+\n› ● remote/);
  assert.equal(output.split("\n").length, 3);
  assert.deepEqual(visibleListRows(items, 1, 1), [{ item: items[1], index: 1 }]);
  assert.deepEqual(visibleListRows(items, 2, 2), [{ item: items[1], index: 1 }, { item: items[2], index: 2 }]);
});

test("el punto de revisión no sustituye el estado Git ni la selección", () => {
  const output = stripVTControlCharacters(renderToString(createElement(ReviewList, {
    items: [{ label: "M src/alpha.ts", reviewStatus: "reviewed" }, { label: "A README.md", reviewStatus: "unreviewed" }],
    index: 0, width: 30, rows: 2, empty: "Vacío",
  }), { columns: 30 }));
  assert.match(output, /› ● M src\/alpha.ts/);
  assert.match(output, /· A README.md/);
});

test("el punto verde permanece verde aunque la fila esté seleccionada", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import {createElement} from 'react';
    import {renderToString} from 'ink';
    import {ReviewList} from './src/ui/ReviewList.tsx';
    process.stdout.write(renderToString(createElement(ReviewList, {
      items: [{label:'M file.ts',reviewStatus:'reviewed'}],index:0,width:30,rows:1,empty:'Vacío'
    }), {columns:30}));
  `], { cwd: new URL("..", import.meta.url), env: { ...process.env, FORCE_COLOR: "1" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\u001b\[32m(?:\u001b\[[\d;]+m)*●/);
});

test("categorías sin marca y filas estrechas conservan su espacio y recorte", () => {
  for (const width of [8, 20, 40]) {
    const output = stripVTControlCharacters(renderToString(createElement(ReviewList, {
      items: [{ label: "Sin preparar (12)" }, { label: "R100 old.ts → very-long-new-file-name.ts", reviewStatus: "reviewed" }],
      index: 1, width, rows: 2, empty: "Vacío",
    }), { columns: width }));
    assert.ok(output.split("\n").every((line) => stringWidth(line) <= width), output);
    assert.match(output, /●/);
  }
});

test("naranja usa RGB ámbar incluso seleccionado y conserva la letra M", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import {createElement} from 'react';
    import {renderToString} from 'ink';
    import {ReviewList} from './src/ui/ReviewList.tsx';
    process.stdout.write(renderToString(createElement(ReviewList, {
      items: [{label:'M file.ts',reviewStatus:'needs-review'}],index:0,width:30,rows:1,empty:'Vacío'
    }), {columns:30}));
  `], { cwd: new URL("..", import.meta.url), env: { ...process.env, FORCE_COLOR: "3" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\u001b\[38;2;255;158;69m(?:\u001b\[[\d;]+m)*●/);
  assert.match(stripVTControlCharacters(result.stdout), /› ● M file.ts/);
});
