import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Repository } from "../src/git/repository.js";
import { textReview } from "../src/application/textReview.js";
import { installSkills } from "../src/application/installSkills.js";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "terminal review chat "));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  await writeFile(join(root, "file.txt"), "old\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial");
  return root;
}
test("modo chat lista categorías, commits y muestra diferencias paginadas sin escribir", async (t) => {
  const root = await fixture(t);
  const repo = await Repository.discover(root);
  await writeFile(join(root, "file.txt"), "staged\n");
  git(root, "add", ".");
  await writeFile(join(root, "file.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "new\n");
  const before = git(root, "status", "--porcelain=v1", "-z");
  const index = await readFile(join(root, ".git", "index"));
  const overview = await textReview(repo, { offset: 0, limit: 80 });
  assert.match(overview, /Sin preparar \(1\)/);
  assert.match(overview, /Preparados \(1\)/);
  assert.match(overview, /Sin seguimiento \(1\)/);
  assert.match(overview, /Initial/);
  assert.match(
    await textReview(repo, { source: "staged", file: 1, offset: 0, limit: 80 }),
    /\+ staged/,
  );
  assert.match(
    await textReview(repo, {
      source: "unstaged",
      file: 1,
      offset: 0,
      limit: 80,
    }),
    /\+ working/,
  );
  assert.match(
    await textReview(repo, {
      source: "untracked",
      file: 1,
      offset: 0,
      limit: 80,
    }),
    /\+ new/,
  );
  assert.match(
    await textReview(repo, {
      source: "unstaged",
      file: 1,
      offset: 0,
      limit: 1,
    }),
    /Continuar con --offset 1/,
  );
  const [commit] = await repo.commits();
  assert.ok(commit);
  assert.match(
    await textReview(repo, {
      commit: commit.shortHash,
      file: 1,
      offset: 0,
      limit: 80,
    }),
    /árbol vacío/,
  );
  await assert.rejects(
    textReview(repo, {
      source: "staged",
      commit: commit.shortHash,
      offset: 0,
      limit: 80,
    }),
    /no ambos/,
  );
  await assert.rejects(
    textReview(repo, { source: "staged", file: 2, offset: 0, limit: 80 }),
    /fuera de rango/,
  );
  await assert.rejects(
    textReview(repo, { commit: "; malicious", offset: 0, limit: 80 }),
    /hash de Git/,
  );
  assert.equal(git(root, "status", "--porcelain=v1", "-z"), before);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
});
test("instalador personal es idempotente y conserva skills existentes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "review skills "));
  t.after(() => rm(home, { recursive: true, force: true }));
  const results = await installSkills(home);
  assert.equal(results.length, 4);
  const diffora = join(home, ".agents", "skills", "diffora", "SKILL.md");
  assert.match(await readFile(diffora, "utf8"), /name: diffora/);
  assert.match(await readFile(diffora, "utf8"), /`diffora --open`/);
  const codex = join(home, ".agents", "skills", "terminal-review", "SKILL.md");
  const claude = join(home, ".claude", "skills", "terminal-review", "SKILL.md");
  assert.match(await readFile(codex, "utf8"), /name: terminal-review/);
  assert.equal(await readFile(codex, "utf8"), await readFile(claude, "utf8"));
  assert.ok(
    (await installSkills(home)).every((x) => x.startsWith("Ya instalada:")),
  );
  await writeFile(claude, "custom instructions");
  assert.ok(
    (await installSkills(home)).some((x) => x.startsWith("Conservada")),
  );
  assert.equal(await readFile(claude, "utf8"), "custom instructions");
});
test("CLI de chat funciona sin TTY y valida argumentos", async (t) => {
  const root = await fixture(t);
  const cli = join(process.cwd(), "src", "cli.ts");
  const run = (args: string[]) =>
    execFileSync(process.execPath, ["--import", "tsx", cli, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert.match(run(["--text", "--repo", root]), /Initial/);
  assert.throws(
    () => run(["--text", "--repo", root, "--limit", "0"]),
    /--limit/,
  );
  assert.throws(
    () => run(["--text", "--repo", root, "--file", "-1"]),
    /--file/,
  );
  assert.throws(
    () => run(["--source", "staged", "--repo", root]),
    /requieren --text/,
  );
});
