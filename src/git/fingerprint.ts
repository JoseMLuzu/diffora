import { constants } from "node:fs";
import { open, lstat, readlink, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { ChangedFile, Source } from "../core/models.js";
import { identityKey } from "../core/progress.js";
import { inside } from "../application/progressStore.js";
import { runGitBytes } from "./runner.js";
import { tr } from "../core/i18n.js";

export const MAX_FINGERPRINT_BYTES = 64 * 1024 * 1024;
/** Hash complete bytes, not a truncated patch or decoded image thumbnail. */
export async function fingerprint(root: string, source: Source, file: ChangedFile, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash("sha256").update(identityKey(source, file));
  if (source.kind === "commit") return hash.digest("hex");
  if (source.kind !== "untracked") {
    const raw = await runGitBytes(root, ["diff", ...(source.kind === "staged" ? ["--cached"] : []),
      "--raw", "--no-abbrev", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames",
      "--ignore-submodules=none", "-z", "--", ...(file.oldPath ? [file.oldPath] : []), file.path],
      undefined, false, signal);
    hash.update(raw.data);
  }
  if ((source.kind === "unstaged" || source.kind === "untracked") && !file.status.startsWith("D")) {
    const full = resolve(root, file.path);
    if (!inside(root, full) || !inside(await realpath(root), await realpath(dirname(full))))
      throw new Error(tr("No se puede validar una ruta fuera del repositorio.", "Cannot verify a path outside the repository."));
    const stat = await lstat(full, { bigint: true });
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(await readlink(full));
    else {
      if (!stat.isFile() || stat.size > BigInt(MAX_FINGERPRINT_BYTES))
        throw new Error(tr("Validación limitada a archivos regulares de hasta 64 MiB.", "Verification is limited to regular files up to 64 MiB."));
      const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      const timeout = AbortSignal.timeout(10_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let position = 0;
        for (;;) {
          combined.throwIfAborted();
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          position += bytesRead;
          if (position > MAX_FINGERPRINT_BYTES) throw new Error(tr("El archivo creció durante la validación.", "The file grew during verification."));
          hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat({ bigint: true });
        if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs)
          throw new Error(tr("El archivo cambió durante la validación.", "The file changed during verification."));
      } finally { await handle.close(); }
    }
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}
