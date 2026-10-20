import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Repository } from "../git/repository.js";
import { useReview } from "../application/useReview.js";
import { categories, labels, selectedSource, visibleFiles, isReviewed, fileReviewStatus, commitReviewStatus, type State } from "../application/state.js";
import { ReviewList as List } from "./ReviewList.js";
import { ImagePreview } from "./ImagePreview.js";
import { TextDiff } from "./TextDiff.js";
import { WorkflowPanel } from "./WorkflowPanel.js";
import { editorLocation } from "../application/reviewWorkflow.js";
import { diffKey, isSplitDiff, diffRowCount, diffPageSize } from "../application/state.js";
import { fit } from "./text.js";
import { safeText } from "../core/diff.js";
import { usePanelResize } from "./usePanelResize.js";
import stringWidth from "string-width";
import { tr } from "../core/i18n.js";

function shortcutHint(state: State, width: number): string {
  const compact = width < 110;
  let actions: string[];
  if (state.noteEditing) actions = [tr("Enter guardar", "Enter save"), tr("Esc cancelar", "Esc cancel"), tr("Ctrl+U borrar", "Ctrl+U clear")];
  else if (state.searchEditing) actions = [tr("Enter aplicar", "Enter apply"), tr("Esc limpiar", "Esc clear"), tr("Ctrl+U borrar", "Ctrl+U clear")];
  else if (state.overlay === "help") actions = [tr("Esc volver", "Esc back"), tr("q salir", "q quit")];
  else if (state.overlay === "tasks") actions = compact
    ? ["↑↓", tr("Enter abrir", "Enter open"), tr("Esc volver", "Esc back"), tr("? ayuda", "? help")]
    : [tr("↑↓ elegir", "↑↓ select"), tr("Enter abrir", "Enter open"), tr("Esc volver", "Esc back"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  else if (state.overlay === "summary") actions = [tr("E exportar", "E export"), tr("Esc volver", "Esc back"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  else if (state.panel === 0) actions = compact
    ? [tr("↑↓ elegir", "↑↓ select"), tr("Enter abrir", "Enter open"), tr("? ayuda", "? help"), tr("q salir", "q quit")]
    : [tr("↑↓ elegir", "↑↓ select"), tr("Enter archivos", "Enter files"), tr("h/w vista", "h/w view"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  else if (state.panel === 1) actions = compact
    ? ["↑↓", "Enter diff", tr("/ buscar", "/ search"), tr("? ayuda", "? help")]
    : [tr("↑↓ elegir", "↑↓ select"), "Enter diff", tr("/ buscar", "/ search"), tr("m listo", "m done"), tr("n revisar", "n review"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  else if (state.diff?.image) actions = compact
    ? [tr("v comparar", "v compare"), tr("Esc volver", "Esc back"), tr("? ayuda", "? help")]
    : [tr("v antes/después", "v before/after"), tr("m listo", "m done"), tr("n revisar", "n review"), tr("Esc volver", "Esc back"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  else actions = compact
    ? ["↑↓", tr("j/k bloques", "j/k hunks"), tr("s vista", "s view"), tr("? ayuda", "? help")]
    : [tr("↑↓ desplazar", "↑↓ scroll"), tr("j/k bloques", "j/k hunks"), tr("s paralelo", "s side by side"), tr("m listo", "m done"), tr("n revisar", "n review"), tr("? ayuda", "? help"), tr("q salir", "q quit")];
  let hint = "";
  for (const action of actions) {
    const next = hint ? `${hint} · ${action}` : action;
    if (stringWidth(next) > width) break;
    hint = next;
  }
  return hint;
}

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
        dispatch({ type: "storage-warning", message: tr(`No se pudo guardar: ${String(error)} · Ctrl+C salir sin guardar.`, `Could not save: ${String(error)} · Ctrl+C quit without saving.`) });
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
  const { widths, resizing, handleMouse } = usePanelResize(size.width, height,
    !narrow && !expanded && state.overlay === "none" && !state.noteEditing && !state.searchEditing && !quitting);
  const pageSize = diffPageSize(state, rows);
  useEffect(() => {
    dispatch({ type: "diff-viewport", columns: size.width, rows });
  }, [rows, size.width, dispatch]);
  useInput((input, key) => {
    if (handleMouse(input)) return;
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
  const leftWidth = narrow ? size.width : widths[0];
  const filesWidth = narrow ? size.width : widths[1];
  const diffWidth = narrow || expanded ? size.width : widths[2];
  const source = selectedSource(state);
  const file = state.files[state.fileIndex];
  const visible = visibleFiles(state);
  const reviewedCount = state.files.filter((f) => isReviewed(state, f)).length;
  const needsReviewCount = state.files.filter((f) => fileReviewStatus(state, f) === "needs-review").length;
  const fileStatus = file ? fileReviewStatus(state, file) : "unreviewed";
  const leftItems =
    state.mode === "history"
      ? state.commits.map((c, index) => ({
          label: `${c.pushStatus === "unpushed" ? "↑ " : ""}${c.shortHash} ${c.date} ${c.title}`,
          reviewStatus: commitReviewStatus(state, c),
          highlighted: c.pushStatus === "unpushed",
          ...(index > 0 && c.pushStatus && state.commits[index - 1]?.pushStatus && c.pushStatus !== state.commits[index - 1]?.pushStatus
            ? { separatorBefore: c.pushStatus === "pushed" ? tr("Publicados", "Pushed") : tr("Sin push", "Unpushed") } : {}),
        }))
      : categories.map((c) => ({ label: `${labels[c]} (${state.pending[c].length})` }));
  const sourceTitle =
    source?.kind === "commit"
      ? `${source.commit.shortHash}${source.commit.parents.length > 1 ? tr(" · merge: primer padre", " · merge: first parent") : source.commit.parents.length === 0 ? tr(" · árbol vacío", " · empty tree") : ""}`
      : source
        ? labels[source.kind]
        : tr("Sin selección", "No selection");
  const loading = state.loading || state.filesLoading || state.diffLoading;
  const location = editorLocation(state);
  return (
    <Box flexDirection="column" width={size.width}>
      <Text bold>
        {fit(
          `Diffora · ${state.mode === "history" ? tr("Historial", "History") : tr("Pendientes", "Pending")} · ${repo.root}`,
          size.width,
        )}
      </Text>
      {state.overlay !== "none" ? <Panel title={state.overlay === "help" ? tr("Ayuda · Esc volver", "Help · Esc back") : state.overlay === "tasks" ? tr("Tareas abiertas · Esc volver", "Open tasks · Esc back") : tr("Resumen de revisión · Esc volver", "Review summary · Esc back")} active width={size.width} height={height}>
        <WorkflowPanel state={state} width={size.width - 2} rows={rows} />
      </Panel> : <Box>
        {!expanded && (!narrow || state.panel === 0) && (
          <Panel
            title={
              state.mode === "history"
                ? state.commits.length > 30 ? tr("Commits y tareas anteriores", "Commits and older tasks") : tr("Últimos 30 commits", "Latest 30 commits")
                : tr("Cambios pendientes", "Pending changes")
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
              empty={state.loading ? tr("Cargando…", "Loading…") : tr("Historial vacío", "No commits")}
            />
          </Panel>
        )}
        {!expanded && (!narrow || state.panel === 1) && (
          <Panel
            title={`${tr("Archivos", "Files")} · ${reviewedCount}/${state.files.length} ✓${needsReviewCount ? ` · ${needsReviewCount} !` : ""}${state.onlyRemaining ? tr(" · Solo pendientes", " · Unfinished only") : ""} · ${sourceTitle}`}
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
                state.filesLoading ? tr("Cargando…", "Loading…") : state.onlyRemaining ? tr("Sin pendientes en este filtro", "No unfinished files in this filter") : state.searchQuery ? tr("Sin coincidencias", "No matches") : tr("Sin archivos modificados", "No changed files")
              }
            />
          </Panel>
        )}
        {(!narrow || state.panel === 2) && (
          <Panel
            title={`Diff · ${fileStatus === "needs-review" ? "! " : fileStatus === "reviewed" ? "✓ " : ""}${file?.path ?? sourceTitle}${split ? tr(" · Paralelo", " · Side by side") : ""}`}
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
                    ? tr("Cargando diferencia…", "Loading diff…")
                    : file
                      ? tr("Sin cambios textuales (solo metadatos).", "No text changes (metadata only).")
                      : tr("Selecciona un archivo", "Select a file"),
                  diffWidth - 2,
                )}
              </Text>
            )}
          </Panel>
        )}
      </Box>}
      {state.noteEditing && <>
        <Text color="#ff9e45">{fit(tr("Nota · Enter guardar · Esc cancelar · Ctrl+U borrar", "Note · Enter save · Esc cancel · Ctrl+U clear"), size.width)}</Text>
        <Text>{fit(`${Array.from(state.noteDraft).slice(-Math.max(1, Math.floor((size.width - 2) / 2))).join("")}▏`, size.width)}</Text>
      </>}
      <Text>
        {fit(shortcutHint(state, size.width), size.width)}
      </Text>
      <Text {...(state.error ? { color: "red" } : { dimColor: true })}>
        {fit(
          (resizing ? tr(`Anchos: commits ${leftWidth} · archivos ${filesWidth} · diff ${diffWidth}`, `Widths: commits ${leftWidth} · files ${filesWidth} · diff ${diffWidth}`) : "") || state.error || state.storageWarning || state.notice ||
            `${state.diff?.truncated ? tr("AVISO: diff truncado · ", "WARNING: diff truncated · ") : ""}${loading ? tr("Cargando…", "Loading…") : tr("Listo", "Ready")} · ${sourceTitle} · ${tr("panel", "panel")} ${state.panel + 1}/3 · ${state.searchQuery || state.onlyRemaining ? tr(`${visible.length}/${state.files.length} encontrados · `, `${visible.length}/${state.files.length} found · `) : ""}${state.diff?.image ? tr("imagen · v anterior/nueva", "image · v before/after") : tr(`filas ${state.diff?.lines.length ? state.scroll + 1 : 0}/${diffRowCount(state)} · ${split ? "paralelo" : "unificado"}`, `rows ${state.diff?.lines.length ? state.scroll + 1 : 0}/${diffRowCount(state)} · ${split ? "side by side" : "unified"}`)}${location ? ` · e L${location.line}` : ""}`,
          size.width,
        )}
      </Text>
    </Box>
  );
}
