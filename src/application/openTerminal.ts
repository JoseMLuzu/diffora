import { execFile } from "node:child_process";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
export function shellQuote(value: string): string {
  if (value.includes("\0"))
    throw new Error("Las rutas no pueden contener NUL.");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function terminalCommand(
  repo: string,
  node: string,
  cli: string,
): string {
  // Terminal.app runs a .command file through a shell; quote each argument literally.
  // Git itself is still executed by Repository via spawn with separate arguments.
  return `cd -- ${shellQuote(repo)} && ${[shellQuote(node), shellQuote(cli), "--repo", shellQuote(repo)].join(" ")}`;
}
export async function createLaunchFile(
  repo: string,
  node: string,
  cli: string,
): Promise<{ file: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "diffora-"));
  const file = join(directory, "Diffora.command");
  const script = `#!/bin/sh\n${terminalCommand(repo, node, cli)}\nreview_exit_status=$?\n/bin/rm -- ${shellQuote(file)}\n/bin/rmdir -- ${shellQuote(directory)}\nexit "$review_exit_status"\n`;
  try {
    await writeFile(file, script, { mode: 0o700, flag: "wx" });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { file, directory };
}
export async function openTerminal(repo: string): Promise<void> {
  if (process.platform !== "darwin")
    throw new Error(
      "--open requiere macOS y Terminal.app. En este sistema abre diffora directamente en una terminal interactiva.",
    );
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  try {
    await access(cli);
  } catch {
    throw new Error("Compila primero con npm run build para usar --open.");
  }
  const launch = await createLaunchFile(repo, process.execPath, cli);
  try {
    await execute(
      "/usr/bin/open",
      ["-a", "/System/Applications/Utilities/Terminal.app", launch.file],
      { timeout: 10_000, maxBuffer: 8192 },
    );
  } catch (error) {
    await rm(launch.directory, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo abrir Terminal.app desde este entorno. Ejecuta diffora directamente en una terminal local. ${detail}`,
    );
  }
}
