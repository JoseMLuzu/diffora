import { useEffect, useMemo, useReducer, useRef } from "react";
import type { Repository } from "../git/repository.js";
import { identityKey, emptyProgress } from "../core/progress.js";
import { ProgressStore } from "./progressStore.js";
import { openEditor } from "./editor.js";
import { reviewReport } from "./report.js";
import {
  progressOf, reviewTasks, editorLocation, type Fingerprints,
} from "./reviewWorkflow.js";
import {
  diffKey, filesKey, initialState, reducer, selectedSource, categories, type State,
} from "./state.js";

/** Bound concurrent Git processes; only marked/noted files and the current diff need an audit. */
export async function pendingFingerprints(repo: Repository, pending: State["pending"], state: State, signal: AbortSignal): Promise<Fingerprints> {
  const wanted = new Set([...state.reviewed, ...state.needsReview, ...Object.keys(state.notes)]);
  const selected = selectedSource(state);
  const file = state.files[state.fileIndex];
  if (selected && selected.kind !== "commit" && file) wanted.add(identityKey(selected, file));
  const jobs = categories.flatMap((kind) => pending[kind].flatMap((file) => {
    const key = identityKey({ kind }, file);
    return wanted.has(key) ? [{ kind, file, key }] : [];
  }));
  const result: Fingerprints = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    for (;;) {
      const job = jobs[next++];
      if (!job) break;
      try { result[job.key] = await repo.fingerprint({ kind: job.kind }, job.file, signal); }
      catch { signal.throwIfAborted(); result[job.key] = null; }
    }
  }));
  return result;
}
export function useReview(repo: Repository) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const store = useMemo(() => new ProgressStore(repo.root), [repo.root]);
  const current = useRef(state);
  current.current = state;
  const operations = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of operations.current) controller.abort(); }, []);
  useEffect(() => {
    let alive = true;
    store.load().then(
      (progress) => { if (alive) dispatch({ type: "progress-loaded", progress }); },
      (error: unknown) => { if (alive) dispatch({ type: "progress-loaded", progress: emptyProgress(),
        warning: `No se cargó el progreso; el archivo original se conserva: ${String(error)}` }); },
    );
    return () => { alive = false; };
  }, [store]);
  useEffect(() => {
    if (!state.progressReady) return;
    let alive = true;
    const timer = setTimeout(() => {
      store.save(progressOf(current.current)).then(
        () => { if (alive && current.current.storageWarning) dispatch({ type: "storage-warning", message: "" }); },
        (error: unknown) => { if (alive) dispatch({ type: "storage-warning", message: `Progreso no guardado: ${String(error)}` }); },
      );
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [store, state.progressReady, state.reviewed, state.needsReview, state.notes, state.fingerprints, state.commitReviewKeys, state.diffLayout]);
  useEffect(() => {
    if (!state.progressReady) return;
    let alive = true;
    const controller = new AbortController();
    const revision = state.revision;
    Promise.all([repo.commits(controller.signal), repo.pending(controller.signal)]).then(
      async ([commits, pending]) => {
        const fingerprints = await pendingFingerprints(repo, pending, current.current, controller.signal);
        if (alive) dispatch({ type: "snapshot", revision, commits, pending, fingerprints });
      },
    ).catch((error: unknown) => {
      if (alive) dispatch({ type: "error", target: "snapshot", key: String(revision), message: String(error) });
    });
    return () => { alive = false; controller.abort(); };
  }, [repo, state.revision, state.progressReady]);

  // Poll without touching Git's index. An audit never overlaps itself; abort on refresh/unmount.
  useEffect(() => {
    if (!state.progressReady || state.loading) return;
    let alive = true, busy = false;
    const controller = new AbortController();
    const revision = state.revision;
    const audit = async () => {
      if (busy || !alive) return;
      busy = true;
      try {
        const pending = await repo.pending(controller.signal);
        const fingerprints = await pendingFingerprints(repo, pending, current.current, controller.signal);
        if (alive) dispatch({ type: "pending-audit", revision, pending, fingerprints });
      } catch (error) {
        if (alive) dispatch({ type: "notice", message: `No se pudo comprobar cambios externos: ${String(error)}` });
      } finally { busy = false; }
    };
    const timer = setInterval(() => { void audit(); }, 2000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, [repo, state.progressReady, state.loading, state.revision]);

  const source = selectedSource(state);
  const sourceKey = filesKey(state);
  useEffect(() => {
    if (!state.progressReady || state.loading || !source) return;
    let alive = true;
    const controller = new AbortController();
    dispatch({ type: "loading", target: "files", key: sourceKey });
    repo.files(source, controller.signal).then(
      (files) => { if (alive) dispatch({ type: "files", key: sourceKey, files }); },
      (error: unknown) => { if (alive) dispatch({ type: "error", target: "files", key: sourceKey, message: String(error) }); },
    );
    return () => { alive = false; controller.abort(); };
  }, [repo, sourceKey, state.loading, state.progressReady]);
  const file = state.files[state.fileIndex];
  const fileKey = diffKey(state);
  useEffect(() => {
    if (!source || !file) return;
    let alive = true;
    const controller = new AbortController();
    dispatch({ type: "loading", target: "diff", key: fileKey });
    const load = async () => {
      let before: string | null = null;
      try { before = await repo.fingerprint(source, file, controller.signal); }
      catch { controller.signal.throwIfAborted(); }
      const diff = await repo.diff(source, file, controller.signal);
      let fingerprint: string | null = null;
      try { fingerprint = await repo.fingerprint(source, file, controller.signal); }
      catch { controller.signal.throwIfAborted(); }
      if (before !== fingerprint) throw new Error("El archivo cambió al cargar el diff; pulsa r para reintentarlo.");
      if (alive) {
        dispatch({ type: "diff", key: fileKey, diff, fingerprint });
        if (!fingerprint && source.kind !== "commit") dispatch({ type: "notice", message: "No se pudo validar este archivo: se muestra, pero no se puede marcar como terminado." });
      }
    };
    load().catch((error: unknown) => {
      if (alive) dispatch({ type: "error", target: "diff", key: fileKey, message: String(error) });
    });
    return () => { alive = false; controller.abort(); };
  }, [repo, fileKey, file]);

  const flush = async () => {
    if (current.current.progressReady) await store.save(progressOf(current.current));
  };
  const exportReport = async () => {
    const snapshot = current.current;
    if (snapshot.loading || snapshot.filesLoading || !selectedSource(snapshot)) {
      dispatch({ type: "notice", message: "Espera a que cargue la lista completa antes de exportar." }); return;
    }
    try {
      const path = await store.exportMarkdown(reviewReport(repo.root, snapshot));
      dispatch({ type: "report-saved", path });
    } catch (error) { dispatch({ type: "notice", message: `No se pudo exportar: ${String(error)}` }); }
  };
  const launchEditor = async () => {
    const location = editorLocation(current.current);
    if (!location) { dispatch({ type: "notice", message: "Entra al diff y selecciona una línea primero." }); return; }
    try {
      await openEditor(repo.root, location);
      dispatch({ type: "notice", message: `Enviado al editor: ${location.path}:${location.line} (archivo actual del working tree).` });
    } catch (error) { dispatch({ type: "notice", message: `No se pudo abrir el editor: ${String(error)}` }); }
  };
  const openTask = async () => {
    const task = reviewTasks(current.current)[current.current.taskIndex];
    if (!task) return;
    const controller = new AbortController();
    operations.current.add(controller);
    try {
      const commit = task.kind === "commit" && !current.current.commits.some((commit) => commit.hash === task.commit)
        ? await repo.commit(task.commit, controller.signal) : undefined;
      if (!controller.signal.aborted && current.current.overlay === "tasks"
        && reviewTasks(current.current)[current.current.taskIndex]?.key === task.key)
        dispatch({ type: "task-open", key: task.key, ...(commit ? { commit } : {}) });
    } catch (error) { if (!controller.signal.aborted) dispatch({ type: "notice", message: `No se pudo abrir la tarea: ${String(error)}` }); }
    finally { operations.current.delete(controller); }
  };
  return { state, dispatch, flush, exportReport, launchEditor, openTask };
}
