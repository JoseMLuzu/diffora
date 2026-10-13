import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, realpath, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import stringWidth from "string-width";
import { Repository } from "../src/git/repository.js";
import { MAX_FINGERPRINT_BYTES } from "../src/git/fingerprint.js";
import { MAX_DIFF_BYTES } from "../src/git/runner.js";
import { emptyProgress, identityKey, parseIdentity } from "../src/core/progress.js";
import { ProgressStore, validateProgress, MAX_PROGRESS_BYTES } from "../src/application/progressStore.js";
import { reducer, initialState, filesKey, diffKey, fileReviewStatus, visibleFiles, commitReviewStatus, type State } from "../src/application/state.js";
import { progressOf, reviewTasks, summary, editorLocation } from "../src/application/reviewWorkflow.js";
import { commandArgs, editorInvocation, openEditor } from "../src/application/editor.js";
import { reviewReport } from "../src/application/report.js";
import { WorkflowPanel } from "../src/ui/WorkflowPanel.js";
import { parseDiff } from "../src/core/diff.js";
import { pendingFingerprints } from "../src/application/useReview.js";

const digest = (letter = "a") => letter.repeat(64);
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "terminal-review-progress-")));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, "repo");
  const cache = join(temporary, "state");
  await mkdir(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Workflow Test");
  git(root, "config", "user.email", "workflow@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  return { root, cache, temporary, repo: await Repository.discover(root) };
}
function loaded(): State {
  let s = reducer(initialState, { type: "progress-loaded", progress: emptyProgress() });
  s = reducer(s, { type: "mode", mode: "pending" });
  const files = [{ path: "a.ts", status: "M" }, { path: "b.ts", status: "M" }, { path: "c.ts", status: "M" }];
  s = reducer(s, { type: "snapshot", revision: s.revision, commits: [], pending: { ...initialState.pending, unstaged: files } });
  s = reducer(s, { type: "files", key: filesKey(s), files });
  s = reducer(s, { type: "diff", key: diffKey(s), diff: parseDiff("@@ -1 +1 @@\n-old\n+new"), fingerprint: digest() });
  return reducer(s, { type: "panel", panel: 2 });
}

test("guarda y restaura verdes, naranjas, notas, vista y resumen de commit por repositorio", async (t) => {
  const { root, cache, temporary } = await fixture(t);
  const store = new ProgressStore(root, cache);
  assert.deepEqual(await store.load(), emptyProgress());
  const key = identityKey({ kind: "unstaged" }, { path: "a.ts", status: "M" });
  const commit = { hash: "abcdef", shortHash: "abcdef", title: "Fix", date: "2026-10-06", parents: [] };
  const committed = identityKey({ kind: "commit", commit }, { path: "b.ts", status: "A" });
  const progress = { ...emptyProgress(), reviewed: [committed], needsReview: [key], fingerprints: { [key]: digest(), [committed]: digest("b") },
    notes: { [key]: { text: "Revisar comportamiento en móvil", stale: false } },
    commitReviewKeys: { [commit.hash]: [committed] }, diffLayout: "split" as const };
  await store.save(progress);
  assert.deepEqual(await new ProgressStore(root, cache).load(), progress);
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  assert.equal((await stat(cache)).mode & 0o777, 0o700);
  await mkdir(join(temporary, "other"));
  const other = new ProgressStore(join(temporary, "other"), cache);
  assert.notEqual(other.file, store.file);
  assert.deepEqual(await other.load(), emptyProgress());
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("guardado atómico serializa cambios rápidos y no deja temporales", async (t) => {
  const { root, cache } = await fixture(t);
  const store = new ProgressStore(root, cache);
  const key = identityKey({ kind: "untracked" }, { path: "x.ts", status: "?" });
  await Promise.all([
    store.save({ ...emptyProgress(), reviewed: [key], fingerprints: { [key]: digest() } }),
    store.save({ ...emptyProgress(), needsReview: [key], fingerprints: { [key]: digest() } }),
  ]);
  assert.deepEqual((await store.load()).needsReview, [key]);
  assert.deepEqual((await readdir(cache)).filter((path) => path.endsWith(".tmp")), []);
  const before = (await stat(store.file)).mtimeMs;
  await store.save(await store.load());
  assert.equal((await stat(store.file)).mtimeMs, before, "No rewrite of identical progress");
});

test("cache corrupta, excesiva o de otro repo se conserva y no se sobrescribe", async (t) => {
  const { root, cache } = await fixture(t);
  await mkdir(cache);
  for (const content of ["not JSON", JSON.stringify({ version: 9 }), "x".repeat(MAX_PROGRESS_BYTES + 1)]) {
    const store = new ProgressStore(root, cache);
    await writeFile(store.file, content);
    await assert.rejects(store.load());
    await assert.rejects(store.save(emptyProgress()), /no guardado/);
    assert.equal(await readFile(store.file, "utf8"), content);
  }
  assert.throws(() => validateProgress({ version: 1, root: "other", ...emptyProgress() }, root), /repositorio/);
});

test("estado y exportación nunca escriben en el repo ni siguen un enlace simbólico de cache", async (t) => {
  const { root, cache, temporary } = await fixture(t);
  assert.throws(() => new ProgressStore(root, join(root, ".reviews")), /fuera/);
  await symlink(root, cache);
  const linked = new ProgressStore(root, cache);
  await assert.rejects(linked.save(emptyProgress()), /dentro/);
  await rm(cache);
  await mkdir(cache);
  const store = new ProgressStore(root, cache);
  const victim = join(temporary, "original.json");
  await writeFile(victim, "original");
  await symlink(victim, store.file);
  await assert.rejects(store.load());
  await assert.rejects(store.save(emptyProgress()));
  assert.equal(await readFile(victim, "utf8"), "original");
});

test("esquema valida identidades, límites y exclusión de marcas", () => {
  const key = identityKey({ kind: "unstaged" }, { path: "a", status: "M" });
  const value = { version: 1, root: "/repo", ...emptyProgress(), reviewed: [key], needsReview: [key] };
  assert.deepEqual(validateProgress(value, "/repo").reviewed, []);
  assert.throws(() => validateProgress({ ...value, notes: { [key]: { text: 5, stale: false } } }, "/repo"), /Nota/);
  assert.throws(() => validateProgress({ ...value, fingerprints: { [key]: "invalid" } }, "/repo"), /Huella/);
  assert.equal(parseIdentity(JSON.stringify(["shell", "", "x", "", "M"])), null);
  assert.equal(parseIdentity(JSON.stringify(["commit", "-option", "x", "", "A"])), null);
});
test("dos visores no sobrescriben silenciosamente el progreso del otro", async (t) => {
  const { root, cache } = await fixture(t);
  const first = new ProgressStore(root, cache);
  const second = new ProgressStore(root, cache);
  await first.load(); await second.load();
  const key = identityKey({ kind: "untracked" }, { path: "a", status: "?" });
  await first.save({ ...emptyProgress(), reviewed: [key], fingerprints: { [key]: digest() } });
  await assert.rejects(second.save({ ...emptyProgress(), needsReview: [key], fingerprints: { [key]: digest() } }), /Otra ventana/);
  assert.deepEqual((await new ProgressStore(root, cache).load()).reviewed, [key]);
  assert.ok(!(await readdir(cache)).some((file) => file.endsWith(".write-lock")));
});
test("una nota gris sin resolver sigue en la lista de tareas hasta marcar verde", () => {
  let s = reducer(loaded(), { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "Revisar" });
  s = reducer(s, { type: "note-save" });
  s = reducer(s, { type: "review-needs-toggle" });
  assert.equal(fileReviewStatus(s, s.files[0]!), "unreviewed");
  assert.equal(reviewTasks(s).length, 1);
  s = reducer(s, { type: "review-toggle" });
  assert.equal(reviewTasks(s).length, 0);
});

test("huellas detectan bytes fuera del diff truncado, binarios y no se invalidan solo por mtime", async (t) => {
  const { root, repo } = await fixture(t);
  const content = Buffer.alloc(MAX_DIFF_BYTES + 100, 97);
  await writeFile(join(root, "large.bin"), content);
  const file = { path: "large.bin", status: "?" };
  const before = await repo.fingerprint({ kind: "untracked" }, file);
  await utimes(join(root, file.path), new Date(), new Date());
  assert.equal(await repo.fingerprint({ kind: "untracked" }, file), before);
  content[content.length - 1] = 98;
  await writeFile(join(root, file.path), content);
  assert.notEqual(await repo.fingerprint({ kind: "untracked" }, file), before);
  assert.equal((await repo.diff({ kind: "untracked" }, file)).truncated, true);
});

test("huellas distinguen working tree, índice y baseline; Git e índice no se modifican", async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, "a"), "base\n");
  git(root, "add", "a"); git(root, "commit", "-m", "Base");
  const commit = await repo.commit((await repo.commits())[0]!.hash);
  assert.equal(commit.title, "Base");
  assert.deepEqual(commit.parents, []);
  const committed = await repo.fingerprint({ kind: "commit", commit }, { path: "a", status: "A" });
  await writeFile(join(root, "a"), "staged\n");
  git(root, "add", "a");
  await writeFile(join(root, "a"), "working\n");
  const file = { path: "a", status: "M" };
  const staged = await repo.fingerprint({ kind: "staged" }, file);
  const working = await repo.fingerprint({ kind: "unstaged" }, file);
  const index = await readFile(join(root, ".git", "index"));
  const status = git(root, "status", "--porcelain=v1", "-z");
  await writeFile(join(root, "a"), "working v2\n");
  assert.equal(await repo.fingerprint({ kind: "staged" }, file), staged);
  assert.notEqual(await repo.fingerprint({ kind: "unstaged" }, file), working);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(git(root, "status", "--porcelain=v1", "-z"), status);
  git(root, "add", "a");
  assert.notEqual(await repo.fingerprint({ kind: "staged" }, file), staged);
  assert.equal(await repo.fingerprint({ kind: "commit", commit }, { path: "a", status: "A" }), committed);
});

test("huellas limitan archivos grandes, cancelación y rutas externas; symlinks nuevos se leen como enlace", async (t) => {
  const { root, repo, temporary } = await fixture(t);
  const path = join(root, "huge");
  const { open } = await import("node:fs/promises");
  const handle = await open(path, "w");
  await handle.truncate(MAX_FINGERPRINT_BYTES + 1); await handle.close();
  await assert.rejects(repo.fingerprint({ kind: "untracked" }, { path: "huge", status: "?" }), /64 MiB/);
  await writeFile(join(temporary, "outside"), "private");
  await assert.rejects(repo.fingerprint({ kind: "untracked" }, { path: "../outside", status: "?" }), /fuera/);
  await symlink(temporary, join(root, "dir"));
  await assert.rejects(repo.fingerprint({ kind: "untracked" }, { path: "dir/outside", status: "?" }), /fuera/);
  await symlink("../outside", join(root, "link"));
  assert.match(await repo.fingerprint({ kind: "untracked" }, { path: "link", status: "?" }), /^[a-f0-9]{64}$/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repo.fingerprint({ kind: "untracked" }, { path: "link", status: "?" }, controller.signal));
});

test("reapertura conserva el progreso validado y commit verde sin cargar de nuevo su diff", () => {
  let original = loaded();
  original = reducer(original, { type: "review-toggle" });
  const key = identityKey({ kind: "unstaged" }, original.files[0]!);
  let restored = reducer(initialState, { type: "progress-loaded", progress: progressOf(original) });
  restored = reducer(restored, { type: "snapshot", revision: restored.revision, commits: [], pending: original.pending, fingerprints: { [key]: digest() } });
  restored = reducer(restored, { type: "mode", mode: "pending" });
  restored = reducer(restored, { type: "files", key: filesKey(restored), files: original.files });
  assert.equal(fileReviewStatus(restored, restored.files[0]!), "reviewed");
  const commit = { hash: "abcdef", shortHash: "abc", title: "Commit", date: "2026-10-06", parents: [] };
  const commitKey = identityKey({ kind: "commit", commit }, { path: "c", status: "A" });
  restored = reducer(restored, { type: "progress-loaded", progress: { ...emptyProgress(), reviewed: [commitKey], commitReviewKeys: { [commit.hash]: [commitKey] } } });
  assert.equal(commitReviewStatus(restored, commit), "reviewed");
});

test("invalidación automática borra marcas, conserva notas obsoletas y recarga el diff seleccionado", () => {
  let s = loaded();
  const key = identityKey({ kind: "unstaged" }, s.files[0]!);
  s = reducer(s, { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "Revisar comportamiento en móvil" });
  s = reducer(s, { type: "note-save" });
  assert.equal(fileReviewStatus(s, s.files[0]!), "needs-review");
  s = reducer(s, { type: "pending-audit", revision: s.revision, pending: s.pending, fingerprints: { [key]: digest("b") } });
  assert.equal(fileReviewStatus(s, s.files[0]!), "unreviewed");
  assert.equal(s.notes[key]?.text, "Revisar comportamiento en móvil");
  assert.equal(s.notes[key]?.stale, true);
  assert.equal(s.diff, null);
  assert.match(s.notice, /invalidada/);
  assert.equal(reviewTasks(s)[0]?.stale, true);
});

test("refresh conserva marcas sin cambios y rechaza auditorías atrasadas", () => {
  let s = reducer(loaded(), { type: "review-toggle" });
  const key = identityKey({ kind: "unstaged" }, s.files[0]!);
  const oldRevision = s.revision;
  s = reducer(s, { type: "refresh" });
  assert.deepEqual(s.reviewed, [key]);
  assert.equal(reducer(s, { type: "pending-audit", revision: oldRevision, pending: s.pending, fingerprints: { [key]: digest("b") } }), s);
  s = reducer(s, { type: "snapshot", revision: s.revision, commits: [], pending: s.pending, fingerprints: { [key]: digest() } });
  assert.deepEqual(s.reviewed, [key]);
});

test("archivos desaparecidos o cambiados de categoría invalidan sus marcas sin perder la nota", () => {
  let s = loaded();
  s = reducer(s, { type: "note-start" }); s = reducer(s, { type: "note-draft", text: "Confirmar" }); s = reducer(s, { type: "note-save" });
  const key = identityKey({ kind: "unstaged" }, s.files[0]!);
  s = reducer(s, { type: "pending-audit", revision: s.revision, pending: { ...s.pending, unstaged: s.files.slice(1), staged: [s.files[0]!] }, fingerprints: {} });
  assert.equal(s.needsReview.length, 0);
  assert.equal(s.notes[key]?.stale, true);
});

test("notas se editan, cancelan, resuelven con verde y solo reaparecen como tareas al volver a naranja", () => {
  let s = loaded();
  const key = identityKey({ kind: "unstaged" }, s.files[0]!);
  s = reducer(s, { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "hwrq — móvil" });
  s = reducer(s, { type: "note-cancel" });
  assert.equal(s.notes[key], undefined);
  s = reducer(s, { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "Revisar móvil" });
  s = reducer(s, { type: "note-save" });
  assert.equal(reviewTasks(s).length, 1);
  s = reducer(s, { type: "review-toggle" });
  assert.equal(reviewTasks(s).length, 0);
  assert.equal(s.notes[key]?.text, "Revisar móvil");
  s = reducer(s, { type: "review-needs-toggle" });
  assert.equal(reviewTasks(s).length, 1);
  s = reducer(s, { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "" });
  s = reducer(s, { type: "note-save" });
  assert.equal(s.notes[key], undefined);
  assert.equal(s.needsReview.length, 1);
});

test("nota en edición sobre contenido cambiado se conserva obsoleta, no marca el archivo nuevo", () => {
  let s = reducer(loaded(), { type: "note-start" });
  const key = identityKey({ kind: "unstaged" }, s.files[0]!);
  s = reducer(s, { type: "note-draft", text: "Mi duda" });
  s = reducer(s, { type: "pending-audit", revision: s.revision, pending: s.pending, fingerprints: { [key]: digest("b") } });
  s = reducer(s, { type: "note-save" });
  assert.equal(s.notes[key]?.stale, true);
  assert.deepEqual(s.needsReview, []);
});

test("notas tienen límite y controles neutros; archivos sin huella no admiten marcas", () => {
  let s = reducer(loaded(), { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "\u001b[2J" + "😀".repeat(1200) });
  assert.ok(Array.from(s.noteDraft).length <= 1000);
  assert.doesNotMatch(s.noteDraft, /\u001b/);
  s = { ...loaded(), fingerprints: {} };
  assert.equal(reducer(s, { type: "review-toggle" }), s);
  assert.equal(reducer(s, { type: "note-start" }).noteEditing, false);
});

test("filtro solo pendientes conserva índices, salta verdes y no altera el resumen", () => {
  let s = reducer(loaded(), { type: "review-toggle" });
  s = reducer(s, { type: "remaining-toggle" });
  assert.deepEqual(visibleFiles(s).map((file) => file.index), [1, 2]);
  assert.equal(s.fileIndex, 1);
  assert.deepEqual(summary(s), { total: 3, reviewed: 1, needsReview: 0, unreviewed: 2 });
  s = reducer(s, { type: "next-remaining" });
  assert.equal(s.fileIndex, 2);
  s = reducer(s, { type: "next-remaining" });
  assert.equal(s.fileIndex, 1);
  s = reducer(s, { type: "search-query", query: "c.ts" });
  assert.deepEqual(visibleFiles(s).map((file) => file.index), [2]);
  assert.deepEqual(summary(s), { total: 3, reviewed: 1, needsReview: 0, unreviewed: 2 });
});

test("marcar el último pendiente avanza o muestra lista vacía sin seleccionar un archivo oculto", () => {
  let s = loaded();
  s = reducer(s, { type: "files", key: filesKey(s), files: [s.files[0]!] });
  s = reducer(s, { type: "diff", key: diffKey(s), diff: parseDiff("@@ -1 +1 @@\n-x\n+y"), fingerprint: digest() });
  s = reducer(s, { type: "remaining-toggle" });
  s = reducer(s, { type: "review-toggle" });
  assert.equal(s.fileIndex, -1);
  assert.deepEqual(visibleFiles(s), []);
  s = reducer(s, { type: "next-remaining" });
  assert.match(s.notice, /No quedan/);
  s = reducer(s, { type: "remaining-toggle" });
  assert.equal(s.fileIndex, 0);
});

test("navegación por bloques funciona igual en unificado y paralelo y define la línea del editor", () => {
  const diff = parseDiff("@@ -1 +1 @@\n-a\n+b\n@@ -50,2 +60,3 @@\n-c\n-d\n+e\n+f\n+g\n@@ -100 +120 @@\n-h\n+i");
  for (const layout of ["unified", "split"] as const) {
    let s: State = { ...loaded(), diff, diffLayout: layout };
    s = reducer(s, { type: "hunk", direction: 1, pageSize: 3 });
    assert.equal(s.hunkAnchor, 3);
    assert.equal(editorLocation(s)?.line, 60);
    s = reducer(s, { type: "hunk", direction: 1, pageSize: 3 });
    assert.equal(editorLocation(s)?.line, 120);
    s = reducer(s, { type: "hunk", direction: -1, pageSize: 3 });
    assert.equal(editorLocation(s)?.line, 60);
    s = reducer(s, { type: "move", delta: -1, pageSize: 3 });
    assert.equal(s.hunkAnchor, null);
  }
});

test("editor usa el número nuevo de la pareja visible, no la primera adición de todo el bloque", () => {
  const diff = parseDiff("@@ -1,3 +10,3 @@\n-a\n-b\n-c\n+x\n+y\n+z");
  const s = { ...loaded(), diff, diffLayout: "split" as const, scroll: 3 };
  assert.deepEqual(editorLocation(s), { path: "a.ts", line: 12, column: 1 });
  assert.equal(editorLocation({ ...s, panel: 1 }), null);
});

test("tareas globales abren su fuente y archivo aunque hubiera filtros activos", () => {
  let s = reducer(loaded(), { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "Revisar" }); s = reducer(s, { type: "note-save" });
  const task = reviewTasks(s)[0]!;
  s = reducer(s, { type: "search-query", query: "c.ts" });
  s = reducer(s, { type: "overlay", overlay: "tasks" });
  s = reducer(s, { type: "task-open", key: task.key });
  assert.equal(s.overlay, "none");
  assert.equal(s.searchQuery, "");
  assert.equal(s.fileIndex, 0);
  const commit = { hash: "abcdef", shortHash: "abc", title: "Older", date: "2026-10-01", parents: [] };
  const key = identityKey({ kind: "commit", commit }, { path: "old.ts", status: "A" });
  s = reducer(s, { type: "task-open", key, commit });
  assert.equal(s.mode, "history");
  assert.equal(s.requestedFileKey, key);
  s = reducer(s, { type: "files", key: filesKey(s), files: [{ path: "first.ts", status: "A" }, { path: "old.ts", status: "A" }] });
  assert.equal(s.fileIndex, 1);
});

test("configuración de editor admite argumentos citados y pasa metacaracteres literalmente", () => {
  assert.deepEqual(commandArgs('"/my editor/code" --reuse-window'), ["/my editor/code", "--reuse-window"]);
  const file = '/repo/my $(touch HACK); "file".ts';
  assert.deepEqual(editorInvocation("code --reuse-window", file, 42, 1),
    { program: "code", args: ["--reuse-window", "--goto", file + ":42:1"] });
  assert.deepEqual(editorInvocation('custom --file "{file}" --line {line}', file, 8, 2),
    { program: "custom", args: ["--file", file, "--line", "8"] });
  assert.throws(() => commandArgs('code "unfinished'), /Comillas/);
  assert.throws(() => editorInvocation("vim", file, 1, 1), /editor de terminal/);
});

test("apertura de editor rechaza archivo eliminado, symlink externo y CLI inexistente", async (t) => {
  const { root, temporary } = await fixture(t);
  await writeFile(join(root, "a.ts"), "test");
  await writeFile(join(temporary, "outside.ts"), "private");
  await symlink(join(temporary, "outside.ts"), join(root, "link.ts"));
  await assert.rejects(openEditor(root, { path: "link.ts", line: 1, column: 1 }), /dentro/);
  await assert.rejects(openEditor(root, { path: "gone.ts", line: 1, column: 1 }));
  await assert.rejects(openEditor(root, { path: "a.ts", line: 4, column: 1 }, "terminal-review-no-such-editor {file} {line}"), /No se encontró/);
});

test("informe contiene todos los archivos y tareas, escapa Markdown y se exporta fuera del repo", async (t) => {
  const { root, cache } = await fixture(t);
  let s = reducer(loaded(), { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "<script> Revisar [móvil] *luego*" }); s = reducer(s, { type: "note-save" });
  s = reducer(s, { type: "search-query", query: "b.ts" });
  const report = reviewReport(root, s, new Date("2026-10-06T12:00:00Z"));
  assert.match(report, /3 archivos · 0 terminados · 1 pendientes · 2 sin revisar/);
  assert.match(report, /a\.ts/); assert.match(report, /c\.ts/);
  assert.match(report, /2026-10-06T12:00:00.000Z/);
  assert.match(report, /\\<script\\>/);
  const store = new ProgressStore(root, cache);
  const path = await store.exportMarkdown(report);
  assert.equal(await readFile(path, "utf8"), report);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("paneles resumen, ayuda y tareas no desbordan terminales de 40/80/140 columnas", () => {
  let s = reducer(loaded(), { type: "note-start" });
  s = reducer(s, { type: "note-draft", text: "Revisar comportamiento en móvil" }); s = reducer(s, { type: "note-save" });
  for (const overlay of ["summary", "tasks", "help"] as const) for (const width of [38, 78, 138]) {
    const output = stripVTControlCharacters(renderToString(createElement(WorkflowPanel, {
      state: { ...s, overlay }, width, rows: 17,
    }), { columns: width }));
    assert.ok(output.split("\n").every((line) => stringWidth(line) <= width), output);
    assert.ok(output.split("\n").length <= 17, output);
    if (overlay === "tasks") assert.match(output, /Revisar comportamiento/);
    if (overlay === "summary") assert.match(output, /3 archivos/);
  }
});

test("auditoría consulta solo marcas/notas y selección, incluyendo untracked sin afectar Git", async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, "a.ts"), "a"); await writeFile(join(root, "b.ts"), "b");
  const pending = await repo.pending();
  const key = identityKey({ kind: "untracked" }, pending.untracked[0]!);
  const s = { ...initialState, reviewed: [key] };
  const results = await pendingFingerprints(repo, pending, s, new AbortController().signal);
  assert.deepEqual(Object.keys(results), [key]);
  assert.match(results[key]!, /^[a-f0-9]{64}$/);
  const before = git(root, "status", "--porcelain");
  await repo.commit("deadbee").catch(() => {});
  assert.equal(git(root, "status", "--porcelain"), before);
});
