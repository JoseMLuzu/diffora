import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  readFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Repository } from "../src/git/repository.js";
import { runGit, MAX_DIFF_BYTES } from "../src/git/runner.js";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
  });
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "terminal review "));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}
test("historial vacío, raíz desde subcarpeta y primer commit", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "sub"));
  const repo = await Repository.discover(join(root, "sub"));
  assert.equal(repo.root, await realpath(root));
  assert.deepEqual(await repo.commits(), []);
  await writeFile(join(root, "first file.txt"), "hello\n");
  git(root, "add", "--", "first file.txt");
  assert.equal((await repo.files({ kind: "staged" })).length, 1);
  git(root, "commit", "-m", "First");
  const [commit] = await repo.commits();
  assert.ok(commit);
  assert.equal(commit.parents.length, 0);
  const source = { kind: "commit" as const, commit };
  const [file] = await repo.files(source);
  assert.ok(file);
  assert.equal(file.path, "first file.txt");
  assert.equal(
    (await repo.diff(source, file)).lines.some(
      (l) => l.kind === "add" && l.text === "hello",
    ),
    true,
  );
});
test("preparados, sin preparar, nuevos, eliminados, renombrados y binarios; lectura sin mutación", async (t) => {
  const root = await fixture(t);
  const repo = await Repository.discover(root);
  for (const name of ["edit.txt", "delete.txt", "old name.txt"])
    await writeFile(join(root, name), "one\ntwo\nthree\n");
  await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial");
  await writeFile(join(root, "edit.txt"), "staged\ntwo\nthree\n");
  git(root, "add", "edit.txt");
  await writeFile(join(root, "edit.txt"), "working\ntwo\nthree\n");
  await rm(join(root, "delete.txt"));
  await rename(join(root, "old name.txt"), join(root, "new name.txt"));
  git(root, "add", "--", "old name.txt", "new name.txt");
  await writeFile(join(root, "new\nfile space.txt"), "new content\n");
  await writeFile(join(root, "new binary.dat"), Buffer.from([0, 9]));
  await writeFile(join(root, "binary.dat"), Buffer.from([0, 9, 2]));
  await symlink("edit.txt", join(root, "link"));
  const before = git(root, "status", "--porcelain=v1", "-z");
  const indexBefore = await readFile(join(root, ".git", "index"));
  const pending = await repo.pending();
  assert.ok(pending.unstaged.some((f) => f.status === "D"));
  assert.ok(
    pending.staged.some(
      (f) => f.oldPath === "old name.txt" && f.path === "new name.txt",
    ),
  );
  assert.ok(pending.untracked.some((f) => f.path === "new\nfile space.txt"));
  for (const kind of ["staged", "unstaged"] as const) {
    const f = pending[kind].find((f) => f.path === "edit.txt");
    assert.ok(f);
    const diff = await repo.diff({ kind }, f);
    assert.ok(
      diff.lines.some(
        (l) =>
          l.kind === "add" &&
          l.text === (kind === "staged" ? "staged" : "working"),
      ),
    );
  }
  const deleted = pending.unstaged.find((f) => f.path === "delete.txt");
  assert.ok(deleted);
  assert.ok(
    (await repo.diff({ kind: "unstaged" }, deleted)).lines.some(
      (l) => l.kind === "delete",
    ),
  );
  for (const kind of ["unstaged", "untracked"] as const) {
    const f = pending[kind].find((f) => f.path.includes("binary"));
    assert.ok(f);
    assert.equal((await repo.diff({ kind }, f)).binary, true);
  }
  const newFile = pending.untracked.find(
    (f) => f.path === "new\nfile space.txt",
  );
  assert.ok(newFile);
  assert.equal(
    (await repo.diff({ kind: "untracked" }, newFile)).lines[1]?.text,
    "new content",
  );
  assert.equal(
    (await repo.diff({ kind: "untracked" }, { path: "link", status: "?" }))
      .lines[1]?.text,
    "edit.txt",
  );
  const renamed = pending.staged.find((f) => f.oldPath);
  assert.ok(renamed);
  assert.ok(
    (await repo.diff({ kind: "staged" }, renamed)).lines.some((l) =>
      l.text.startsWith("rename from"),
    ),
  );
  assert.equal(git(root, "status", "--porcelain=v1", "-z"), before);
  assert.deepEqual(await readFile(join(root, ".git", "index")), indexBefore);
});
test("merge usa primer padre y muestra solo sus cambios", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "base"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Base");
  git(root, "checkout", "-b", "feature");
  await writeFile(join(root, "feature"), "feature\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Feature");
  git(root, "checkout", "main");
  await writeFile(join(root, "main"), "main\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Main");
  git(root, "merge", "--no-ff", "feature", "-m", "Merge");
  const repo = await Repository.discover(root);
  const [commit] = await repo.commits();
  assert.ok(commit);
  assert.equal(commit.parents.length, 2);
  assert.deepEqual(
    (await repo.files({ kind: "commit", commit })).map((f) => f.path),
    ["feature"],
  );
});
test("límites explícitos de diff y contenido nuevo", async (t) => {
  const root = await fixture(t);
  const repo = await Repository.discover(root);
  await writeFile(join(root, "large"), "x".repeat(MAX_DIFF_BYTES + 100));
  assert.equal(
    (await repo.diff({ kind: "untracked" }, { path: "large", status: "?" }))
      .truncated,
    true,
  );
  git(root, "add", ".");
  assert.equal(
    (await repo.diff({ kind: "staged" }, { path: "large", status: "A" }))
      .truncated,
    true,
  );
  await assert.rejects(runGit(root, ["status", "--porcelain=v1", "-z"], 1));
});
test("no repositorio y Git ausente producen errores", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "not repo "));
  t.after(() => rm(path, { recursive: true, force: true }));
  await assert.rejects(Repository.discover(path), /not a git repository/);
  const previous = process.env.PATH;
  process.env.PATH = "";
  try {
    await assert.rejects(runGit(path, ["status"]), /Git no está instalado/);
  } finally {
    process.env.PATH = previous;
  }
});
test("sin cambios y máximo 30 commits", async (t) => {
  const root = await fixture(t);
  git(root, "commit", "--allow-empty", "-m", "Empty");
  for (let i = 0; i < 31; i++)
    git(root, "commit", "--allow-empty", "-m", String(i));
  const repo = await Repository.discover(root);
  assert.equal((await repo.commits()).length, 30);
  assert.deepEqual(await repo.pending(), {
    unstaged: [],
    staged: [],
    untracked: [],
  });
});
test("commit normal, nombres especiales y diff externo desactivado", async (t) => {
  const root = await fixture(t);
  const path = ":(glob)* space\nfile.txt";
  await writeFile(join(root, path), "before\n");
  await writeFile(join(root, ".gitattributes"), "*.txt diff=custom\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Base");
  await writeFile(join(root, path), "after\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Next");
  git(
    root,
    "config",
    "diff.external",
    "terminal-review-command-that-must-not-run",
  );
  git(
    root,
    "config",
    "diff.custom.textconv",
    "terminal-review-command-that-must-not-run",
  );
  const repo = await Repository.discover(root);
  const [commit] = await repo.commits();
  assert.ok(commit);
  assert.equal(commit.parents.length, 1);
  const source = { kind: "commit" as const, commit };
  const [file] = await repo.files(source);
  assert.ok(file);
  assert.equal(file.path, path);
  const diff = await repo.diff(source, file);
  assert.ok(diff.lines.some((l) => l.kind === "delete" && l.text === "before"));
  assert.ok(diff.lines.some((l) => l.kind === "add" && l.text === "after"));
});
test("cancelación detiene la consulta y nombres que empiezan por '..' son válidos", async (t) => {
  const root = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runGit(root, ["status"], undefined, false, controller.signal),
  );
  await writeFile(join(root, "..valid.txt"), "valid\n");
  const repo = await Repository.discover(root);
  assert.equal(
    (
      await repo.diff(
        { kind: "untracked" },
        { path: "..valid.txt", status: "?" },
      )
    ).lines[1]?.text,
    "valid",
  );
  await assert.rejects(
    repo.diff({ kind: "untracked" }, { path: "../outside", status: "?" }),
    /fuera del repositorio/,
  );
});
