import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { languageFromLocale } from "../src/core/i18n.js";

test("selecciona español para locales es y usa inglés como alternativa", () => {
  assert.equal(languageFromLocale("es-EC"), "es");
  assert.equal(languageFromLocale("es_ES"), "es");
  assert.equal(languageFromLocale("en-US"), "en");
  assert.equal(languageFromLocale("fr-FR"), "en");
  assert.equal(languageFromLocale("C.UTF-8"), "en");
});

test("ayuda y modo texto siguen el idioma seleccionado", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "diffora-lang-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  const cli = join(process.cwd(), "src", "cli.ts");
  const run = (locale: string, args: string[]) => execFileSync(process.execPath,
    ["--import", "tsx", cli, ...args],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DIFFORA_LANG: locale } });

  assert.match(run("es-EC", ["--help"]), /Navegar:.*Cambiar vista:/s);
  assert.match(run("en-US", ["--help"]), /Navigate:.*Switch view:/s);
  assert.match(run("fr-FR", ["--help"]), /Navigate:/);
  const { version } = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
  assert.equal(run("en-US", ["--version"]).trim(), version);
  assert.match(run("es-EC", ["--text", "--repo", root]), /Sin preparar.*Historial vacío/s);
  assert.match(run("en-US", ["--text", "--repo", root]), /Unstaged.*No commits/s);

  const report = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "import { initialState } from './src/application/state.ts'; import { reviewReport } from './src/application/report.ts'; console.log(reviewReport('/example', { ...initialState, mode: 'pending' }));"],
  { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DIFFORA_LANG: "en" } });
  assert.match(report, /# Review report.*Repository:.*Unstaged.*No open tasks/s);
});
