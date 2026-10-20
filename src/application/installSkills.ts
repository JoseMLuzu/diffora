import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { tr } from "../core/i18n.js";

export async function installSkills(home = homedir()): Promise<string[]> {
  const targets = (await Promise.all(["diffora", "terminal-review"].map(async (name) => {
    const template = await readFile(
      new URL(`../../integrations/${name}/SKILL.md`, import.meta.url), "utf8",
    );
    return [".agents", ".claude"].map((client) => ({
      target: join(home, client, "skills", name, "SKILL.md"), template,
    }));
  }))).flat();
  const results: string[] = [];
  const previousTemplates = new Set([
    "1dfd0b403055fff5f5bf135efb1845cfa96adf06d769d0ce82aced58853b5b65",
  ]);
  for (const { target, template } of targets) {
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, template, { flag: "wx" });
      results.push(tr(`Instalada: ${target}`, `Installed: ${target}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(target, "utf8");
      const hash = createHash("sha256").update(existing).digest("hex");
      if (existing === template) results.push(tr(`Ya instalada: ${target}`, `Already installed: ${target}`));
      else if (previousTemplates.has(hash)) {
        const backup = `${target}.backup-${hash.slice(0, 12)}`;
        try {
          await writeFile(backup, existing, { flag: "wx" });
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code !== "EEXIST")
            throw backupError;
        }
        const temporary = `${target}.tmp-${process.pid}`;
        await writeFile(temporary, template, { flag: "wx" });
        await rename(temporary, target);
        results.push(tr(`Actualizada: ${target} (copia anterior: ${backup})`, `Updated: ${target} (previous copy: ${backup})`));
      } else
        results.push(
          tr(`Conservada sin sobrescribir: ${target} (contenido personalizado)`, `Kept without overwriting: ${target} (customized content)`),
        );
    }
  }
  return results;
}
