#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Repository } from "./git/repository.js";
import { textReview } from "./application/textReview.js";
import { openTerminal } from "./application/openTerminal.js";
import { installSkills } from "./application/installSkills.js";
import type { Category } from "./core/models.js";
import { safeText } from "./core/diff.js";
import { DISABLE_MOUSE } from "./ui/panelResize.js";
async function main() {
  const { values, positionals } = parseArgs({
    options: {
      repo: { type: "string" },
      text: { type: "boolean" },
      open: { type: "boolean" },
      "install-skills": { type: "boolean" },
      source: { type: "string" },
      commit: { type: "string" },
      file: { type: "string" },
      offset: { type: "string" },
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (positionals.length)
    throw new Error("Argumentos inesperados. Usa --repo <ruta>.");
  if (values.help) {
    console.log(
      "Diffora — Git de solo lectura · progreso local persistente\nUso: diffora [--repo <ruta>]\nAbrir visor desde un agente (macOS): --open [--repo <ruta>]\nChat: --text [--source unstaged|staged|untracked | --commit <hash>] [--file <n>] [--offset <n>] [--limit <1..200>]\nInstalar comandos de chat: --install-skills\nAtajos: ↑↓ Enter Tab Esc · h historial · w pendientes · r actualizar · / buscar\nm terminado/verde · n pendiente/naranja · c nota · f solo pendientes · ] siguiente archivo\nj/k bloques · s unificado/paralelo (≥80 columnas) · v imagen anterior/nueva\ne editor · t tareas · i resumen · E exportar Markdown · ? ayuda · q/Ctrl+C guardar y salir\nEditor: DIFFORA_EDITOR (code por defecto; argumentos {file}, {line}, {column})\nEstado: DIFFORA_STATE_DIR o ~/.local/state/terminal-review (fuera del repo).",
    );
    return;
  }
  if (values.version) {
    console.log("0.1.0");
    return;
  }
  if (values["install-skills"]) {
    if (
      values.repo ||
      values.text ||
      values.open ||
      values.source ||
      values.commit ||
      values.file ||
      values.offset ||
      values.limit
    )
      throw new Error("--install-skills se usa sin opciones de revisión.");
    console.log((await installSkills()).map(safeText).join("\n"));
    console.log(
      "Reinicia el agente si no aparece la skill. Claude Code: /diffora · Codex: $diffora o /skills.",
    );
    return;
  }
  const textOptions =
    values.source ||
    values.commit ||
    values.file ||
    values.offset ||
    values.limit;
  if (textOptions && !values.text)
    throw new Error(
      "--source, --commit, --file, --offset y --limit requieren --text.",
    );
  if (
    values.source &&
    !["unstaged", "staged", "untracked"].includes(values.source)
  )
    throw new Error("--source debe ser unstaged, staged o untracked.");
  function numberOption(
    value: string | undefined,
    name: string,
    fallback: number,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
  ): number {
    if (value === undefined) return fallback;
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
    return Number(value);
  }
  const offset = numberOption(values.offset, "--offset", 0, 0);
  const limit = numberOption(values.limit, "--limit", 80, 1, 200);
  const file =
    values.file === undefined
      ? undefined
      : numberOption(values.file, "--file", 1, 1);
  if (values.open && values.text)
    throw new Error("--open y --text son modos distintos; elige uno.");
  const repo = await Repository.discover(values.repo ?? process.cwd());
  if (values.open) {
    await openTerminal(repo.root);
    console.log(
      `Se envió la apertura del visor a Terminal.app: ${safeText(repo.root)}. Usa q para salir del visor; después vuelve a la ventana del chat.`,
    );
    return;
  }
  if (values.text) {
    process.stdout.write(
      await textReview(repo, {
        offset,
        limit,
        ...(file === undefined ? {} : { file }),
        ...(values.source ? { source: values.source as Category } : {}),
        ...(values.commit ? { commit: values.commit } : {}),
      }),
    );
    return;
  }
  const [{ default: React }, { render }, { App }] = await Promise.all([
    import("react"),
    import("ink"),
    import("./ui/App.js"),
  ]);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Diffora requiere una terminal interactiva (TTY).");
  let flush = async () => {};
  const registerFlush = (save: () => Promise<void>) => { flush = save; };
  // Anchor mouse coordinates to the top-left and restore the user's screen on exit.
  process.stdout.write("\x1b[?1049h\x1b[H");
  let instance: ReturnType<typeof render> | undefined;
  const stop = () => { void flush().catch((error: unknown) => console.error(safeText(String(error)))).finally(() => instance?.unmount()); };
  try {
    instance = render(React.createElement(App, { repo, registerFlush }), {
      exitOnCtrlC: false,
    });
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    await instance.waitUntilExit();
  } finally {
    await flush().catch((error: unknown) => console.error(safeText(String(error))));
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    try { instance?.cleanup(); }
    finally { process.stdout.write(`${DISABLE_MOUSE}\x1b[?1049l`); }
  }
}
main().catch((error: unknown) => {
  console.error(
    `Diffora: ${safeText(error instanceof Error ? error.message : String(error))}`,
  );
  process.exitCode = 1;
});
