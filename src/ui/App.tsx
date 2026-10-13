import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Repository } from "../git/repository.js";
import { useReview } from "../application/useReview.js";
import { categories, labels, selectedSource, visibleFiles, isReviewed, fileReviewStatus, commitReviewStatus } from "../application/state.js";
import { ReviewList as List } from "./ReviewList.js";
import { ImagePreview } from "./ImagePreview.js";
import { TextDiff } from "./TextDiff.js";
import { WorkflowPanel } from "./WorkflowPanel.js";
import { editorLocation } from "../application/reviewWorkflow.js";
import { diffKey, isSplitDiff, diffRowCount, diffPageSize } from "../application/state.js";
import { fit } from "./text.js";
import { safeText } from "../core/diff.js";
function Panel({
  title,
  active,
  width,
  height,
  children,
}: {
  title: string;
  active: boolean;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={active ? "cyan" : "gray"}
      overflow="hidden"
    >
      <Text bold color={active ? "cyan" : "gray"}>
        {fit(title, width - 2)}
      </Text>
      {children}
    </Box>
  );
}
export function App({ repo, registerFlush }: { repo: Repository; registerFlush?: (flush: () => Promise<void>) => void }) {
  const { state, dispatch, flush, exportReport, launchEditor, openTask } = useReview(repo);
  const [quitting, setQuitting] = useState(false);
  useEffect(() => { registerFlush?.(flush); }, [registerFlush, flush]);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const quit = (force = false) => {
    if (quitting) return;
    setQuitting(true);
    flush().then(exit, (error: unknown) => {
      if (force) { console.error(safeText(String(error))); exit(); }
      else {
        setQuitting(false);
        dispatch({ type: "storage-warning", message: `No se pudo guardar: ${String(error)} · Ctrl+C salir sin guardar.` });
      }
    });
  };
  const [size, setSize] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });
  useEffect(() => {
    const resize = () =>
      setSize({ width: stdout.columns || 80, height: stdout.rows || 24 });
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);
  const narrow = size.width < 110;
  const height = Math.max(4, size.height - 4 - (state.noteEditing ? 2 : 0));
  const rows = Math.max(1, height - 3);
  const split = isSplitDiff({ ...state, diffColumns: size.width });
  const expanded = split && state.panel === 2 && !!state.diff;
  const pageSize = diffPageSize(state, rows);
  useEffect(() => {
    dispatch({ type: "diff-viewport", columns: size.width, rows });
  }, [rows, size.width, dispatch]);
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      quit(true);
      return;
    }
    if (quitting) return;
    if (state.noteEditing) {
      if (key.escape) dispatch({ type: "note-cancel" });
      else if (key.return) dispatch({ type: "note-save" });
      else if (key.backspace || key.delete) dispatch({ type: "note-draft", text: Array.from(state.noteDraft).slice(0, -1).join("") });
      else if (key.ctrl && input === "u") dispatch({ type: "note-draft", text: "" });
      else if (!key.ctrl && !key.meta && input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow)
        dispatch({ type: "note-draft", text: state.noteDraft + input });
      return;
    }
    if (state.searchEditing) {
      if (key.escape) dispatch({ type: "search-end", clear: true });
      else if (key.return || key.tab) dispatch({ type: "search-end" });
      else if (key.backspace || key.delete)
        dispatch({ type: "search-query", query: Array.from(state.searchQuery).slice(0, -1).join("") });
      else if (key.ctrl && input === "u")
        dispatch({ type: "search-query", query: "" });
      else if (!key.ctrl && !key.meta && input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow)
        dispatch({ type: "search-query", query: state.searchQuery + input.replace(/[\x00-\x1f\x7f-\x9f]/g, "") });
      return;
    }
    if (input === "q") { quit(); return; }
    if (input === "?") { dispatch({ type: "overlay", overlay: state.overlay === "help" ? "none" : "help" }); return; }
    if (input === "t") { dispatch({ type: "overlay", overlay: state.overlay === "tasks" ? "none" : "tasks" }); return; }
    if (input === "i") { dispatch({ type: "overlay", overlay: state.overlay === "summary" ? "none" : "summary" }); return; }
    if (input === "E") { void exportReport(); return; }
    if (state.overlay !== "none") {
      if (key.escape) dispatch({ type: "overlay", overlay: "none" });
      else if (state.overlay === "tasks" && (key.upArrow || key.downArrow)) dispatch({ type: "task-move", delta: key.upArrow ? -1 : 1 });
      else if (state.overlay === "tasks" && key.return) void openTask();
      return;
    }
    if (input === "c") { dispatch({ type: "note-start" }); return; }
    if (input === "f") { dispatch({ type: "remaining-toggle" }); return; }
    if (input === "]") { dispatch({ type: "next-remaining" }); return; }
    if (input === "j" || input === "k") { dispatch({ type: "hunk", direction: input === "j" ? 1 : -1, pageSize }); return; }
    if (input === "e") { void launchEditor(); return; }
    if (input === "/") { dispatch({ type: "search-start" }); return; }
    if (input === "m") { dispatch({ type: "review-toggle" }); return; }
    if (input === "n") { dispatch({ type: "review-needs-toggle" }); return; }
    if (input === "s") { dispatch({ type: "diff-layout-toggle", rows }); return; }
    if (input === "h" || input === "w") {
      dispatch({ type: "mode", mode: input === "h" ? "history" : "pending" });
      return;
    }
    if (input === "v") {
      dispatch({ type: "image-side" });
      return;
    }
    if (input === "r") {
      dispatch({ type: "refresh" });
      return;
    }
    if (key.tab) {
      dispatch({
        type: "panel",
        panel: ((state.panel + (key.shift ? 2 : 1)) % 3) as 0 | 1 | 2,
      });
      return;
    }
    if (key.escape) {
      if (state.panel === 1 && state.searchQuery) {
        dispatch({ type: "search-end", clear: true });
        return;
      }
      dispatch({
        type: "panel",
        panel: Math.max(0, state.panel - 1) as 0 | 1 | 2,
      });
      return;
    }
    if (key.return) {
      dispatch({
        type: "panel",
        panel: Math.min(2, state.panel + 1) as 0 | 1 | 2,
      });
      return;
    }
    if (key.upArrow || key.downArrow)
      dispatch({ type: "move", delta: key.upArrow ? -1 : 1, pageSize });
  });
  const leftWidth = narrow ? size.width : Math.floor(size.width * 0.28);
  const filesWidth = narrow ? size.width : Math.floor(size.width * 0.25);
  const diffWidth = narrow || expanded ? size.width : size.width - leftWidth - filesWidth;
  const source = selectedSource(state);
  const file = state.files[state.fileIndex];
  const visible = visibleFiles(state);
  const reviewedCount = state.files.filter((f) => isReviewed(state, f)).length;
  const needsReviewCount = state.files.filter((f) => fileReviewStatus(state, f) === "needs-review").length;
  const fileStatus = file ? fileReviewStatus(state, file) : "unreviewed";
  const leftItems =
    state.mode === "history"
      ? state.commits.map((c) => ({ label: `${c.shortHash} ${c.date} ${c.title}`, reviewStatus: commitReviewStatus(state, c) }))
      : categories.map((c) => ({ label: `${labels[c]} (${state.pending[c].length})` }));
  const sourceTitle =
    source?.kind === "commit"
      ? `${source.commit.shortHash}${source.commit.parents.length > 1 ? " · merge: primer padre" : source.commit.parents.length === 0 ? " · árbol vacío" : ""}`
      : source
        ? labels[source.kind]
        : "Sin selección";
  const loading = state.loading || state.filesLoading || state.diffLoading;
  const location = editorLocation(state);
  return (
    <Box flexDirection="column" width={size.width}>
      <Text bold>
        {fit(
          `Terminal Review · ${state.mode === "history" ? "Historial" : "Pendientes"} · ${repo.root}`,
          size.width,
        )}
      </Text>
      {state.overlay !== "none" ? <Panel title={state.overlay === "help" ? "Ayuda · Esc volver" : state.overlay === "tasks" ? "Tareas abiertas · Esc volver" : "Resumen de revisión · Esc volver"} active width={size.width} height={height}>
        <WorkflowPanel state={state} width={size.width - 2} rows={rows} />
      </Panel> : <Box>
        {!expanded && (!narrow || state.panel === 0) && (
          <Panel
            title={
              state.mode === "history"
                ? state.commits.length > 30 ? "Commits y tareas anteriores" : "Últimos 30 commits"
                : "Cambios pendientes"
            }
            active={state.panel === 0}
            width={leftWidth}
            height={height}
          >
            <List
              items={leftItems}
              index={state.selection}
              width={leftWidth - 2}
              rows={rows}
              empty={state.loading ? "Cargando…" : "Historial vacío"}
            />
          </Panel>
        )}
        {!expanded && (!narrow || state.panel === 1) && (
          <Panel
            title={`Archivos · ${reviewedCount}/${state.files.length} ✓${needsReviewCount ? ` · ${needsReviewCount} !` : ""}${state.onlyRemaining ? " · Solo pendientes" : ""} · ${sourceTitle}`}
            active={state.panel === 1}
            width={filesWidth}
            height={height}
          >
            {(state.searchEditing || state.searchQuery) && (
              <Text color="cyan">{fit(`/ ${state.searchQuery}${state.searchEditing ? "▏" : ""}`, filesWidth - 2)}</Text>
            )}
            <List
              items={visible.map(
                ({ file: f }) => ({
                  label: `${f.status} ${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}`,
                  reviewStatus: fileReviewStatus(state, f),
                }),
              )}
              index={visible.findIndex((f) => f.index === state.fileIndex)}
              width={filesWidth - 2}
              rows={Math.max(1, rows - (state.searchEditing || state.searchQuery ? 1 : 0))}
              empty={
                state.filesLoading ? "Cargando…" : state.onlyRemaining ? "Sin pendientes en este filtro" : state.searchQuery ? "Sin coincidencias" : "Sin archivos modificados"
              }
            />
          </Panel>
        )}
        {(!narrow || state.panel === 2) && (
          <Panel
            title={`Diff · ${fileStatus === "needs-review" ? "! " : fileStatus === "reviewed" ? "✓ " : ""}${file?.path ?? sourceTitle}${split ? " · Paralelo" : ""}`}
            active={state.panel === 2}
            width={diffWidth}
            height={height}
          >
            {state.diff?.image ? (
              <ImagePreview
                key={diffKey(state)}
                image={state.diff.image}
                width={diffWidth - 2}
                rows={rows}
                side={state.imageSide}
              />
            ) : state.diff?.lines.length ? (
              <TextDiff
                lines={state.diff.lines}
                width={diffWidth - 2}
                rows={pageSize}
                scroll={state.scroll}
                split={split}
                fallback={state.diffLayout === "split" && size.width < 80}
              />
            ) : (
              <Text dimColor>
                {fit(
                  state.diffLoading
                    ? "Cargando diferencia…"
                    : file
                      ? "Sin cambios textuales (solo metadatos)."
                      : "Selecciona un archivo",
                  diffWidth - 2,
                )}
              </Text>
            )}
          </Panel>
        )}
      </Box>}
      {state.noteEditing && <>
        <Text color="#ff9e45">{fit("Nota · Enter guardar · Esc cancelar · Ctrl+U borrar", size.width)}</Text>
        <Text>{fit(`${Array.from(state.noteDraft).slice(-Math.max(1, Math.floor((size.width - 2) / 2))).join("")}▏`, size.width)}</Text>
      </>}
      <Text>
        {fit(
          state.noteEditing
            ? "Escribe una nota (máximo 1000 caracteres)"
            : state.overlay !== "none"
              ? "? ayuda · t tareas · i resumen · E exportar · Esc volver · q"
            : state.searchEditing
            ? "Enter aplicar · Esc limpiar · Ctrl+U borrar"
            : size.width < 60
              ? "? ayuda · m ✓ · n ! · / buscar · q"
              : `? ayuda · ↑↓ Enter/Tab Esc · ${state.diff?.image ? "v imagen" : "s vista"} · m ✓ · n ! · / buscar · f ] j/k c e t i E · h/w r q`,
          size.width,
        )}
      </Text>
      <Text {...(state.error ? { color: "red" } : { dimColor: true })}>
        {fit(
          state.error || state.storageWarning || state.notice ||
            `${state.diff?.truncated ? "AVISO: diff truncado · " : ""}${loading ? "Cargando…" : "Listo"} · ${sourceTitle} · panel ${state.panel + 1}/3 · ${state.searchQuery || state.onlyRemaining ? `${visible.length}/${state.files.length} encontrados · ` : ""}${state.diff?.image ? "imagen · v anterior/nueva" : `filas ${state.diff?.lines.length ? state.scroll + 1 : 0}/${diffRowCount(state)} · ${split ? "paralelo" : "unificado"}`}${location ? ` · e L${location.line}` : ""}`,
          size.width,
        )}
      </Text>
    </Box>
  );
}
