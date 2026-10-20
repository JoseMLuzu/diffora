import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { inside } from "./progressStore.js";
import { tr } from "../core/i18n.js";

export interface EditorLocation { path: string; line: number; column: number }
/** Quoted argv, not shell syntax: command contents never go through a shell. */
export function commandArgs(command: string): string[] {
  const args: string[] = [];
  let token = "", quote = "", started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === "\\" && quote !== "'") {
      if (++i >= command.length) throw new Error(tr("Escape incompleto en el editor.", "Incomplete escape in editor command."));
      token += command[i]; started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (/\s/.test(char)) {
      if (started) { args.push(token); token = ""; started = false; }
    } else { token += char; started = true; }
  }
  if (quote) throw new Error(tr("Comillas sin cerrar en el editor.", "Unclosed quote in editor command."));
  if (started) args.push(token);
  if (!args[0]) throw new Error(tr("Configura DIFFORA_EDITOR.", "Set DIFFORA_EDITOR."));
  return args;
}
export function editorInvocation(command: string, file: string, line: number, column: number) {
  const [program, ...options] = commandArgs(command);
  const hasFile = options.some((option) => option.includes("{file}"));
  const hasLine = options.some((option) => option.includes("{line}"));
  let args: string[];
  if (hasFile && hasLine)
    args = options.map((option) => option.replace(/\{(file|line|column)\}/g, (_, key: string) => key === "file" ? file : String(key === "line" ? line : column)));
  else if (["code", "code-insiders", "cursor", "code.cmd", "cursor.cmd"].includes(basename(program!).toLowerCase()))
    args = [...options, "--goto", `${file}:${line}:${column}`];
  else throw new Error(tr("Usa code/cursor o configura el editor con {file} y {line}; no se inicia un editor de terminal dentro de Ink.", "Use code/cursor or configure an editor with {file} and {line}; a terminal editor cannot run inside Ink."));
  return { program: program!, args };
}
export async function openEditor(root: string, location: EditorLocation, command = process.env.DIFFORA_EDITOR || process.env.TERMINAL_REVIEW_EDITOR || "code"): Promise<void> {
  const full = resolve(root, location.path);
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(full);
  if (!inside(root, full) || !inside(canonicalRoot, canonical) || !(await stat(canonical)).isFile())
    throw new Error(tr("El archivo no existe como archivo regular dentro del repositorio (puede estar eliminado).", "The file is not a regular file inside the repository (it may be deleted)."));
  const invocation = editorInvocation(command, canonical, Math.max(1, Math.floor(location.line)), Math.max(1, Math.floor(location.column)));
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(invocation.program, invocation.args, { cwd: root, shell: false, stdio: "ignore", detached: true });
    child.once("error", (error: NodeJS.ErrnoException) => reject(new Error(
      error.code === "ENOENT" ? tr(`No se encontró ${invocation.program}; configura DIFFORA_EDITOR.`, `${invocation.program} was not found; set DIFFORA_EDITOR.`) : error.message)));
    child.once("spawn", () => { child.unref(); resolveLaunch(); });
  });
}
