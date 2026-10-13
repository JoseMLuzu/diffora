import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reducer,
  initialState,
  diffKey,
  filesKey,
  visibleFiles,
  isReviewed,
  isCommitReviewed,
  fileReviewStatus,
  commitReviewStatus,
} from "../src/application/state.js";
test("rechaza respuestas atrasadas incluso al volver a la misma selección", () => {
  let s = reducer(initialState, { type: "mode", mode: "pending" });
  const old = filesKey(s);
  s = reducer(s, { type: "move", delta: 1, pageSize: 10 });
  s = reducer(s, { type: "move", delta: -1, pageSize: 10 });
  assert.equal(
    reducer(s, {
      type: "files",
      key: old,
      files: [{ path: "stale", status: "M" }],
    }),
    s,
  );
  s = reducer(s, {
    type: "files",
    key: filesKey(s),
    files: [
      { path: "a", status: "M" },
      { path: "b", status: "M" },
    ],
  });
  const oldDiff = diffKey(s);
  s = reducer(s, { type: "panel", panel: 1 });
  s = reducer(s, { type: "move", delta: 1, pageSize: 10 });
  s = reducer(s, { type: "move", delta: -1, pageSize: 10 });
  assert.equal(
    reducer(s, {
      type: "diff",
      key: oldDiff,
      diff: { lines: [], binary: false, truncated: false },
    }),
    s,
  );
});

function loadedFiles() {
  let state = reducer(initialState, { type: "mode", mode: "pending" });
  state = reducer(state, {
    type: "files", key: filesKey(state), files: [
      { path: "src/alpha.ts", status: "M" },
      { path: "docs/My File.md", oldPath: "old guide.md", status: "R100" },
      { path: "src/beta.ts", status: "D" },
    ],
  });
  return reducer(state, { type: "panel", panel: 1 });
}

test("búsqueda filtra rutas y origen de renombres sin cambiar identidades ni aceptar diffs atrasados", () => {
  let state = loadedFiles();
  const oldKey = diffKey(state);
  state = reducer(state, { type: "search-start" });
  state = reducer(state, { type: "search-query", query: "OLD GUIDE" });
  assert.equal(state.fileIndex, 1);
  assert.deepEqual(visibleFiles(state).map((f) => f.index), [1]);
  assert.equal(reducer(state, { type: "diff", key: oldKey,
    diff: { lines: [], binary: false, truncated: false } }), state);
  state = reducer(state, { type: "search-end", clear: true });
  assert.equal(state.fileIndex, 1);
  assert.equal(visibleFiles(state).length, 3);
  state = reducer(state, { type: "search-query", query: "SRC/" });
  assert.equal(state.fileIndex, 0);
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(state.fileIndex, 2);
  state = reducer(state, { type: "move", delta: 100, pageSize: 10 });
  assert.equal(state.fileIndex, 2);
});

test("búsqueda vacía de resultados elimina selección y diff, y permite recuperarlos", () => {
  let state = loadedFiles();
  const oldKey = diffKey(state);
  state = reducer(state, { type: "search-query", query: "no existe" });
  assert.equal(state.fileIndex, -1);
  assert.equal(state.diff, null);
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(state.fileIndex, -1);
  state = reducer(state, { type: "search-end", clear: true });
  assert.equal(state.fileIndex, 0);
  assert.notEqual(diffKey(state), oldKey);
  state = reducer(state, { type: "search-query", query: "😀".repeat(300) });
  assert.equal(Array.from(state.searchQuery).length, 256);
});

test("marcas requieren diff cargado, se alternan, sobreviven a navegación y se aíslan por categoría", () => {
  let state = loadedFiles();
  assert.equal(reducer(state, { type: "review-toggle" }), state);
  state = reducer(state, { type: "diff", key: diffKey(state),
    diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-toggle" });
  const file = state.files[0]!;
  assert.equal(isReviewed(state, file), true);
  state = reducer(state, { type: "search-query", query: "docs" });
  assert.equal(isReviewed(state, file), true);
  state = reducer(state, { type: "panel", panel: 0 });
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(isReviewed(state, file), false);
  state = reducer(state, { type: "move", delta: -1, pageSize: 10 });
  assert.equal(isReviewed(state, file), true);
  state = reducer(state, { type: "files", key: filesKey(state), files: [file] });
  state = reducer(state, { type: "diff", key: diffKey(state),
    diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "panel", panel: 2 });
  state = reducer(state, { type: "review-toggle" });
  assert.equal(isReviewed(state, file), false);
  state = reducer(state, { type: "review-toggle" });
  state = reducer(state, { type: "refresh" });
  assert.equal(isReviewed(state, file), false);
});

test("las marcas de commits se conservan al actualizar y no se confunden entre commits", () => {
  const commit = { hash: "abc", shortHash: "abc", title: "First", date: "2026-10-06", parents: [] };
  let state = reducer(initialState, { type: "snapshot", revision: 0,
    commits: [commit, { ...commit, hash: "def" }], pending: initialState.pending });
  const file = { path: "same.txt", status: "M" };
  state = reducer(state, { type: "files", key: filesKey(state), files: [file] });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "panel", panel: 1 });
  state = reducer(state, { type: "review-toggle" });
  state = reducer(state, { type: "refresh" });
  assert.equal(isReviewed(state, file), true);
  state = reducer(state, { type: "panel", panel: 0 });
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(isReviewed(state, file), false);
});
test("un commit solo se completa con todos sus archivos revisados, incluso tras navegar o actualizar", () => {
  const commit = { hash: "abc", shortHash: "abc", title: "First", date: "2026-10-06", parents: [] };
  const other = { ...commit, hash: "def", shortHash: "def" };
  const files = [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "A" }];
  let state = reducer(initialState, { type: "snapshot", revision: 0, commits: [commit, other], pending: initialState.pending });
  assert.equal(isCommitReviewed(state, commit), false); // Unknown is not complete.
  state = reducer(state, { type: "files", key: filesKey(state), files });
  state = reducer(state, { type: "panel", panel: 1 });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-toggle" });
  assert.equal(isCommitReviewed(state, commit), false);
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-toggle" });
  assert.equal(isCommitReviewed(state, commit), true);
  state = reducer(state, { type: "panel", panel: 0 });
  const oldFilesKey = filesKey(state);
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(isCommitReviewed(state, commit), true);
  assert.equal(isCommitReviewed(state, other), false);
  const stale = reducer(state, { type: "files", key: oldFilesKey, files });
  assert.equal(stale, state); // Late responses cannot mark another commit complete.
  state = reducer(state, { type: "files", key: filesKey(state), files: [] });
  assert.equal(isCommitReviewed(state, other), false); // Empty lists stay unreviewed.
  state = reducer(state, { type: "refresh" });
  assert.equal(isCommitReviewed(state, commit), true);
  state = reducer(state, { type: "move", delta: -1, pageSize: 10 });
  state = reducer(state, { type: "files", key: filesKey(state), files });
  state = reducer(state, { type: "panel", panel: 1 });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-toggle" });
  assert.equal(isCommitReviewed(state, commit), false); // Unmarking one reverses completion.
});
test("n alterna naranja y m pasa a verde sin conservar dos marcas ni aceptar diffs incompletos", () => {
  let state = loadedFiles();
  const file = state.files[0]!;
  assert.equal(reducer(state, { type: "review-needs-toggle" }), state);
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-needs-toggle" });
  assert.equal(fileReviewStatus(state, file), "needs-review");
  assert.equal(isReviewed(state, file), false);
  assert.equal(state.reviewed.length, 0);
  state = reducer(state, { type: "review-needs-toggle" });
  assert.equal(fileReviewStatus(state, file), "unreviewed");
  state = reducer(state, { type: "review-needs-toggle" });
  state = reducer(state, { type: "review-toggle" });
  assert.equal(fileReviewStatus(state, file), "reviewed");
  assert.equal(state.needsReview.length, 0);
  state = reducer(state, { type: "review-needs-toggle" });
  assert.equal(fileReviewStatus(state, file), "needs-review");
  assert.equal(state.reviewed.length, 0);
  const loading = { ...state, diffLoading: true };
  assert.equal(reducer(loading, { type: "review-needs-toggle" }), loading);
  const error = { ...state, error: "No se pudo cargar el diff" };
  assert.equal(reducer(error, { type: "review-needs-toggle" }), error);
  state = reducer(state, { type: "panel", panel: 0 });
  assert.equal(reducer(state, { type: "review-needs-toggle" }), state);
});

test("un naranja domina un commit con varios verdes y el filtro no lo oculta", () => {
  const commit = { hash: "orange", shortHash: "orange", title: "Mixed", date: "2026-10-06", parents: [] };
  const files = [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }, { path: "c.txt", status: "M" }];
  let state = reducer(initialState, { type: "snapshot", revision: 0, commits: [commit], pending: initialState.pending });
  assert.equal(commitReviewStatus(state, commit), "unreviewed");
  state = reducer(state, { type: "files", key: filesKey(state), files });
  state = reducer(state, { type: "panel", panel: 1 });
  for (let i = 0; i < 3; i++) {
    if (i) state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
    state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
    state = reducer(state, { type: i === 2 ? "review-needs-toggle" : "review-toggle" });
  }
  assert.equal(state.reviewed.length, 2);
  assert.equal(commitReviewStatus(state, commit), "needs-review");
  assert.equal(isCommitReviewed(state, commit), false);
  state = reducer(state, { type: "search-query", query: "a.txt" });
  assert.equal(visibleFiles(state).length, 1);
  assert.equal(commitReviewStatus(state, commit), "needs-review");
  state = reducer(state, { type: "search-end", clear: true });
  state = reducer(state, { type: "move", delta: 2, pageSize: 10 });
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-needs-toggle" });
  assert.equal(commitReviewStatus(state, commit), "unreviewed"); // Two greens do not finish the third.
  state = reducer(state, { type: "review-toggle" });
  assert.equal(commitReviewStatus(state, commit), "reviewed");
  state = reducer(state, { type: "review-needs-toggle" });
  assert.equal(commitReviewStatus(state, commit), "needs-review");
  state = reducer(state, { type: "refresh" });
  assert.equal(commitReviewStatus(state, commit), "needs-review");
});

test("naranja se aísla por categoría y se invalida al actualizar pendientes", () => {
  let state = loadedFiles();
  const file = state.files[0]!;
  state = reducer(state, { type: "diff", key: diffKey(state), diff: { lines: [], binary: false, truncated: false } });
  state = reducer(state, { type: "review-needs-toggle" });
  state = reducer(state, { type: "panel", panel: 0 });
  state = reducer(state, { type: "move", delta: 1, pageSize: 10 });
  assert.equal(fileReviewStatus(state, file), "unreviewed");
  state = reducer(state, { type: "move", delta: -1, pageSize: 10 });
  assert.equal(fileReviewStatus(state, file), "needs-review");
  state = reducer(state, { type: "refresh" });
  assert.equal(fileReviewStatus(state, file), "unreviewed");
  assert.deepEqual(state.needsReview, []);
});

test("refresh invalida snapshots y errores anteriores", () => {
  const s = reducer(initialState, { type: "refresh" });
  assert.equal(
    reducer(s, {
      type: "snapshot",
      revision: 0,
      commits: [],
      pending: initialState.pending,
    }),
    s,
  );
  assert.equal(
    reducer(s, {
      type: "error",
      target: "snapshot",
      key: "0",
      message: "stale",
    }),
    s,
  );
});
test("selección y desplazamiento quedan dentro de los límites", () => {
  let s = {
    ...initialState,
    panel: 2 as const,
    diff: {
      lines: Array.from({ length: 30 }, () => ({
        kind: "context" as const,
        text: "x",
      })),
      binary: false,
      truncated: false,
    },
  };
  s = reducer(s, { type: "move", delta: 100, pageSize: 10 }) as typeof s;
  assert.equal(s.scroll, 20);
  s = reducer(s, { type: "move", delta: -100, pageSize: 10 }) as typeof s;
  assert.equal(s.scroll, 0);
});
