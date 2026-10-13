import type {
  Category,
  ChangedFile,
  Commit,
  Diff,
  Source,
} from "../core/models.js";
import { splitDiff } from "../core/splitDiff.js";
import { identityKey, type Progress } from "../core/progress.js";
import { reduceWorkflow, applyPending, applyFingerprint, retainVisible, canReview, type WorkflowAction, type Fingerprints } from "./reviewWorkflow.js";
export const categories: Category[] = ["unstaged", "staged", "untracked"];
export const labels: Record<Category, string> = {
  unstaged: "Sin preparar",
  staged: "Preparados",
  untracked: "Sin seguimiento",
};
export type ReviewStatus = "unreviewed" | "needs-review" | "reviewed";
export interface State extends Progress {
  progressReady: boolean;
  storageWarning: string;
  notice: string;
  onlyRemaining: boolean;
  overlay: "none" | "tasks" | "summary" | "help";
  taskIndex: number;
  noteEditing: boolean;
  noteDraft: string;
  noteTarget: string;
  noteFingerprint: string;
  requestedFileKey: string;
  lastReport: string;
  hunkAnchor: number | null;
  mode: "history" | "pending";
  panel: 0 | 1 | 2;
  revision: number;
  generation: number;
  fileRevision: number;
  selection: number;
  fileIndex: number;
  scroll: number;
  diffLayout: "unified" | "split";
  diffColumns: number;
  imageSide: "before" | "after";
  searchQuery: string;
  searchEditing: boolean;
  reviewed: string[];
  needsReview: string[];
  commitReviewKeys: Record<string, string[]>;
  commits: Commit[];
  pending: Record<Category, ChangedFile[]>;
  files: ChangedFile[];
  diff: Diff | null;
  loading: boolean;
  filesLoading: boolean;
  diffLoading: boolean;
  error: string;
}
export const initialState: State = {
  notes: {},
  fingerprints: {},
  progressReady: false,
  storageWarning: "",
  notice: "",
  onlyRemaining: false,
  overlay: "none",
  taskIndex: 0,
  noteEditing: false,
  noteDraft: "",
  noteTarget: "",
  noteFingerprint: "",
  requestedFileKey: "",
  lastReport: "",
  hunkAnchor: null,
  mode: "history",
  panel: 0,
  revision: 0,
  generation: 0,
  fileRevision: 0,
  selection: 0,
  fileIndex: 0,
  scroll: 0,
  diffLayout: "unified",
  diffColumns: 80,
  imageSide: "after",
  searchQuery: "",
  searchEditing: false,
  reviewed: [],
  needsReview: [],
  commitReviewKeys: {},
  commits: [],
  pending: { unstaged: [], staged: [], untracked: [] },
  files: [],
  diff: null,
  loading: true,
  filesLoading: false,
  diffLoading: false,
  error: "",
};
export function selectedSource(state: State): Source | null {
  if (state.mode === "pending")
    return { kind: categories[state.selection] ?? "unstaged" };
  const commit = state.commits[state.selection];
  return commit ? { kind: "commit", commit } : null;
}
export function filesKey(s: State): string {
  return `${s.revision}:${s.generation}:${s.mode}:${s.selection}:${s.commits[s.selection]?.hash ?? ""}`;
}
export function diffKey(s: State): string {
  return `${filesKey(s)}:${s.fileRevision}:${s.fileIndex}:${s.files[s.fileIndex]?.path ?? ""}`;
}
/** Keep the original indexes: filtering must never change a Git file identity. */
export function visibleFiles(s: State): { file: ChangedFile; index: number }[] {
  const query = s.searchQuery.toLocaleLowerCase();
  return s.files.flatMap((file, index) =>
    (!s.onlyRemaining || fileReviewStatus(s, file) !== "reviewed")
      && (!query || `${file.path}\n${file.oldPath ?? ""}`.toLocaleLowerCase().includes(query))
      ? [{ file, index }]
      : [],
  );
}
export function reviewKey(s: State, file: ChangedFile): string {
  const source = selectedSource(s);
  return source ? identityKey(source, file) : JSON.stringify([null, "", file.path, file.oldPath ?? "", file.status]);
}
export function isReviewed(s: State, file: ChangedFile): boolean {
  return fileReviewStatus(s, file) === "reviewed";
}
export function fileReviewStatus(s: State, file: ChangedFile): ReviewStatus {
  const key = reviewKey(s, file);
  return s.needsReview.includes(key) ? "needs-review"
    : s.reviewed.includes(key) ? "reviewed" : "unreviewed";
}
/** Only a loaded, nonempty complete file list can establish commit completion. */
export function isCommitReviewed(s: State, commit: Commit): boolean {
  return commitReviewStatus(s, commit) === "reviewed";
}
export function commitReviewStatus(s: State, commit: Commit): ReviewStatus {
  const keys = s.commitReviewKeys[commit.hash];
  if (!keys?.length) return "unreviewed";
  if (keys.some((key) => s.needsReview.includes(key))) return "needs-review";
  return keys.every((key) => s.reviewed.includes(key)) ? "reviewed" : "unreviewed";
}
export type Action =
  | WorkflowAction
  | { type: "diff-layout-toggle"; rows: number }
  | { type: "diff-viewport"; columns: number; rows: number }
  | { type: "mode"; mode: State["mode"] }
  | { type: "panel"; panel: State["panel"] }
  | { type: "move"; delta: number; pageSize: number }
  | { type: "refresh" }
  | { type: "image-side" }
  | { type: "search-start" }
  | { type: "search-query"; query: string }
  | { type: "search-end"; clear?: boolean }
  | { type: "review-toggle" }
  | { type: "review-needs-toggle" }
  | {
      type: "snapshot";
      revision: number;
      commits: Commit[];
      pending: State["pending"];
      fingerprints?: Fingerprints;
    }
  | { type: "files"; key: string; files: ChangedFile[] }
  | { type: "diff"; key: string; diff: Diff; fingerprint?: string | null }
  | { type: "loading"; target: "files" | "diff"; key: string }
  | {
      type: "error";
      target: "snapshot" | "files" | "diff";
      key: string;
      message: string;
    };
export function clearFiles(s: State): State {
  return {
    ...s,
    generation: s.generation + 1,
    fileRevision: s.fileRevision + 1,
    files: [],
    fileIndex: 0,
    diff: null,
    scroll: 0,
    hunkAnchor: null,
    filesLoading: false,
    diffLoading: false,
    error: "",
    searchQuery: "",
    searchEditing: false,
  };
}
export function selectFile(s: State, fileIndex: number): State {
  return fileIndex === s.fileIndex
    ? s
    : {
        ...s,
        fileIndex,
        fileRevision: s.fileRevision + 1,
        diff: null,
        scroll: 0,
        hunkAnchor: null,
        diffLoading: false,
        error: "",
      };
}
const clamp = (n: number, max: number) =>
  Math.max(0, Math.min(n, Math.max(0, max)));
export function isSplitDiff(s: State): boolean {
  return s.diffLayout === "split" && s.diffColumns >= 80 && !s.diff?.image;
}
export function diffRowCount(s: State): number {
  return isSplitDiff(s) ? splitDiff(s.diff?.lines ?? []).length : s.diff?.lines.length ?? 0;
}
export function diffPageSize(s: State, rows: number): number {
  return Math.max(1, rows - (s.diffLayout === "split" && !s.diff?.image ? 1 : 0));
}
function changeLayout(previous: State, next: State, rows: number): State {
  let scroll = previous.scroll;
  if (isSplitDiff(previous) !== isSplitDiff(next)) {
    const paired = splitDiff(previous.diff?.lines ?? []);
    scroll = isSplitDiff(previous)
      ? paired[scroll]?.sourceIndices[0] ?? 0
      : Math.max(0, paired.findIndex((row) => row.sourceIndices.includes(scroll)));
  }
  return { ...next, scroll: clamp(scroll, diffRowCount(next) - diffPageSize(next, rows)) };
}
export function reducer(state: State, action: Action): State {
  const workflow = reduceWorkflow(state, action);
  if (workflow) return workflow;
  switch (action.type) {
    case "diff-layout-toggle":
      return state.panel === 2 && state.diff && !state.diff.image
        ? changeLayout(state, { ...state, diffLayout: state.diffLayout === "split" ? "unified" : "split" }, action.rows)
        : state;
    case "diff-viewport":
      return changeLayout(state, { ...state, diffColumns: action.columns }, action.rows);
    case "search-start":
      return { ...state, panel: 1, searchEditing: true };
    case "search-query": {
      const next = { ...state, searchQuery: Array.from(action.query).slice(0, 256).join("") };
      const visible = visibleFiles(next);
      return selectFile(next, visible.some((f) => f.index === state.fileIndex)
        ? state.fileIndex : visible[0]?.index ?? -1);
    }
    case "search-end": {
      const next = { ...state, searchEditing: false };
      return action.clear
        ? reducer(next, { type: "search-query", query: "" })
        : next;
    }
    case "review-toggle":
    case "review-needs-toggle": {
      const file = state.files[state.fileIndex];
      if (!file || !canReview(state)) return state;
      const key = reviewKey(state, file);
      const needsToggle = action.type === "review-needs-toggle";
      return retainVisible({
        ...state,
        notes: state.notes[key] ? { ...state.notes, [key]: { ...state.notes[key]!, stale: false } } : state.notes,
        reviewed: needsToggle || state.reviewed.includes(key)
          ? state.reviewed.filter((item) => item !== key)
          : [...state.reviewed, key],
        needsReview: !needsToggle || state.needsReview.includes(key)
          ? state.needsReview.filter((item) => item !== key)
          : [...state.needsReview, key],
      });
    }
    case "mode":
      if (action.mode === state.mode) return { ...state, panel: 0 };
      return clearFiles({
        ...state,
        mode: action.mode,
        selection: 0,
        panel: 0,
      });
    case "panel":
      return { ...state, panel: action.panel };
    case "image-side":
      return state.panel === 2 && state.diff?.image
        ? {
            ...state,
            imageSide: state.imageSide === "before" ? "after" : "before",
          }
        : state;
    case "refresh":
      return clearFiles({
        ...state,
        revision: state.revision + 1,
        loading: true,
        reviewed: state.progressReady ? state.reviewed : state.reviewed.filter((key) => key.startsWith('["commit",')),
        needsReview: state.progressReady ? state.needsReview : state.needsReview.filter((key) => key.startsWith('["commit",')),
      });
    case "move": {
      if (state.panel === 0) {
        const selection = clamp(
          state.selection + action.delta,
          (state.mode === "history" ? state.commits.length : 3) - 1,
        );
        return selection === state.selection
          ? state
          : clearFiles({ ...state, selection });
      }
      if (state.panel === 1) {
        const visible = visibleFiles(state);
        const position = visible.findIndex((f) => f.index === state.fileIndex);
        return selectFile(state, visible[clamp(position + action.delta, visible.length - 1)]?.index ?? -1);
      }
      return {
        ...state,
        hunkAnchor: null,
        scroll: clamp(
          state.scroll + action.delta,
          diffRowCount(state) - action.pageSize,
        ),
      };
    }
    case "snapshot":
      if (action.revision !== state.revision) return state;
      return clearFiles(applyPending({
        ...state,
        loading: false,
        commits: action.commits,
        pending: action.pending,
        selection: clamp(
          state.selection,
          (state.mode === "history" ? action.commits.length : 3) - 1,
        ),
      }, action.pending, action.fingerprints ?? {}));
    case "files": {
      if (action.key !== filesKey(state)) return state;
      const source = selectedSource(state);
      return {
        ...state,
        commitReviewKeys: source?.kind === "commit"
          ? { ...state.commitReviewKeys, [source.commit.hash]: action.files.map((file) => reviewKey(state, file)) }
          : state.commitReviewKeys,
        files: action.files,
        fileRevision: state.fileRevision + 1,
        filesLoading: false,
        fileIndex: state.requestedFileKey
          ? action.files.findIndex((file) => reviewKey(state, file) === state.requestedFileKey)
          : visibleFiles({ ...state, files: action.files })[0]?.index ?? -1,
        notice: state.requestedFileKey && !action.files.some((file) => reviewKey(state, file) === state.requestedFileKey)
          ? "La tarea corresponde a un cambio que ya no está disponible." : state.notice,
        requestedFileKey: "",
        diff: null,
        scroll: 0,
        hunkAnchor: null,
      };
    }
    case "diff": {
      if (action.key !== diffKey(state)) return state;
      const file = state.files[state.fileIndex];
      const next = file && action.fingerprint !== undefined
        ? applyFingerprint(state, reviewKey(state, file), action.fingerprint) : state;
      return retainVisible({
            ...next,
            diff: action.diff,
            diffLoading: false,
            scroll: 0,
            hunkAnchor: null,
            imageSide: action.diff.image?.after ? "after" : "before",
          });
    }
    case "loading":
      if (
        action.key !==
        (action.target === "files" ? filesKey(state) : diffKey(state))
      )
        return state;
      return {
        ...state,
        [action.target === "files" ? "filesLoading" : "diffLoading"]: true,
      };
    case "error":
      if (
        action.key !==
        (action.target === "snapshot"
          ? String(state.revision)
          : action.target === "files"
            ? filesKey(state)
            : diffKey(state))
      )
        return state;
      return {
        ...state,
        error: action.message,
        ...(action.target === "snapshot"
          ? { loading: false }
          : action.target === "files"
            ? { filesLoading: false }
            : { diffLoading: false }),
      };
    default: return state;
  }
}
