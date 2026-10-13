import React from "react";
import { Box, Text } from "ink";
import { fit } from "./text.js";
import { safeText } from "../core/diff.js";
import { summary, reviewTasks } from "../application/reviewWorkflow.js";
import { selectedSource, labels, type State } from "../application/state.js";

export function WorkflowPanel({ state, width, rows }: { state: State; width: number; rows: number }) {
  if (state.overlay === "help") {
    const items = [
      "m terminado (verde) · n pendiente (naranja)",
      "c escribir/editar nota · Enter guardar",
      "f solo lo que falta · ] siguiente archivo",
      "j / k bloque siguiente / anterior",
      "s diff unificado / paralelo",
      "e abrir archivo:línea en el editor",
      "t todas las tareas abiertas",
      "i resumen · E exportar Markdown",
      "/ buscar archivos · Ctrl+U borrar",
      "h historial · w pendientes · r actualizar",
      "Enter abrir · Tab cambiar panel · Esc volver",
      "↑ commit sin push · --- separa publicados",
      "q guardar y salir · Ctrl+C salir",
      "Estado local · cambios externos cada 2 s",
    ];
    return <Box flexDirection="column" width={width}>{items.slice(0, rows).map((item) => <Text key={item}>{fit(item, width)}</Text>)}</Box>;
  }
  if (state.overlay === "summary") {
    const counts = summary(state);
    const source = selectedSource(state);
    return <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Text color="cyan">{fit(source?.kind === "commit" ? `${source.commit.shortHash} · ${source.commit.title}` : source ? labels[source.kind] : "Sin selección", width)}</Text>
      {state.loading || state.filesLoading ? <Text dimColor>Validando y cargando archivos…</Text> : <>
        <Text bold>{counts.total} archivos en este ámbito</Text>
        <Text color="green">● {counts.reviewed} terminados</Text>
        <Text color="#ff9e45">● {counts.needsReview} pendientes</Text>
        <Text dimColor>· {counts.unreviewed} sin revisar</Text>
      </>}
      <Text>{fit(`${reviewTasks(state).length} tareas abiertas en el repositorio · t ver`, width)}</Text>
      <Text dimColor>{fit("Incluye todos los archivos, sin filtros.", width)}</Text>
      <Text color="cyan">{fit("E exportar Markdown · Esc volver", width)}</Text>
      {state.lastReport && <><Text bold>Último informe:</Text><Text>{safeText(state.lastReport)}</Text></>}
    </Box>;
  }
  const tasks = reviewTasks(state);
  const capacity = Math.max(1, Math.floor((rows - 5) / 2));
  const index = Math.max(0, Math.min(state.taskIndex, tasks.length - 1));
  const offset = Math.max(0, index - capacity + 1);
  const selected = tasks[index];
  return <Box flexDirection="column" width={width} height={rows} overflow="hidden">
    <Text dimColor>{fit(`${tasks.length} tareas · ↑↓ seleccionar · Enter abrir`, width)}</Text>
    {!tasks.length && <Text color="green">No hay tareas abiertas.</Text>}
    {tasks.slice(offset, offset + capacity).map((task, position) => <Box flexDirection="column" key={task.key}>
      <Text color={task.pending ? "#ff9e45" : "gray"} bold={offset + position === index}>{fit(`${offset + position === index ? "›" : " "} ${task.pending ? "●" : "·"} ${task.path}`, width)}</Text>
      <Text dimColor>{fit(`  ${task.kind === "commit" ? task.commit.slice(0, 8) : labels[task.kind]}${task.stale ? " · contenido cambiado" : ""}`, width)}</Text>
    </Box>)}
    {selected && <Box flexDirection="column" width={width} height={Math.max(1, Math.min(4, rows - 1 - 2 * Math.min(capacity, tasks.length)))} overflow="hidden">
      <Text color="cyan">{fit(selected.stale ? "Nota obsoleta · volver a revisar" : "Nota pendiente", width)}</Text>
      <Text>{fit(selected.note || "(sin nota; abre el diff y pulsa c)", width * 3)}</Text>
    </Box>}
  </Box>;
}
