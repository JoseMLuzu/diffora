import type { ChangedFile, Source } from "./models.js";

export interface ReviewNote { text: string; stale: boolean }
export interface Progress {
  reviewed: string[];
  needsReview: string[];
  notes: Record<string, ReviewNote>;
  fingerprints: Record<string, string>;
  commitReviewKeys: Record<string, string[]>;
  diffLayout: "unified" | "split";
}
export interface ReviewIdentity {
  kind: Source["kind"];
  commit: string;
  path: string;
  oldPath: string;
  status: string;
}
export function identityKey(source: Source, file: ChangedFile): string {
  return JSON.stringify([source.kind, source.kind === "commit" ? source.commit.hash : "",
    file.path, file.oldPath ?? "", file.status]);
}
export function parseIdentity(key: string): ReviewIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 5 || !value.every((v) => typeof v === "string")) return null;
    const [kind, commit, path, oldPath, status] = value as string[];
    if (!["commit", "staged", "unstaged", "untracked"].includes(kind!)
      || !path || path.length > 4096 || path.includes("\0") || oldPath!.includes("\0")
      || !status || status.length > 32
      || (kind === "commit" ? !/^[a-f0-9]{3,64}$/.test(commit!) : commit !== "")) return null;
    return { kind: kind as Source["kind"], commit: commit!, path, oldPath: oldPath!, status };
  } catch { return null; }
}
export const emptyProgress = (): Progress => ({
  reviewed: [], needsReview: [], notes: {}, fingerprints: {}, commitReviewKeys: {}, diffLayout: "unified",
});
