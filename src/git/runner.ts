import { spawn } from "node:child_process";
export const MAX_DIFF_BYTES = 1024 * 1024;
export const MAX_QUERY_BYTES = 8 * 1024 * 1024;
export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: number | string | null,
  ) {
    super(message);
  }
}
export function runGitBytes(
  cwd: string,
  args: readonly string[],
  limit = MAX_QUERY_BYTES,
  truncate = false,
  signal?: AbortSignal,
): Promise<{ data: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "--no-pager",
        "-c",
        "color.ui=false",
        "-c",
        "core.quotePath=true",
        ...args,
      ],
      {
        cwd,
        shell: false,
        ...(signal ? { signal } : {}),
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_LITERAL_PATHSPECS: "1",
          LC_ALL: "C",
        },
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0,
      exceeded = false,
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new GitError("Git excedió el límite de 15 segundos.", null));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = limit - bytes;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > limit) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096)
        stderr += chunk.toString("utf8").slice(0, 4096 - stderr.length);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new GitError(
          error.code === "ENOENT"
            ? "Git no está instalado o la carpeta no existe."
            : error.message,
          error.code ?? null,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (exceeded && !truncate)
        reject(
          new GitError(
            `La consulta supera el límite de ${limit / (1024 * 1024)} MiB; no se muestra una lista parcial.`,
            null,
          ),
        );
      else if (code !== 0 && !exceeded)
        reject(
          new GitError(
            stderr.trim() || "Git no pudo completar la consulta.",
            code,
          ),
        );
      else
        resolve({
          data: Buffer.concat(chunks),
          truncated: exceeded,
        });
    });
  });
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  limit = MAX_QUERY_BYTES,
  truncate = false,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const result = await runGitBytes(cwd, args, limit, truncate, signal);
  return { text: result.data.toString("utf8"), truncated: result.truncated };
}
