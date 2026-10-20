import { safeText } from "../core/diff.js";
import { selectedSource, labels, fileReviewStatus, reviewKey, type State } from "./state.js";
import { summary, reviewTasks } from "./reviewWorkflow.js";
import { tr } from "../core/i18n.js";

export function markdownText(text: string): string {
  return safeText(text).replace(/\r?\n/g, " ").replace(/[\\`*_\[\]<>#|]/g, (char) => "\\" + char);
}
export function reviewReport(root: string, s: State, date = new Date()): string {
  const source = selectedSource(s);
  const counts = summary(s);
  const scope = source?.kind === "commit" ? `Commit ${source.commit.hash} — ${source.commit.title}`
    : source ? labels[source.kind] : tr("Sin selección", "No selection");
  const lines = [
    tr("# Informe de revisión", "# Review report"), "",
    tr(`Repositorio: ${markdownText(root)}`, `Repository: ${markdownText(root)}`),
    tr(`Fecha: ${date.toISOString()}`, `Date: ${date.toISOString()}`),
    tr(`Ámbito: ${markdownText(scope)}`, `Scope: ${markdownText(scope)}`), "",
    tr("## Resumen del ámbito seleccionado", "## Selected scope summary"), "",
    tr(`${counts.total} archivos · ${counts.reviewed} terminados · ${counts.needsReview} pendientes · ${counts.unreviewed} sin revisar.`, `${counts.total} files · ${counts.reviewed} done · ${counts.needsReview} need review · ${counts.unreviewed} unreviewed.`),
    "", tr("Las marcas son decisiones del usuario, no una verificación automática de calidad.", "Review marks are user decisions, not an automatic quality check."),
    tr("El resumen usa todos los archivos del ámbito, independientemente de la búsqueda o del filtro.", "The summary includes all files in the scope, regardless of search or filters."), "",
    tr("## Archivos", "## Files"), "",
  ];
  const statusLabels = { reviewed: tr("Terminado", "Done"), "needs-review": tr("Pendiente", "Needs review"), unreviewed: tr("Sin revisar", "Unreviewed") };
  for (const file of s.files) {
    const note = s.notes[reviewKey(s, file)];
    lines.push(`- ${markdownText(file.path)} — ${statusLabels[fileReviewStatus(s, file)]} (${markdownText(file.status)})`);
    if (file.oldPath) lines.push(tr(`  - Origen: ${markdownText(file.oldPath)}`, `  - From: ${markdownText(file.oldPath)}`));
    if (note) lines.push(tr(`  - Nota${note.stale ? " obsoleta: contenido cambiado" : ""}: ${markdownText(note.text)}`, `  - Note${note.stale ? " outdated: content changed" : ""}: ${markdownText(note.text)}`));
  }
  if (!s.files.length) lines.push(tr("Sin archivos en este ámbito.", "No files in this scope."));
  lines.push("", tr("## Todas las tareas abiertas del repositorio", "## All open tasks in the repository"), "");
  for (const task of reviewTasks(s)) {
    lines.push(`- ${markdownText(task.path)} · ${task.kind === "commit" ? `commit ${task.commit}` : labels[task.kind]}${task.stale ? tr(" · Obsoleta: volver a revisar", " · Outdated: review again") : ""}`);
    lines.push(`  - ${markdownText(task.note || tr("(sin nota)", "(no note)"))}`);
  }
  if (!reviewTasks(s).length) lines.push(tr("No hay tareas abiertas.", "No open tasks."));
  return lines.join("\n") + "\n";
}
