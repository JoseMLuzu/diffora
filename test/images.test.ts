import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Repository } from "../src/git/repository.js";
import {
  decodeImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from "../src/images/decode.js";
import { rasterRows } from "../src/images/raster.js";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
async function picture(color: string) {
  return sharp({
    create: { width: 12, height: 8, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "review images "));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  return { root, repo: await Repository.discover(root) };
}
const firstRGB = (image: { pixels: Uint8Array } | undefined) =>
  Array.from(image?.pixels.subarray(0, 3) ?? []);
test("PNG, JPEG, WebP, GIF, TIFF y AVIF se decodifican con alfa y tamaño limitado", async () => {
  const source = sharp({
    create: { width: 30, height: 20, channels: 4, background: "#ff000080" },
  });
  for (const format of [
    "png",
    "jpeg",
    "webp",
    "gif",
    "tiff",
    "avif",
  ] as const) {
    const buffer = await source.clone().toFormat(format).toBuffer();
    const decoded = await decodeImage(buffer);
    assert.equal(decoded.width, 30);
    assert.equal(decoded.height, 20);
    assert.equal(
      decoded.pixels.length,
      decoded.previewWidth * decoded.previewHeight * 4,
    );
  }
  const large = await sharp({
    create: { width: 600, height: 300, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const preview = await decodeImage(large);
  assert.equal(preview.previewWidth, 160);
  assert.equal(preview.previewHeight, 80);
});
test("raster de medio bloque respeta colores, transparencia, proporción y viewport", async () => {
  const image = await decodeImage(await picture("#ff0000"));
  const rows = rasterRows(image, 12, 4);
  assert.equal(rows.length, 4);
  assert.equal(rows[0]?.[0]?.foreground, "#ff0000");
  assert.equal(
    rows[0]?.reduce((sum, s) => sum + s.text.length, 0),
    12,
  );
  const transparent = await decodeImage(await picture("#ffffff00"));
  assert.equal(rasterRows(transparent, 12, 4)[0]?.[0]?.foreground, "#202020");
  assert.ok(rasterRows(image, 3, 1).length <= 1);
});
test("primer commit, índices y working tree usan imágenes anteriores/nuevas correctas sin mutaciones", async (t) => {
  const { root, repo } = await fixture(t);
  const path = "logo space.png";
  await writeFile(join(root, path), await picture("#ff0000"));
  git(root, "add", ".");
  git(root, "commit", "-m", "Red");
  let commit = (await repo.commits())[0]!;
  let diff = await repo.diff({ kind: "commit", commit }, { path, status: "A" });
  assert.equal(diff.image?.before, undefined);
  assert.deepEqual(firstRGB(diff.image?.after), [255, 0, 0]);
  await writeFile(join(root, path), await picture("#00ff00"));
  git(root, "add", ".");
  await writeFile(join(root, path), await picture("#0000ff"));
  const index = await readFile(join(root, ".git", "index"));
  const before = git(root, "status", "--porcelain=v1", "-z");
  diff = await repo.diff({ kind: "staged" }, { path, status: "M" });
  assert.deepEqual(firstRGB(diff.image?.before), [255, 0, 0]);
  assert.deepEqual(firstRGB(diff.image?.after), [0, 255, 0]);
  diff = await repo.diff({ kind: "unstaged" }, { path, status: "M" });
  assert.deepEqual(firstRGB(diff.image?.before), [0, 255, 0]);
  assert.deepEqual(firstRGB(diff.image?.after), [0, 0, 255]);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(git(root, "status", "--porcelain=v1", "-z"), before);
  git(root, "commit", "-m", "Green");
  commit = (await repo.commits())[0]!;
  diff = await repo.diff({ kind: "commit", commit }, { path, status: "M" });
  assert.deepEqual(firstRGB(diff.image?.before), [255, 0, 0]);
  assert.deepEqual(firstRGB(diff.image?.after), [0, 255, 0]);
});
test("imágenes nuevas, eliminadas y renombradas conservan la versión disponible", async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(join(root, "old.png"), await picture("#ff0000"));
  let diff = await repo.diff(
    { kind: "untracked" },
    { path: "old.png", status: "?" },
  );
  assert.equal(diff.image?.before, undefined);
  assert.ok(diff.image?.after);
  git(root, "add", ".");
  git(root, "commit", "-m", "Old");
  await rename(join(root, "old.png"), join(root, "new.png"));
  git(root, "add", ".");
  const renamed = (await repo.files({ kind: "staged" }))[0]!;
  assert.equal(renamed.oldPath, "old.png");
  diff = await repo.diff({ kind: "staged" }, renamed);
  assert.deepEqual(firstRGB(diff.image?.before), [255, 0, 0]);
  assert.deepEqual(firstRGB(diff.image?.after), [255, 0, 0]);
  git(root, "commit", "-m", "Rename");
  await rm(join(root, "new.png"));
  diff = await repo.diff(
    { kind: "unstaged" },
    { path: "new.png", status: "D" },
  );
  assert.ok(diff.image?.before);
  assert.equal(diff.image?.after, undefined);
});
test("corrupción, bytes, dimensiones y cancelación producen avisos sin bloquear el visor", async (t) => {
  await assert.rejects(
    decodeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    /no es una imagen/,
  );
  await assert.rejects(
    decodeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    /10 MiB/,
  );
  const bomb = await sharp({
    create: {
      width: MAX_IMAGE_PIXELS / 1000 + 1,
      height: 1000,
      channels: 3,
      background: "red",
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(decodeImage(bomb), /pixel|megapíxel/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decodeImage(await picture("red"), controller.signal));
  const { root, repo } = await fixture(t);
  await writeFile(join(root, "bad.png"), "invalid");
  let diff = await repo.diff(
    { kind: "untracked" },
    { path: "bad.png", status: "?" },
  );
  assert.match(diff.image?.afterNotice ?? "", /no es una imagen/);
  await writeFile(join(root, "too-big.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  diff = await repo.diff(
    { kind: "untracked" },
    { path: "too-big.png", status: "?" },
  );
  assert.match(diff.image?.afterNotice ?? "", /10 MiB/);
});
