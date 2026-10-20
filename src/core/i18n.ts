import { execFileSync } from "node:child_process";

export type Language = "es" | "en";

export function languageFromLocale(locale: string): Language {
  return /^es(?:[-_]|$)/i.test(locale.trim()) ? "es" : "en";
}

function macLanguage(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const languages = execFileSync("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], {
      encoding: "utf8", timeout: 1000, maxBuffer: 4096, stdio: ["ignore", "pipe", "ignore"],
    });
    return /^\s*\(\s*"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)/.exec(languages)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function detectLanguage(): Language {
  const override = process.env.DIFFORA_LANG?.trim();
  if (override) return languageFromLocale(override);
  return languageFromLocale(macLanguage() ?? Intl.DateTimeFormat().resolvedOptions().locale);
}

export const language = detectLanguage();
export const tr = (spanish: string, english: string): string => language === "es" ? spanish : english;
