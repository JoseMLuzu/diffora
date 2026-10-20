import { open, readlink, lstat, realpath } from "node:fs/promises";
import { fingerprint } from "./fingerprint.js";
import { resolve, relative, isAbsolute, sep } from "node:path";
import type {
  Category,
  ChangedFile,
  Commit,
  Diff,
  ImageDiff,
  Source,
} from "../core/models.js";
import { decodeImage, isImagePath, MAX_IMAGE_BYTES } from "../images/decode.js";
import { addedContent, parseDiff, safeText } from "../core/diff.js";
import { tr } from "../core/i18n.js";
import {
  GitError,
  MAX_DIFF_BYTES,
  MAX_QUERY_BYTES,
  runGit,
  runGitBytes,
} from "./runner.js";
const diffFlags = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--find-renames",
  "--ignore-submodules=none",
];
export function parseNames(text: string): ChangedFile[] {
  const tokens = text.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) continue;
    const first = tokens[i++];
    if (first === undefined) throw new Error(tr("Lista de archivos incompleta.", "Incomplete file list."));
    if (/^[RC]/.test(status)) {
      const path = tokens[i++];
      if (path === undefined) throw new Error(tr("Renombre incompleto.", "Incomplete rename."));
      files.push({ status, path, oldPath: first });
    } else files.push({ status, path: first });
  }
  return files;
}
export class Repository {
  constructor(public readonly root: string) {}
  static async discover(path: string): Promise<Repository> {
    const result = await runGit(resolve(path), ["rev-parse", "--show-toplevel"]).catch((error: unknown) => {
      if (error instanceof GitError && /not a git repository/i.test(error.message))
        throw new GitError(tr("La carpeta no es un repositorio Git.", "The directory is not a Git repository."), error.code);
      throw error;
    });
    return new Repository(await realpath(result.text.replace(/\r?\n$/, "")));
  }
  async hasHead(signal?: AbortSignal): Promise<boolean> {
    try {
      await runGit(
        this.root,
        ["rev-parse", "--verify", "HEAD"],
        MAX_QUERY_BYTES,
        false,
        signal,
      );
      return true;
    } catch (error) {
      if (error instanceof GitError && error.code === 128) return false;
      throw error;
    }
  }
  async fingerprint(source: Source, file: ChangedFile, signal?: AbortSignal): Promise<string> {
    return fingerprint(this.root, source, file, signal);
  }
  async commit(hash: string, signal?: AbortSignal): Promise<Commit> {
    if (!/^[a-f0-9]{3,64}$/.test(hash)) throw new Error(tr("Hash de commit inválido.", "Invalid commit hash."));
    const { text } = await runGit(this.root, ["show", "--no-patch", "--no-show-signature",
      "--format=%H%x00%h%x00%s%x00%cs%x00%P", hash, "--"], MAX_QUERY_BYTES, false, signal);
    const fields = text.trimEnd().split("\0");
    if (fields.length !== 5) throw new Error(tr("Commit no disponible.", "Commit unavailable."));
    const commits = await this.withPushStatus([{ hash: fields[0]!, shortHash: fields[1]!, title: fields[2]!, date: fields[3]!, parents: fields[4]!.split(" ").filter(Boolean) }], signal);
    return commits[0]!;
  }
  async commits(signal?: AbortSignal): Promise<Commit[]> {
    if (!(await this.hasHead(signal))) return [];
    const { text } = await runGit(
      this.root,
      [
        "log",
        "--no-show-signature",
        "-30",
        "--format=%H%x00%h%x00%s%x00%cs%x00%P",
        "-z",
      ],
      MAX_QUERY_BYTES,
      false,
      signal,
    );
    const fields = text.split("\0");
    const commits: Commit[] = [];
    for (let i = 0; i + 4 < fields.length; i += 5) {
      const hash = fields[i];
      if (hash)
        commits.push({
          hash,
          shortHash: fields[i + 1]!,
          title: fields[i + 2]!,
          date: fields[i + 3]!,
          parents: fields[i + 4]!.split(" ").filter(Boolean),
        });
    }
    return this.withPushStatus(commits, signal);
  }
  private async withPushStatus(commits: Commit[], signal?: AbortSignal): Promise<Commit[]> {
    if (!commits.length) return commits;
    let upstream: string | undefined;
    try {
      upstream = (await runGit(this.root, ["rev-parse", "--verify", "--quiet", "@{upstream}"],
        MAX_QUERY_BYTES, false, signal)).text.trim();
    } catch (error) {
      if (!(error instanceof GitError && error.code === 1)) throw error;
    }
    // Compare with the configured upstream, or all remote-tracking refs when
    // the branch has none. Without remote refs, every local commit is unpushed.
    // Anchor to the loaded commit: HEAD may change while the viewer is querying.
    // Excluding published ancestry only removes entries from this same history.
    const result = await runGit(this.root, ["rev-list", `--max-count=${commits.length}`, commits[0]!.hash, "--not",
      ...(upstream ? [upstream] : ["--remotes"]), "--"], MAX_QUERY_BYTES, false, signal);
    const unpushed = new Set(result.text.trim().split("\n"));
    return commits.map((commit) => ({ ...commit, pushStatus: unpushed.has(commit.hash) ? "unpushed" : "pushed" }));
  }
  async files(source: Source, signal?: AbortSignal): Promise<ChangedFile[]> {
    if (source.kind === "untracked") {
      const { text } = await runGit(
        this.root,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        MAX_QUERY_BYTES,
        false,
        signal,
      );
      return text
        .split("\0")
        .filter(Boolean)
        .map((path) => ({ path, status: "?" }));
    }
    const args =
      source.kind === "commit"
        ? source.commit.parents.length
          ? ["diff", source.commit.parents[0]!, source.commit.hash]
          : ["diff-tree", "--root", "--no-commit-id", "-r", source.commit.hash]
        : ["diff", ...(source.kind === "staged" ? ["--cached"] : [])];
    return parseNames(
      (
        await runGit(
          this.root,
          [...args, ...diffFlags, "--name-status", "-z", "--"],
          MAX_QUERY_BYTES,
          false,
          signal,
        )
      ).text,
    );
  }
  async pending(
    signal?: AbortSignal,
  ): Promise<Record<Category, ChangedFile[]>> {
    const [unstaged, staged, untracked] = await Promise.all(
      ["unstaged", "staged", "untracked"].map((kind) =>
        this.files({ kind: kind as Category }, signal),
      ),
    );
    return { unstaged: unstaged!, staged: staged!, untracked: untracked! };
  }
  async diff(
    source: Source,
    file: ChangedFile,
    signal?: AbortSignal,
  ): Promise<Diff> {
    if (isImagePath(file.path) || (file.oldPath && isImagePath(file.oldPath)))
      return this.imageDiff(source, file, signal);
    if (source.kind === "untracked") return this.untracked(file.path, signal);
    const args =
      source.kind === "commit"
        ? source.commit.parents.length
          ? ["diff", source.commit.parents[0]!, source.commit.hash]
          : ["diff-tree", "--root", "--no-commit-id", "-r", source.commit.hash]
        : ["diff", ...(source.kind === "staged" ? ["--cached"] : [])];
    const result = await runGit(
      this.root,
      [
        ...args,
        ...diffFlags,
        "--patch",
        "--unified=3",
        "--",
        ...(file.oldPath ? [file.oldPath] : []),
        file.path,
      ],
      MAX_DIFF_BYTES,
      true,
      signal,
    );
    return parseDiff(result.text, result.truncated);
  }
  private async imageDiff(
    source: Source,
    file: ChangedFile,
    signal?: AbortSignal,
  ): Promise<Diff> {
    const images: ImageDiff = {
      beforeNotice: tr("No existe versión anterior (archivo añadido).", "No previous version (added file)."),
      afterNotice: tr("No existe versión nueva (archivo eliminado).", "No new version (deleted file)."),
    };
    const oldPath = file.oldPath ?? file.path;
    for (const side of ["before", "after"] as const) {
      if (
        (side === "before" &&
          (source.kind === "untracked" ||
            file.status.startsWith("A") ||
            (source.kind === "commit" && !source.commit.parents.length))) ||
        (side === "after" && file.status.startsWith("D"))
      )
        continue;
      try {
        let data: Buffer;
        if (
          side === "after" &&
          (source.kind === "unstaged" || source.kind === "untracked")
        )
          data = await this.imageFile(file.path, signal);
        else {
          const path = side === "before" ? oldPath : file.path;
          const ref =
            source.kind === "commit"
              ? side === "before"
                ? source.commit.parents[0]!
                : source.commit.hash
              : source.kind === "unstaged"
                ? ""
                : side === "before"
                  ? "HEAD"
                  : "";
          data = (
            await runGitBytes(
              this.root,
              ["cat-file", "blob", `${ref}:${path}`],
              MAX_IMAGE_BYTES,
              false,
              signal,
            )
          ).data;
        }
        images[side] = await decodeImage(data, signal);
        images[side === "before" ? "beforeNotice" : "afterNotice"] = "";
      } catch (error) {
        signal?.throwIfAborted();
        images[side === "before" ? "beforeNotice" : "afterNotice"] = safeText(
          tr(`No se puede previsualizar: ${error instanceof Error ? error.message : String(error)}`, `Cannot preview: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }
    const lines = [
      {
        kind: "meta" as const,
        text: tr("Imagen · abre el visor interactivo para verla; v alterna anterior/nueva.", "Image · open the interactive viewer to see it; v switches before/after."),
      },
    ];
    for (const side of ["before", "after"] as const) {
      const img = images[side];
      lines.push({
        kind: "meta",
        text: `${side === "before" ? tr("Anterior", "Before") : tr("Nueva", "After")}: ${img ? `${img.format.toUpperCase()} ${img.width}×${img.height} · ${img.bytes} bytes` : images[side === "before" ? "beforeNotice" : "afterNotice"]}`,
      });
    }
    return { lines, binary: true, truncated: false, image: images };
  }
  private async imageFile(path: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error(tr("Ruta fuera del repositorio.", "Path outside the repository."));
    const stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(tr("La vista previa requiere un archivo regular.", "Preview requires a regular file."));
    if (stat.size > MAX_IMAGE_BYTES)
      throw new Error(tr("La imagen supera el límite de 10 MiB.", "The image exceeds the 10 MiB limit."));
    const handle = await open(full, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_IMAGE_BYTES) + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_IMAGE_BYTES)
        throw new Error(tr("La imagen supera el límite de 10 MiB.", "The image exceeds the 10 MiB limit."));
      signal?.throwIfAborted();
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  private async untracked(path: string, signal?: AbortSignal): Promise<Diff> {
    signal?.throwIfAborted();
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error(tr("Ruta fuera del repositorio.", "Path outside the repository."));
    const stat = await lstat(full);
    if (stat.isSymbolicLink())
      return addedContent(Buffer.from(await readlink(full)), false);
    if (!stat.isFile())
      return {
        lines: [{ kind: "meta", text: tr("No es un archivo regular.", "Not a regular file.") }],
        binary: false,
        truncated: false,
      };
    const handle = await open(full, "r");
    try {
      const buffer = Buffer.alloc(MAX_DIFF_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return addedContent(
        buffer.subarray(0, Math.min(bytesRead, MAX_DIFF_BYTES)),
        bytesRead > MAX_DIFF_BYTES,
      );
    } finally {
      await handle.close();
    }
  }
}
