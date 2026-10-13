import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export async function installSkills(home = homedir()): Promise<string[]> {
  const template = await readFile(
    new URL("../../integrations/terminal-review/SKILL.md", import.meta.url),
    "utf8",
  );
  const targets = [
    join(home, ".agents", "skills", "terminal-review", "SKILL.md"),
    join(home, ".claude", "skills", "terminal-review", "SKILL.md"),
  ];
  const results: string[] = [];
  const previousTemplates = new Set([
    "1dfd0b403055fff5f5bf135efb1845cfa96adf06d769d0ce82aced58853b5b65",
  ]);
  for (const target of targets) {
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, template, { flag: "wx" });
      results.push(`Instalada: ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(target, "utf8");
      const hash = createHash("sha256").update(existing).digest("hex");
      if (existing === template) results.push(`Ya instalada: ${target}`);
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
        results.push(`Actualizada: ${target} (copia anterior: ${backup})`);
      } else
        results.push(
          `Conservada sin sobrescribir: ${target} (contenido personalizado)`,
        );
    }
  }
  return results;
}
