import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  terminalCommand,
  shellQuote,
  createLaunchFile,
} from "../src/application/openTerminal.js";
import { installSkills } from "../src/application/installSkills.js";

test("lanzador pasa rutas literalmente, incluidos espacios, quotes y metacaracteres", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "review ' $ ` ; "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(root, "cli ' $(touch INJECTION) `echo x`.js");
  await writeFile(
    cli,
    "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),lang:process.env.DIFFORA_LANG}));\n",
  );
  const result = execFileSync(
    "/bin/sh",
    ["-c", terminalCommand(root, process.execPath, cli)],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(result) as { cwd: string; args: string[] };
  assert.ok(parsed.cwd.endsWith(root.slice(root.indexOf("review "))));
  assert.deepEqual(parsed.args, ["--repo", root]);
  const previous = process.env.DIFFORA_LANG;
  process.env.DIFFORA_LANG = "en";
  try {
    const language = JSON.parse(execFileSync("/bin/sh", ["-c", terminalCommand(root, process.execPath, cli)], { encoding: "utf8" })) as { lang: string };
    assert.equal(language.lang, "en");
  } finally {
    if (previous === undefined) delete process.env.DIFFORA_LANG;
    else process.env.DIFFORA_LANG = previous;
  }
  await assert.rejects(access(join(root, "INJECTION")));
  assert.throws(() => shellQuote("a\0b"), /NUL/);
});
test("actualiza la skill oficial anterior con respaldo y conserva personalizaciones", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "review skill migration "));
  t.after(() => rm(home, { recursive: true, force: true }));
  await installSkills(home);
  const old = await readFile(
    new URL("./fixtures/chat-skill-v1.md", import.meta.url),
    "utf8",
  );
  const codex = join(home, ".agents", "skills", "terminal-review", "SKILL.md");
  await writeFile(codex, old);
  const result = await installSkills(home);
  assert.ok(result.some((s) => s.startsWith("Actualizada:")));
  assert.match(await readFile(codex, "utf8"), /terminal-review --open/);
  assert.equal(await readFile(codex + ".backup-1dfd0b403055", "utf8"), old);
  assert.ok(
    (await installSkills(home)).every((s) => s.startsWith("Ya instalada:")),
  );
});

test("archivo de lanzamiento ejecutable conserva argumentos y se elimina al salir", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "review launch ' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(root, "fake cli.js");
  await writeFile(cli, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  const launch = await createLaunchFile(root, process.execPath, cli);
  t.after(() => rm(launch.directory, { recursive: true, force: true }));
  const result = execFileSync("/bin/sh", [launch.file], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), ["--repo", root]);
  await assert.rejects(access(launch.file));
  await assert.rejects(access(launch.directory));
});
