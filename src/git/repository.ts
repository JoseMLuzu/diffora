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
    if (first === undefined) throw new Error("Lista de archivos incompleta.");
    if (/^[RC]/.test(status)) {
      const path = tokens[i++];
      if (path === undefined) throw new Error("Renombre incompleto.");
      files.push({ status, path, oldPath: first });
    } else files.push({ status, path: first });
  }
  return files;
}
export class Repository {
  constructor(public readonly root: string) {}
  static async discover(path: string): Promise<Repository> {
    const result = await runGit(resolve(path), [
      "rev-parse",
      "--show-toplevel",
    ]);
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
    if (!/^[a-f0-9]{3,64}$/.test(hash)) throw new Error("Hash de commit inválido.");
    const { text } = await runGit(this.root, ["show", "--no-patch", "--no-show-signature",
      "--format=%H%x00%h%x00%s%x00%cs%x00%P", hash, "--"], MAX_QUERY_BYTES, false, signal);
    const fields = text.trimEnd().split("\0");
    if (fields.length !== 5) throw new Error("Commit no disponible.");
    return { hash: fields[0]!, shortHash: fields[1]!, title: fields[2]!, date: fields[3]!, parents: fields[4]!.split(" ").filter(Boolean) };
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
    return commits;
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
      beforeNotice: "No existe versión anterior (archivo añadido).",
      afterNotice: "No existe versión nueva (archivo eliminado).",
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
          `No se puede previsualizar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const lines = [
      {
        kind: "meta" as const,
        text: "Imagen · abre el visor interactivo para verla; v alterna anterior/nueva.",
      },
    ];
    for (const side of ["before", "after"] as const) {
      const img = images[side];
      lines.push({
        kind: "meta",
        text: `${side === "before" ? "Anterior" : "Nueva"}: ${img ? `${img.format.toUpperCase()} ${img.width}×${img.height} · ${img.bytes} bytes` : images[side === "before" ? "beforeNotice" : "afterNotice"]}`,
      });
    }
    return { lines, binary: true, truncated: false, image: images };
  }
  private async imageFile(path: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Ruta fuera del repositorio.");
    const stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("La vista previa requiere un archivo regular.");
    if (stat.size > MAX_IMAGE_BYTES)
      throw new Error("La imagen supera el límite de 10 MiB.");
    const handle = await open(full, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_IMAGE_BYTES) + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_IMAGE_BYTES)
        throw new Error("La imagen supera el límite de 10 MiB.");
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
      throw new Error("Ruta fuera del repositorio.");
    const stat = await lstat(full);
    if (stat.isSymbolicLink())
      return addedContent(Buffer.from(await readlink(full)), false);
    if (!stat.isFile())
      return {
        lines: [{ kind: "meta", text: "No es un archivo regular." }],
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
