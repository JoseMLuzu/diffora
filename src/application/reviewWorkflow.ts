import type { Commit, Source } from "../core/models.js";
import { identityKey, parseIdentity, emptyProgress, type Progress } from "../core/progress.js";
import { safeText } from "../core/diff.js";
import { splitDiff } from "../core/splitDiff.js";
import { tr } from "../core/i18n.js";
import {
  selectedSource, visibleFiles, reviewKey, fileReviewStatus, diffRowCount, isSplitDiff,
  clearFiles, selectFile, reducer, categories, type State,
} from "./state.js";
import type { EditorLocation } from "./editor.js";

export type Fingerprints = Record<string, string | null>;
export type WorkflowAction =
  | { type: "progress-loaded"; progress: Progress; warning?: string }
  | { type: "pending-audit"; revision: number; pending: State["pending"]; fingerprints: Fingerprints }
  | { type: "remaining-toggle" }
  | { type: "next-remaining" }
  | { type: "hunk"; direction: 1 | -1; pageSize: number }
  | { type: "note-start" }
  | { type: "note-draft"; text: string }
  | { type: "note-save" }
  | { type: "note-cancel" }
  | { type: "overlay"; overlay: State["overlay"] }
  | { type: "task-move"; delta: number }
  | { type: "task-open"; key: string; commit?: Commit }
  | { type: "notice"; message: string }
  | { type: "storage-warning"; message: string }
  | { type: "report-saved"; path: string };

export function progressOf(s: State): Progress {
  const keys = new Set([...s.reviewed, ...s.needsReview, ...Object.keys(s.notes)]);
  return {
    reviewed: s.reviewed, needsReview: s.needsReview, notes: s.notes,
    fingerprints: Object.fromEntries(Object.entries(s.fingerprints).filter(([key]) => keys.has(key))),
    commitReviewKeys: s.commitReviewKeys, diffLayout: s.diffLayout,
  };
}
export function canReview(s: State): boolean {
  const file = s.files[s.fileIndex];
  return s.panel !== 0 && !!file && !!s.diff && !s.diffLoading && !s.error
    && (!s.progressReady || selectedSource(s)?.kind === "commit" || !!s.fingerprints[reviewKey(s, file)]);
}
export function retainVisible(s: State): State {
  const visible = visibleFiles(s);
  if (visible.some((file) => file.index === s.fileIndex)) return s;
  return selectFile(s, visible.find((file) => file.index > s.fileIndex)?.index ?? visible[0]?.index ?? -1);
}
export function applyFingerprint(s: State, key: string, fingerprint: string | null): State {
  const identity = parseIdentity(key);
  const changed = identity?.kind !== "commit" && s.fingerprints[key] !== fingerprint;
  const fingerprints = { ...s.fingerprints };
  if (fingerprint) fingerprints[key] = fingerprint;
  else delete fingerprints[key];
  return {
    ...s, fingerprints,
    reviewed: changed ? s.reviewed.filter((item) => item !== key) : s.reviewed,
    needsReview: changed ? s.needsReview.filter((item) => item !== key) : s.needsReview,
    notes: changed && s.notes[key] ? { ...s.notes, [key]: { ...s.notes[key]!, stale: true } } : s.notes,
  };
}
export function applyPending(s: State, pending: State["pending"], fingerprints: Fingerprints): State {
  const existing = new Set(categories.flatMap((kind) => pending[kind].map((file) => identityKey({ kind }, file))));
  const keys = new Set([...s.reviewed, ...s.needsReview, ...Object.keys(s.notes), ...Object.keys(fingerprints)]);
  let next = { ...s, pending };
  let invalidated = 0;
  for (const key of keys) {
    if (parseIdentity(key)?.kind === "commit") continue;
    if (!existing.has(key) || Object.hasOwn(fingerprints, key)) {
      const marked = next.reviewed.includes(key) || next.needsReview.includes(key);
      next = applyFingerprint(next, key, existing.has(key) ? fingerprints[key] ?? null : null);
      if (marked && !next.reviewed.includes(key) && !next.needsReview.includes(key)) invalidated++;
    }
  }
  if (invalidated) next.notice = tr(`Cambios detectados: ${invalidated} marca(s) invalidada(s); revisa de nuevo.`, `Changes detected: ${invalidated} review mark(s) cleared; review again.`);
  return next;
}
export function summary(s: State) {
  const statuses = s.files.map((file) => fileReviewStatus(s, file));
  return {
    total: statuses.length,
    reviewed: statuses.filter((status) => status === "reviewed").length,
    needsReview: statuses.filter((status) => status === "needs-review").length,
    unreviewed: statuses.filter((status) => status === "unreviewed").length,
  };
}
export function reviewTasks(s: State) {
  const keys = new Set([...s.needsReview, ...Object.keys(s.notes).filter((key) => !s.reviewed.includes(key))]);
  return [...keys].flatMap((key) => {
    const identity = parseIdentity(key);
    return identity ? [{ key, ...identity, note: s.notes[key]?.text ?? "", stale: s.notes[key]?.stale ?? false, pending: s.needsReview.includes(key) }] : [];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.commit.localeCompare(b.commit) || a.path.localeCompare(b.path));
}
export function editorLocation(s: State): EditorLocation | null {
  const file = s.files[s.fileIndex];
  if (!file || s.panel !== 2 || !s.diff || s.diffLoading) return null;
  if (isSplitDiff(s) && s.hunkAnchor === null) {
    const paired = splitDiff(s.diff.lines).slice(s.scroll);
    const newLine = paired.find((row) => row.after?.new !== undefined)?.after?.new;
    if (newLine !== undefined) return { path: file.path, line: newLine, column: 1 };
  }
  const start = s.hunkAnchor ?? (isSplitDiff(s) ? splitDiff(s.diff.lines)[s.scroll]?.sourceIndices[0] ?? 0 : s.scroll);
  const tail = s.diff.lines.slice(start);
  const line = tail.find((l) => l.new !== undefined)?.new ?? tail.find((l) => l.old !== undefined)?.old ?? 1;
  return { path: file.path, line, column: 1 };
}
export function reduceWorkflow(s: State, action: WorkflowAction | { type: string }): State | undefined {
  switch (action.type) {
    case "progress-loaded": {
      const a = action as Extract<WorkflowAction, { type: "progress-loaded" }>;
      return { ...s, ...a.progress, progressReady: true, storageWarning: a.warning ?? "" };
    }
    case "pending-audit": {
      const a = action as Extract<WorkflowAction, { type: "pending-audit" }>;
      if (a.revision !== s.revision || s.loading) return s;
      const source = selectedSource(s);
      const file = s.files[s.fileIndex];
      const key = file ? reviewKey(s, file) : "";
      const changed = Object.hasOwn(a.fingerprints, key) && s.fingerprints[key] !== a.fingerprints[key];
      let next = applyPending(s, a.pending, a.fingerprints);
      if (source && source.kind !== "commit") {
        if (JSON.stringify(s.pending[source.kind]) !== JSON.stringify(a.pending[source.kind])) next = clearFiles(next);
        else if (changed) next = { ...next, fileRevision: next.fileRevision + 1, diff: null, diffLoading: false, scroll: 0, hunkAnchor: null };
      }
      return retainVisible(next);
    }
    case "remaining-toggle":
      return retainVisible({ ...s, onlyRemaining: !s.onlyRemaining, panel: s.panel === 0 ? 1 : s.panel });
    case "next-remaining": {
      const candidates = visibleFiles(s).filter(({ file }) => fileReviewStatus(s, file) !== "reviewed");
      const target = candidates.find((file) => file.index > s.fileIndex) ?? candidates[0];
      return target ? selectFile({ ...s, panel: s.panel === 2 ? 2 : 1 }, target.index)
        : { ...s, notice: tr("No quedan archivos por revisar en este filtro.", "No files left to review in this filter.") };
    }
    case "hunk": {
      const a = action as Extract<WorkflowAction, { type: "hunk" }>;
      if (s.panel !== 2 || !s.diff || s.diff.image) return s;
      const rendered = isSplitDiff(s) ? splitDiff(s.diff.lines)
        : s.diff.lines.map((shared, index) => ({ shared, sourceIndices: [index] }));
      const positions = rendered.flatMap((row, position) => row.shared?.kind === "header"
        ? [{ position, index: row.sourceIndices[0]! }] : []);
      const current = s.hunkAnchor === null ? s.scroll
        : positions.find((hunk) => hunk.index === s.hunkAnchor)?.position ?? s.scroll;
      const target = a.direction === 1 ? positions.find((hunk) => hunk.position > current)
        : [...positions].reverse().find((hunk) => hunk.position < current);
      return target ? { ...s, hunkAnchor: target.index, scroll: Math.max(0, Math.min(target.position, diffRowCount(s) - a.pageSize)), notice: tr(`Bloque: ${s.diff.lines[target.index]!.text}`, `Hunk: ${s.diff.lines[target.index]!.text}`) }
        : { ...s, notice: a.direction === 1 ? tr("No hay más bloques.", "No more hunks.") : tr("Primer bloque alcanzado.", "At the first hunk.") };
    }
    case "note-start": {
      if (!canReview(s)) return { ...s, notice: tr("Carga y valida el diff antes de añadir una nota.", "Load and verify the diff before adding a note.") };
      const key = reviewKey(s, s.files[s.fileIndex]!);
      return { ...s, noteEditing: true, noteDraft: s.notes[key]?.text ?? "", noteTarget: key, noteFingerprint: s.fingerprints[key] ?? "" };
    }
    case "note-draft": {
      const a = action as Extract<WorkflowAction, { type: "note-draft" }>;
      return { ...s, noteDraft: Array.from(safeText(a.text).replace(/[\r\n]/g, " ")).slice(0, 1000).join("") };
    }
    case "note-cancel":
      return { ...s, noteEditing: false, noteDraft: "", noteTarget: "", noteFingerprint: "" };
    case "note-save": {
      if (!s.noteEditing || !s.noteTarget) return s;
      const key = s.noteTarget;
      const text = s.noteDraft.trim();
      const notes = { ...s.notes };
      const stale = s.noteFingerprint !== (s.fingerprints[key] ?? "");
      if (text) notes[key] = { text, stale };
      else delete notes[key];
      return {
        ...s, notes, noteEditing: false, noteTarget: "", noteDraft: "", noteFingerprint: "",
        reviewed: text && !stale ? s.reviewed.filter((item) => item !== key) : s.reviewed,
        needsReview: text && !stale ? [...new Set([...s.needsReview, key])] : s.needsReview,
        notice: text ? stale ? tr("Nota conservada; el contenido cambió y requiere otra revisión.", "Note kept; content changed and needs another review.") : tr("Nota guardada · pendiente de revisión.", "Note saved · needs review.") : tr("Nota eliminada.", "Note removed."),
      };
    }
    case "overlay": {
      const a = action as Extract<WorkflowAction, { type: "overlay" }>;
      return { ...s, overlay: a.overlay, taskIndex: 0 };
    }
    case "task-move": {
      const a = action as Extract<WorkflowAction, { type: "task-move" }>;
      return { ...s, taskIndex: Math.max(0, Math.min(s.taskIndex + a.delta, reviewTasks(s).length - 1)) };
    }
    case "task-open": {
      const a = action as Extract<WorkflowAction, { type: "task-open" }>;
      const identity = parseIdentity(a.key);
      if (!identity) return s;
      let next = s;
      if (identity.kind === "commit") {
        const commit = s.commits.find((c) => c.hash === identity.commit) ?? a.commit;
        if (!commit) return { ...s, notice: tr("El commit necesita cargarse antes de abrir la tarea.", "Load the commit before opening this task.") };
        if (!next.commits.some((c) => c.hash === commit.hash)) next = { ...next, commits: [...next.commits, commit] };
        next = reducer(next, { type: "mode", mode: "history" });
        next = reducer(next, { type: "move", delta: next.commits.findIndex((c) => c.hash === identity.commit) - next.selection, pageSize: 1 });
      } else {
        next = reducer(next, { type: "mode", mode: "pending" });
        next = reducer(next, { type: "move", delta: categories.indexOf(identity.kind) - next.selection, pageSize: 1 });
      }
      next = { ...next, overlay: "none", panel: 1, onlyRemaining: false, searchQuery: "", requestedFileKey: a.key };
      if (next.files.length) {
        const index = next.files.findIndex((file) => reviewKey(next, file) === a.key);
        if (index >= 0) return selectFile({ ...next, requestedFileKey: "" }, index);
        return { ...next, requestedFileKey: "", notice: tr("La tarea corresponde a un cambio que ya no está disponible.", "This task refers to a change that is no longer available.") };
      }
      return next;
    }
    case "notice":
      return { ...s, notice: safeText((action as Extract<WorkflowAction, { type: "notice" }>).message) };
    case "storage-warning":
      return { ...s, storageWarning: safeText((action as Extract<WorkflowAction, { type: "storage-warning" }>).message) };
    case "report-saved":
      return { ...s, lastReport: (action as Extract<WorkflowAction, { type: "report-saved" }>).path, overlay: "summary", notice: tr("Informe Markdown exportado.", "Markdown report exported.") };
  }
}
