import type { Category, ChangedFile, Diff, Source } from "../core/models.js";
import { safeText } from "../core/diff.js";
import type { Repository } from "../git/repository.js";
import { categories, labels } from "./state.js";
import { tr } from "../core/i18n.js";

export interface TextOptions {
  source?: Category;
  commit?: string;
  file?: number;
  offset: number;
  limit: number;
}
const MAX_REPORT_CHARS = 64 * 1024;
function fileLabel(file: ChangedFile, index: number): string {
  return `${index + 1}. [${file.status}] ${safeText(file.oldPath ? `${file.oldPath} → ${file.path}` : file.path)}`;
}
function fileList(
  files: ChangedFile[],
  offset: number,
  limit: number,
): string[] {
  if (!files.length) return [tr("Sin archivos modificados.", "No changed files.")];
  const rows = files
    .slice(offset, offset + limit)
    .map((file, i) => fileLabel(file, offset + i));
  rows.push(
    tr(`Archivos ${rows.length ? offset + 1 : 0}–${rows.length ? Math.min(offset + limit, files.length) : 0} de ${files.length}.`, `Files ${rows.length ? offset + 1 : 0}–${rows.length ? Math.min(offset + limit, files.length) : 0} of ${files.length}.`),
  );
  if (offset + limit < files.length)
    rows.push(tr(`Más archivos: --offset ${offset + limit}`, `More files: --offset ${offset + limit}`));
  return rows;
}
function diffList(diff: Diff, offset: number, limit: number): string[] {
  const rows = diff.lines.slice(offset, offset + limit).map((line) => {
    if (
      line.kind === "add" ||
      line.kind === "delete" ||
      line.kind === "context"
    ) {
      return `${String(line.old ?? "").padStart(5)} ${String(line.new ?? "").padStart(5)} ${line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "} ${line.text}`;
    }
    return line.text;
  });
  if (!diff.lines.length) rows.push(tr("Sin cambios textuales (solo metadatos).", "No text changes (metadata only)."));
  if (diff.truncated)
    rows.unshift(
      tr("AVISO: diferencia truncada por el límite de 1 MiB / 10 000 líneas.", "WARNING: diff truncated at 1 MiB / 10,000 lines."),
    );
  rows.push(
    tr(`Filas del patch ${rows.length && diff.lines.length ? offset + 1 : 0}–${Math.min(offset + limit, diff.lines.length)} de ${diff.lines.length}.`, `Patch rows ${rows.length && diff.lines.length ? offset + 1 : 0}–${Math.min(offset + limit, diff.lines.length)} of ${diff.lines.length}.`),
  );
  if (offset + limit < diff.lines.length)
    rows.push(tr(`Continuar con --offset ${offset + limit}`, `Continue with --offset ${offset + limit}`));
  return rows;
}
export async function textReview(
  repo: Repository,
  options: TextOptions,
): Promise<string> {
  const lines = [`Diffora · ${safeText(repo.root)}`];
  if (options.commit && options.source)
    throw new Error(tr("Usa --commit o --source, no ambos.", "Use --commit or --source, not both."));
  if (!options.commit && !options.source && options.file === undefined) {
    const [pending, commits] = await Promise.all([
      repo.pending(),
      repo.commits(),
    ]);
    for (const category of categories) {
      lines.push(
        "",
        `${labels[category]} (${pending[category].length}) · --source ${category}`,
        ...fileList(pending[category], options.offset, options.limit),
      );
    }
    lines.push("", tr("Últimos 30 commits · seleccionar con --commit <hash>", "Latest 30 commits · select with --commit <hash>"));
    lines.push(
      ...commits.map(
        (c) =>
          `${c.shortHash} ${c.date} ${safeText(c.title)}${c.parents.length > 1 ? tr(" (merge: primer padre)", " (merge: first parent)") : c.parents.length === 0 ? tr(" (árbol vacío)", " (empty tree)") : ""}`,
      ),
    );
    if (!commits.length) lines.push(tr("Historial vacío.", "No commits."));
  } else {
    let source: Source = { kind: options.source ?? "unstaged" };
    let title = labels[options.source ?? "unstaged"];
    if (options.commit) {
      if (!/^[0-9a-f]{4,64}$/i.test(options.commit))
        throw new Error(
          tr("--commit requiere un hash de Git (al menos 4 caracteres).", "--commit needs a Git hash (at least 4 characters)."),
        );
      const matches = (await repo.commits()).filter((c) =>
        c.hash.startsWith(options.commit!.toLowerCase()),
      );
      if (matches.length !== 1)
        throw new Error(
          tr("Commit no encontrado o ambiguo entre los últimos 30 commits.", "Commit not found or ambiguous among the latest 30 commits."),
        );
      const commit = matches[0]!;
      source = { kind: "commit", commit };
      title = `${commit.shortHash} ${safeText(commit.title)} · ${commit.parents.length > 1 ? tr("merge: primer padre", "merge: first parent") : commit.parents.length === 0 ? tr("árbol vacío", "empty tree") : tr("comparado con su padre", "compared with its parent")}`;
    }
    const files = await repo.files(source);
    lines.push("", title);
    if (options.file === undefined)
      lines.push(...fileList(files, options.offset, options.limit));
    else {
      const file = files[options.file - 1];
      if (!file)
        throw new Error(
          tr(`Archivo ${options.file} fuera de rango (hay ${files.length}).`, `File ${options.file} out of range (${files.length} available).`),
        );
      lines.push(
        fileLabel(file, options.file - 1),
        "",
        ...diffList(
          await repo.diff(source, file),
          options.offset,
          options.limit,
        ),
      );
    }
  }
  const result = lines.join("\n");
  if (result.length > MAX_REPORT_CHARS)
    return (
      result.slice(0, MAX_REPORT_CHARS) +
      tr("\nAVISO: salida truncada a 65 536 caracteres. Solicita menos filas con --limit.\n", "\nWARNING: output truncated at 65,536 characters. Request fewer rows with --limit.\n")
    );
  return result + "\n";
}
