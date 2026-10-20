#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Repository } from "./git/repository.js";
import { textReview } from "./application/textReview.js";
import { openTerminal } from "./application/openTerminal.js";
import { installSkills } from "./application/installSkills.js";
import type { Category } from "./core/models.js";
import { safeText } from "./core/diff.js";
import { DISABLE_MOUSE } from "./ui/panelResize.js";
import { tr } from "./core/i18n.js";
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
    throw new Error(tr("Argumentos inesperados. Usa --repo <ruta>.", "Unexpected arguments. Use --repo <path>."));
  if (values.help) {
    console.log(
      [
        tr("Diffora — revisión local de Git", "Diffora — local Git review"),
        tr("Uso: diffora [--repo <ruta>]", "Usage: diffora [--repo <path>]"),
        "",
        tr("Navegar: ↑↓ mover · Enter abrir · Tab cambiar panel · Esc volver", "Navigate: ↑↓ move · Enter open · Tab switch panel · Esc back"),
        tr("Cambiar vista: h historial · w pendientes · r actualizar · / buscar", "Switch view: h history · w pending · r refresh · / search"),
        tr("Revisar: m terminado · n revisar · c nota · f solo pendientes · ] siguiente", "Review: m done · n needs review · c note · f unfinished only · ] next"),
        tr("Ver cambios: j/k bloques · s paralelo · v imagen anterior/nueva · e editor", "View changes: j/k hunks · s side by side · v before/after image · e editor"),
        tr("Otras vistas: t tareas · i resumen · E exportar · ? ayuda · q/Ctrl+C salir", "More: t tasks · i summary · E export · ? help · q/Ctrl+C quit"),
        "",
        tr("Desde un agente (macOS): --open [--repo <ruta>]", "From an agent (macOS): --open [--repo <path>]"),
        tr("Modo texto: --text [--source unstaged|staged|untracked | --commit <hash>]", "Text mode: --text [--source unstaged|staged|untracked | --commit <hash>]"),
        "            [--file <n>] [--offset <n>] [--limit <1..200>]",
        tr("Instalar comandos de chat: --install-skills", "Install chat commands: --install-skills"),
        tr("Editor: DIFFORA_EDITOR (code por defecto; {file}, {line}, {column})", "Editor: DIFFORA_EDITOR (code by default; {file}, {line}, {column})"),
        tr("Estado: DIFFORA_STATE_DIR o ~/.local/state/terminal-review (fuera del repo).", "State: DIFFORA_STATE_DIR or ~/.local/state/terminal-review (outside the repo)."),
        tr("Idioma: dispositivo; DIFFORA_LANG=es|en para cambiarlo.", "Language: device setting; use DIFFORA_LANG=es|en to override."),
      ].join("\n"),
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
      throw new Error(tr("--install-skills se usa sin opciones de revisión.", "Use --install-skills without review options."));
    console.log((await installSkills()).map(safeText).join("\n"));
    console.log(
      tr("Reinicia el agente si no aparece la skill. Claude Code: /diffora · Codex: $diffora o /skills.", "Restart the agent if the skill does not appear. Claude Code: /diffora · Codex: $diffora or /skills."),
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
      tr("--source, --commit, --file, --offset y --limit requieren --text.", "--source, --commit, --file, --offset, and --limit require --text."),
    );
  if (
    values.source &&
    !["unstaged", "staged", "untracked"].includes(values.source)
  )
    throw new Error(tr("--source debe ser unstaged, staged o untracked.", "--source must be unstaged, staged, or untracked."));
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
      throw new Error(tr(`${name} debe ser un entero entre ${min} y ${max}.`, `${name} must be an integer between ${min} and ${max}.`));
    return Number(value);
  }
  const offset = numberOption(values.offset, "--offset", 0, 0);
  const limit = numberOption(values.limit, "--limit", 80, 1, 200);
  const file =
    values.file === undefined
      ? undefined
      : numberOption(values.file, "--file", 1, 1);
  if (values.open && values.text)
    throw new Error(tr("--open y --text son modos distintos; elige uno.", "--open and --text are different modes; choose one."));
  const repo = await Repository.discover(values.repo ?? process.cwd());
  if (values.open) {
    await openTerminal(repo.root);
    console.log(
      tr(`Se envió la apertura del visor a Terminal.app: ${safeText(repo.root)}. Usa q para salir del visor; después vuelve a la ventana del chat.`, `Requested the viewer in Terminal.app: ${safeText(repo.root)}. Press q to quit the viewer, then return to the chat window.`),
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
    throw new Error(tr("Diffora requiere una terminal interactiva (TTY).", "Diffora requires an interactive terminal (TTY)."));
  let flush = async () => {};
  const registerFlush = (save: () => Promise<void>) => { flush = save; };
  // Anchor mouse coordinates to the top-left and restore the user's screen on exit.
  process.stdout.write("\x1b[?1049h\x1b[H");
  let instance: ReturnType<typeof render> | undefined;
  const stop = () => { void flush().catch((error: unknown) => console.error(safeText(String(error)))).finally(() => instance?.unmount()); };
  try {
    instance = render(React.createElement(App, { repo, registerFlush }), {
      exitOnCtrlC: false,
      interactive: true,
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
