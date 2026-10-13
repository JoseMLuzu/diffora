import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedContent,
  parseDiff,
  safeText,
  MAX_DIFF_LINES,
} from "../src/core/diff.js";
import { parseNames } from "../src/git/repository.js";
test("parsea bloques, números anteriores/nuevos y marcadores sin newline", () => {
  const diff = parseDiff(
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2,2 +2,3 @@ fn\n igual\n-viejo\n+nuevo\n+extra\n\\ No newline at end of file\n@@ -10 +11 @@\n-fin\n+FIN\n",
  );
  assert.deepEqual(
    diff.lines
      .filter((l) => ["context", "add", "delete"].includes(l.kind))
      .map((l) => [l.kind, l.old, l.new]),
    [
      ["context", 2, 2],
      ["delete", 3, undefined],
      ["add", undefined, 3],
      ["add", undefined, 4],
      ["delete", 10, undefined],
      ["add", undefined, 11],
    ],
  );
});
test("no confunde contenido +++ con cabecera", () => {
  assert.equal(
    parseDiff("@@ -0,0 +1 @@\n+++contenido\n").lines[1]?.kind,
    "add",
  );
});
test("binarios y límites", () => {
  assert.equal(parseDiff("Binary files a/a and b/a differ").binary, true);
  assert.equal(addedContent(Buffer.from([0, 1]), false).binary, true);
  assert.equal(parseDiff("x\n".repeat(MAX_DIFF_LINES + 1)).truncated, true);
  assert.equal(parseDiff("", true).truncated, true);
});
test("neutraliza ANSI, OSC, controles, bidi y tabs", () => {
  const safe = safeText("\x1b[31m\x1b]52;secret\x07\r\t\u202e");
  assert.equal(/[\x00-\x1f\x7f-\x9f\u202e]/.test(safe), false);
});
test("contenido nuevo con y sin newline", () => {
  assert.equal(addedContent(Buffer.from("a\nb\n"), false).lines.length, 3);
  assert.equal(addedContent(Buffer.from(""), false).lines.length, 1);
  assert.equal(addedContent(Buffer.from("a"), false).lines[1]?.new, 1);
});
test("nombres NUL: espacios, saltos de línea y renombres", () => {
  assert.deepEqual(parseNames("M\0a b\0R100\0old\nname\0new name\0D\0gone\0"), [
    { status: "M", path: "a b" },
    { status: "R100", oldPath: "old\nname", path: "new name" },
    { status: "D", path: "gone" },
  ]);
});
