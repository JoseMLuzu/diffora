import type { Category, ChangedFile, Diff, Source } from "../core/models.js";
import { safeText } from "../core/diff.js";
import type { Repository } from "../git/repository.js";
import { categories, labels } from "./state.js";

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
  if (!files.length) return ["Sin archivos modificados."];
  const rows = files
    .slice(offset, offset + limit)
    .map((file, i) => fileLabel(file, offset + i));
  rows.push(
    `Archivos ${rows.length ? offset + 1 : 0}–${rows.length ? Math.min(offset + limit, files.length) : 0} de ${files.length}.`,
  );
  if (offset + limit < files.length)
    rows.push(`Más archivos: --offset ${offset + limit}`);
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
  if (!diff.lines.length) rows.push("Sin cambios textuales (solo metadatos).");
  if (diff.truncated)
    rows.unshift(
      "AVISO: diferencia truncada por el límite de 1 MiB / 10 000 líneas.",
    );
  rows.push(
    `Filas del patch ${rows.length && diff.lines.length ? offset + 1 : 0}–${Math.min(offset + limit, diff.lines.length)} de ${diff.lines.length}.`,
  );
  if (offset + limit < diff.lines.length)
    rows.push(`Continuar con --offset ${offset + limit}`);
  return rows;
}
export async function textReview(
  repo: Repository,
  options: TextOptions,
): Promise<string> {
  const lines = [`Diffora · ${safeText(repo.root)}`];
  if (options.commit && options.source)
    throw new Error("Usa --commit o --source, no ambos.");
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
    lines.push("", "Últimos 30 commits · seleccionar con --commit <hash>");
    lines.push(
      ...commits.map(
        (c) =>
          `${c.shortHash} ${c.date} ${safeText(c.title)}${c.parents.length > 1 ? " (merge: primer padre)" : c.parents.length === 0 ? " (árbol vacío)" : ""}`,
      ),
    );
    if (!commits.length) lines.push("Historial vacío.");
  } else {
    let source: Source = { kind: options.source ?? "unstaged" };
    let title = labels[options.source ?? "unstaged"];
    if (options.commit) {
      if (!/^[0-9a-f]{4,64}$/i.test(options.commit))
        throw new Error(
          "--commit requiere un hash de Git (al menos 4 caracteres).",
        );
      const matches = (await repo.commits()).filter((c) =>
        c.hash.startsWith(options.commit!.toLowerCase()),
      );
      if (matches.length !== 1)
        throw new Error(
          "Commit no encontrado o ambiguo entre los últimos 30 commits.",
        );
      const commit = matches[0]!;
      source = { kind: "commit", commit };
      title = `${commit.shortHash} ${safeText(commit.title)} · ${commit.parents.length > 1 ? "merge: primer padre" : commit.parents.length === 0 ? "árbol vacío" : "comparado con su padre"}`;
    }
    const files = await repo.files(source);
    lines.push("", title);
    if (options.file === undefined)
      lines.push(...fileList(files, options.offset, options.limit));
    else {
      const file = files[options.file - 1];
      if (!file)
        throw new Error(
          `Archivo ${options.file} fuera de rango (hay ${files.length}).`,
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
      "\nAVISO: salida truncada a 65 536 caracteres. Solicita menos filas con --limit.\n"
    );
  return result + "\n";
}
