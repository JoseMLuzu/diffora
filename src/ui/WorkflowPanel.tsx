import React from "react";
import { Box, Text } from "ink";
import { fit } from "./text.js";
import { safeText } from "../core/diff.js";
import { summary, reviewTasks } from "../application/reviewWorkflow.js";
import { selectedSource, labels, type State } from "../application/state.js";
import { tr } from "../core/i18n.js";

export function WorkflowPanel({ state, width, rows }: { state: State; width: number; rows: number }) {
  if (state.overlay === "help") {
    const items = [
      { text: tr("NAVEGAR", "NAVIGATE"), heading: true },
      { text: tr("↑↓ elegir o desplazar · Enter abrir", "↑↓ select or scroll · Enter open") },
      { text: tr("Tab cambiar panel · Esc volver", "Tab switch panel · Esc back") },
      { text: tr("h historial · w pendientes", "h history · w pending") },
      { text: tr("r actualizar · / buscar archivos", "r refresh · / find files") },
      { text: tr("↑ en un commit = sin push", "↑ on a commit = unpushed") },
      { text: tr("REVISAR", "REVIEW"), heading: true },
      { text: tr("m terminado · n revisar", "m done · n needs review") },
      { text: tr("c nota · f solo pendientes", "c note · f unfinished only") },
      { text: tr("] siguiente archivo · e editor", "] next file · e editor") },
      { text: tr("DIFERENCIAS", "DIFFS"), heading: true },
      { text: tr("j/k bloques · s vista paralela", "j/k hunks · s side by side") },
      { text: tr("v imagen anterior/nueva", "v before/after image") },
      { text: tr("MÁS", "MORE"), heading: true },
      { text: tr("t tareas · i resumen", "t tasks · i summary") },
      { text: tr("E exportar Markdown", "E export Markdown") },
      { text: tr("q guardar y salir · Ctrl+C salir", "q save and quit · Ctrl+C quit") },
    ];
    return <Box flexDirection="column" width={width}>{items.slice(0, rows).map((item) =>
      <Text key={item.text} bold={!!item.heading} {...(item.heading ? { color: "cyan" } : {})}>{fit(item.text, width)}</Text>,
    )}</Box>;
  }
  if (state.overlay === "summary") {
    const counts = summary(state);
    const source = selectedSource(state);
    return <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Text color="cyan">{fit(source?.kind === "commit" ? `${source.commit.shortHash} · ${source.commit.title}` : source ? labels[source.kind] : tr("Sin selección", "No selection"), width)}</Text>
      {state.loading || state.filesLoading ? <Text dimColor>{tr("Validando y cargando archivos…", "Checking and loading files…")}</Text> : <>
        <Text bold>{counts.total} {tr("archivos en este ámbito", "files in this scope")}</Text>
        <Text color="green">● {counts.reviewed} {tr("terminados", "done")}</Text>
        <Text color="#ff9e45">● {counts.needsReview} {tr("pendientes", "need review")}</Text>
        <Text dimColor>· {counts.unreviewed} {tr("sin revisar", "unreviewed")}</Text>
      </>}
      <Text>{fit(tr(`${reviewTasks(state).length} tareas abiertas en el repositorio · t ver`, `${reviewTasks(state).length} open tasks in repository · t view`), width)}</Text>
      <Text dimColor>{fit(tr("Incluye todos los archivos, sin filtros.", "Includes all files, ignoring filters."), width)}</Text>
      <Text color="cyan">{fit(tr("E exportar Markdown · Esc volver", "E export Markdown · Esc back"), width)}</Text>
      {state.lastReport && <><Text bold>{tr("Último informe:", "Latest report:")}</Text><Text>{safeText(state.lastReport)}</Text></>}
    </Box>;
  }
  const tasks = reviewTasks(state);
  const capacity = Math.max(1, Math.floor((rows - 5) / 2));
  const index = Math.max(0, Math.min(state.taskIndex, tasks.length - 1));
  const offset = Math.max(0, index - capacity + 1);
  const selected = tasks[index];
  return <Box flexDirection="column" width={width} height={rows} overflow="hidden">
    <Text dimColor>{fit(tr(`${tasks.length} tareas · ↑↓ seleccionar · Enter abrir`, `${tasks.length} tasks · ↑↓ select · Enter open`), width)}</Text>
    {!tasks.length && <Text color="green">{tr("No hay tareas abiertas.", "No open tasks.")}</Text>}
    {tasks.slice(offset, offset + capacity).map((task, position) => <Box flexDirection="column" key={task.key}>
      <Text color={task.pending ? "#ff9e45" : "gray"} bold={offset + position === index}>{fit(`${offset + position === index ? "›" : " "} ${task.pending ? "●" : "·"} ${task.path}`, width)}</Text>
      <Text dimColor>{fit(`  ${task.kind === "commit" ? task.commit.slice(0, 8) : labels[task.kind]}${task.stale ? tr(" · contenido cambiado", " · content changed") : ""}`, width)}</Text>
    </Box>)}
    {selected && <Box flexDirection="column" width={width} height={Math.max(1, Math.min(4, rows - 1 - 2 * Math.min(capacity, tasks.length)))} overflow="hidden">
      <Text color="cyan">{fit(selected.stale ? tr("Nota obsoleta · volver a revisar", "Outdated note · review again") : tr("Nota pendiente", "Pending note"), width)}</Text>
      <Text>{fit(selected.note || tr("(sin nota; abre el diff y pulsa c)", "(no note; open diff and press c)"), width * 3)}</Text>
    </Box>}
  </Box>;
}
