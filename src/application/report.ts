import { safeText } from "../core/diff.js";
import { selectedSource, labels, fileReviewStatus, reviewKey, type State } from "./state.js";
import { summary, reviewTasks } from "./reviewWorkflow.js";

export function markdownText(text: string): string {
  return safeText(text).replace(/\r?\n/g, " ").replace(/[\\`*_\[\]<>#|]/g, (char) => "\\" + char);
}
export function reviewReport(root: string, s: State, date = new Date()): string {
  const source = selectedSource(s);
  const counts = summary(s);
  const scope = source?.kind === "commit" ? `Commit ${source.commit.hash} — ${source.commit.title}`
    : source ? labels[source.kind] : "Sin selección";
  const lines = [
    "# Informe de revisión", "",
    `Repositorio: ${markdownText(root)}`,
    `Fecha: ${date.toISOString()}`,
    `Ámbito: ${markdownText(scope)}`, "",
    "## Resumen del ámbito seleccionado", "",
    `${counts.total} archivos · ${counts.reviewed} terminados · ${counts.needsReview} pendientes · ${counts.unreviewed} sin revisar.`,
    "", "Las marcas son decisiones del usuario, no una verificación automática de calidad.",
    "El resumen usa todos los archivos del ámbito, independientemente de la búsqueda o del filtro.", "",
    "## Archivos", "",
  ];
  const statusLabels = { reviewed: "Terminado", "needs-review": "Pendiente", unreviewed: "Sin revisar" };
  for (const file of s.files) {
    const note = s.notes[reviewKey(s, file)];
    lines.push(`- ${markdownText(file.path)} — ${statusLabels[fileReviewStatus(s, file)]} (${markdownText(file.status)})`);
    if (file.oldPath) lines.push(`  - Origen: ${markdownText(file.oldPath)}`);
    if (note) lines.push(`  - Nota${note.stale ? " obsoleta: contenido cambiado" : ""}: ${markdownText(note.text)}`);
  }
  if (!s.files.length) lines.push("Sin archivos en este ámbito.");
  lines.push("", "## Todas las tareas abiertas del repositorio", "");
  for (const task of reviewTasks(s)) {
    lines.push(`- ${markdownText(task.path)} · ${task.kind === "commit" ? `commit ${task.commit}` : labels[task.kind]}${task.stale ? " · Obsoleta: volver a revisar" : ""}`);
    lines.push(`  - ${markdownText(task.note || "(sin nota)")}`);
  }
  if (!reviewTasks(s).length) lines.push("No hay tareas abiertas.");
  return lines.join("\n") + "\n";
}
