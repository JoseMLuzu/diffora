import { constants } from "node:fs";
import { open, mkdir, realpath, rename, rm, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { emptyProgress, parseIdentity, type Progress, type ReviewNote } from "../core/progress.js";
import { safeText } from "../core/diff.js";
import { tr } from "../core/i18n.js";

export const MAX_PROGRESS_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateProgress(value: unknown, root: string): Progress {
  if (!object(value) || value.version !== 1 || value.root !== root)
    throw new Error(tr("El archivo de progreso tiene una versión o repositorio diferente.", "The progress file has a different version or repository."));
  const result = emptyProgress();
  for (const field of ["reviewed", "needsReview"] as const) {
    const list = value[field];
    if (!Array.isArray(list) || list.length > MAX_ENTRIES || list.some((key) => typeof key !== "string" || !parseIdentity(key)))
      throw new Error(tr("Marcas de revisión inválidas.", "Invalid review marks."));
    result[field] = [...new Set(list as string[])];
  }
  result.reviewed = result.reviewed.filter((key) => !result.needsReview.includes(key));
  for (const field of ["notes", "fingerprints", "commitReviewKeys"] as const) {
    const map = value[field];
    if (!object(map) || Object.keys(map).length > MAX_ENTRIES)
      throw new Error(tr("Datos de revisión inválidos o excesivos.", "Invalid or excessive review data."));
    for (const [key, entry] of Object.entries(map)) {
      if (field === "commitReviewKeys") {
        if (!/^[a-f0-9]{3,64}$/.test(key) || !Array.isArray(entry) || entry.length > MAX_ENTRIES
          || entry.some((k) => typeof k !== "string" || parseIdentity(k)?.kind !== "commit" || parseIdentity(k)?.commit !== key))
          throw new Error(tr("Resumen de commit inválido.", "Invalid commit summary."));
        result.commitReviewKeys[key] = [...new Set(entry as string[])];
      } else {
        if (!parseIdentity(key)) throw new Error(tr("Identidad de archivo inválida.", "Invalid file identity."));
        if (field === "fingerprints") {
          if (typeof entry !== "string" || !/^[a-f0-9]{64}$/.test(entry)) throw new Error(tr("Huella inválida.", "Invalid fingerprint."));
          result.fingerprints[key] = entry;
        } else {
          if (!object(entry) || typeof entry.text !== "string" || entry.text.length > 4000 || typeof entry.stale !== "boolean")
            throw new Error(tr("Nota inválida.", "Invalid note."));
          result.notes[key] = { text: safeText(entry.text), stale: entry.stale } satisfies ReviewNote;
        }
      }
    }
  }
  if (value.diffLayout !== "unified" && value.diffLayout !== "split") throw new Error(tr("Vista inválida.", "Invalid view."));
  result.diffLayout = value.diffLayout;
  return result;
}

/** Local state only: never creates files in the reviewed repository. */
export class ProgressStore {
  readonly directory: string;
  readonly file: string;
  readonly repoId: string;
  private queue: Promise<void> = Promise.resolve();
  private writable = true;
  private lastSaved = "";
  private diskVersion = "";
  constructor(readonly root: string, directory = process.env.DIFFORA_STATE_DIR ?? process.env.TERMINAL_REVIEW_STATE_DIR
    ?? join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "terminal-review")) {
    this.directory = resolve(directory);
    this.repoId = createHash("sha256").update(root).digest("hex");
    this.file = join(this.directory, `${this.repoId}.json`);
    if (inside(root, this.directory)) throw new Error(tr("El progreso debe guardarse fuera del repositorio.", "Progress must be saved outside the repository."));
  }
  async load(): Promise<Progress> {
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_PROGRESS_BYTES) throw new Error(tr("Archivo de progreso no regular o excesivo.", "Progress file is not regular or is too large."));
      const buffer = Buffer.alloc(MAX_PROGRESS_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_PROGRESS_BYTES) throw new Error(tr("El progreso creció por encima de 2 MiB.", "Progress grew beyond 2 MiB."));
      const progress = validateProgress(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), this.root);
      this.diskVersion = createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
      this.lastSaved = JSON.stringify({ version: 1, root: this.root, ...progress }, null, 2) + "\n";
      return progress;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProgress();
      this.writable = false; // Never overwrite a corrupt or unsupported state file.
      throw error;
    } finally { await handle?.close(); }
  }
  private async currentVersion(): Promise<string> {
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const buffer = Buffer.alloc(MAX_PROGRESS_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_PROGRESS_BYTES) throw new Error(tr("El estado externo supera 2 MiB.", "External state exceeds 2 MiB."));
      return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    } finally { await handle?.close(); }
  }
  private async prepare(): Promise<void> {
    if (!this.writable) throw new Error(tr("Progreso no guardado: conserva o repara el archivo de estado inválido.", "Progress not saved: preserve or repair the invalid state file."));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (inside(await realpath(this.root), await realpath(this.directory)))
      throw new Error(tr("La carpeta de estado apunta dentro del repositorio.", "The state directory points inside the repository."));
  }
  save(progress: Progress): Promise<void> {
    const json = JSON.stringify({ version: 1, root: this.root, ...progress }, null, 2) + "\n";
    const task = this.queue.catch(() => {}).then(async () => {
      if (json === this.lastSaved) return;
      await this.prepare();
      if (Buffer.byteLength(json) > MAX_PROGRESS_BYTES) throw new Error(tr("El progreso supera 2 MiB; no se sobrescribió.", "Progress exceeds 2 MiB; it was not overwritten."));
      const temporary = join(this.directory, `.${this.repoId}-${randomUUID()}.tmp`);
      const lockPath = join(this.directory, `.${this.repoId}.write-lock`);
      let lock;
      for (let attempt = 0; attempt < 10; attempt++) {
        try { lock = await open(lockPath, "wx", 0o600); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (attempt === 9) throw new Error(tr(`Otro visor está guardando o dejó un bloqueo: ${lockPath}. No se sobrescribió el progreso.`, `Another viewer is saving or left a lock: ${lockPath}. Progress was not overwritten.`));
          await new Promise((done) => setTimeout(done, 25));
        }
      }
      if (!lock) throw new Error(tr("No se pudo bloquear el guardado.", "Could not lock the save operation."));
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, created: new Date().toISOString() }));
        if (await this.currentVersion() !== this.diskVersion)
          throw new Error(tr("Otra ventana modificó el progreso; exporta tus notas con E y vuelve a abrir el visor. No se sobrescribió.", "Another window changed the progress; export your notes with E and reopen the viewer. It was not overwritten."));
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(json); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, this.file);
        this.lastSaved = json;
        this.diskVersion = createHash("sha256").update(json).digest("hex");
      } finally {
        const owned = await lock.stat();
        await lock.close();
        await rm(temporary, { force: true });
        const current = await lstat(lockPath).catch(() => null);
        if (current?.ino === owned.ino) await rm(lockPath, { force: true });
      }
    });
    this.queue = task;
    return task;
  }
  async exportMarkdown(markdown: string): Promise<string> {
    await this.prepare();
    if (Buffer.byteLength(markdown) > MAX_PROGRESS_BYTES) throw new Error(tr("El informe supera 2 MiB.", "The report exceeds 2 MiB."));
    const directory = join(this.directory, "exports", this.repoId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (inside(await realpath(this.root), await realpath(directory))) throw new Error(tr("Exportación dentro del repositorio.", "Export path is inside the repository."));
    const file = join(directory, `review-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.md`);
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(markdown); }
    finally { await handle.close(); }
    return file;
  }
}
