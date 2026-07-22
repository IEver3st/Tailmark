import { create } from 'zustand';
import type {
  AppSettings, AppSnapshot, ArchiveAnalysis, InstallResult, ModType, OperationProgress,
} from '@shared/models';

type Page = 'installer' | 'library' | 'activity' | 'settings';

interface Notice { kind: 'success' | 'warning' | 'error'; title: string; detail: string; technical?: string | undefined }

interface AppStore {
  page: Page;
  snapshot: AppSnapshot | null;
  queue: ArchiveAnalysis[];
  selectedId: string | null;
  analysing: boolean;
  installing: boolean;
  progress: OperationProgress | null;
  results: InstallResult[];
  notice: Notice | null;
  setPage(page: Page): void;
  initialize(): Promise<void>;
  addPaths(paths: string[]): Promise<void>;
  chooseArchives(): Promise<void>;
  chooseFolder(): Promise<void>;
  removeItem(id: string): void;
  clearQueue(): void;
  select(id: string | null): void;
  overrideType(id: string, type: ModType): void;
  chooseRoot(id: string, root: string): void;
  installReady(): Promise<void>;
  retry(id: string): Promise<void>;
  cancel(): Promise<void>;
  refreshSnapshot(): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  dismissNotice(): void;
  showNotice(notice: Notice): void;
}

function operationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function failedAnalysis(path: string, message: string, technical?: string): ArchiveAnalysis {
  const filename = path.split(/[\\/]/).at(-1) ?? path;
  return {
    id: crypto.randomUUID(), archivePath: path, displayName: filename.replace(/\.zip$/i, ''), originalFilename: filename,
    archiveHash: '', fileCount: 0, uncompressedSize: 0, compressedSize: 0, entries: [],
    detected: { type: 'unsupported', confidence: 0, reasons: [], needsReview: true }, roots: [], transformations: [],
    proposedDestination: 'Unavailable', warnings: [{ code: 'analysis-failed', level: 'error', title: 'Archive could not be analysed', detail: message }],
    conflicts: [], status: 'failed', failure: { stage: 'analysis', message, ...(technical ? { technicalDetails: technical } : {}) },
  };
}

function applyDuplicateSetting(item: ArchiveAnalysis, ignoreDuplicateContent: boolean): ArchiveAnalysis {
  const duplicateWarning = item.warnings.some((warning) => warning.code === 'duplicate-skin' || warning.code === 'duplicate-sound');
  if (!duplicateWarning) return item;
  const type = item.manualType ?? item.detected.type;
  const duplicateRoots = new Set<string>();
  for (const conflict of item.conflicts) if (conflict.kind === 'duplicate-content') duplicateRoots.add(conflict.relativePath.toLowerCase());
  const everyRootIsDuplicate = type === 'sound' || (item.roots.length > 0 && (duplicateRoots.size === 0 || item.roots.every((root) => duplicateRoots.has(root.destinationName.toLowerCase()))));
  if (!everyRootIsDuplicate) return item;
  if (ignoreDuplicateContent && item.status === 'duplicate') return { ...item, status: 'skipped' };
  if (!ignoreDuplicateContent && item.status === 'skipped') return { ...item, status: 'duplicate' };
  return item;
}

export const useAppStore = create<AppStore>((set, get) => ({
  page: 'installer', snapshot: null, queue: [], selectedId: null, analysing: false, installing: false,
  progress: null, results: [], notice: null,
  setPage: (page) => set({ page }),
  initialize: async () => {
    const result = await window.tailmark.app.snapshot();
    if (result.ok && result.data) set({ snapshot: result.data });
    else set({ notice: { kind: 'error', title: 'Tailmark could not start', detail: result.error?.message ?? 'Application data could not be loaded.', technical: result.error?.details } });
    window.tailmark.events.onProgress((progress) => set({ progress }));
    window.tailmark.events.onSnapshot((snapshot) => set({ snapshot }));
  },
  addPaths: async (paths) => {
    const existing = new Set(get().queue.map((item) => item.archivePath.toLowerCase()));
    const unique = [...new Set(paths)].filter((path) => path.toLowerCase().endsWith('.zip') && !existing.has(path.toLowerCase()));
    if (!unique.length) {
      set({ notice: { kind: 'warning', title: 'No new ZIP archives found', detail: 'Choose ZIP files that are not already in the queue.' } });
      return;
    }
    const pendings = unique.map((path) => {
      const pending = failedAnalysis(path, 'Analysis is starting.');
      pending.status = 'analysing';
      pending.warnings = [];
      return pending;
    });
    const requestId = operationId('analyse');
    set((state) => ({
      analysing: true,
      notice: null,
      queue: [...state.queue, ...pendings],
      selectedId: state.selectedId ?? pendings[0]?.id ?? null,
      progress: {
        operationId: requestId,
        currentArchive: pendings[0]?.originalFilename ?? 'archives',
        operation: 'Reading ZIP directory',
        filesCompleted: 0,
        bytesProcessed: 0,
        itemsCompleted: 0,
        totalItems: unique.length,
        successes: 0,
        warnings: 0,
        failures: 0,
      },
    }));
    const result = await window.tailmark.archives.analyze({
      paths: unique,
      gameRoot: get().snapshot?.settings.gameRoot ?? null,
      operationId: requestId,
    });
    const byPath = new Map((result.ok && result.data ? result.data : []).map((item) => [item.archivePath.toLowerCase(), item]));
    const pendingIds = new Set(pendings.map((item) => item.id));
    set((state) => ({
      analysing: false,
      queue: state.queue.map((item) => {
        if (!pendingIds.has(item.id)) return item;
        const analyzed = byPath.get(item.archivePath.toLowerCase());
        if (analyzed) return { ...analyzed, id: item.id };
        if (!result.ok) return failedAnalysis(item.archivePath, result.error?.message ?? 'Analysis failed.', result.error?.details);
        return failedAnalysis(item.archivePath, 'Analysis did not return a result for this archive.');
      }),
    }));
  },
  chooseArchives: async () => { const result = await window.tailmark.dialogs.chooseArchives(); if (result.ok && result.data) await get().addPaths(result.data); },
  chooseFolder: async () => { const result = await window.tailmark.dialogs.chooseImportFolder(); if (result.ok && result.data) await get().addPaths(result.data); },
  removeItem: (id) => set((state) => ({ queue: state.queue.filter((item) => item.id !== id), selectedId: state.selectedId === id ? null : state.selectedId })),
  clearQueue: () => set({ queue: [], selectedId: null, results: [], progress: null }),
  select: (selectedId) => set({ selectedId }),
  overrideType: (id, type) => set((state) => ({ queue: state.queue.map((item) => {
    if (item.id !== id) return item;
    if (type === 'unsupported') { const { manualType: _manualType, ...rest } = item; return { ...rest, status: 'skipped' as const }; }
    if (type === 'skin' || type === 'sound') return { ...item, manualType: type, status: item.roots.length ? 'ready' as const : 'needs-review' as const };
    return item;
  }) })),
  chooseRoot: (id, root) => set((state) => ({ queue: state.queue.map((item) => item.id === id ? (root ? {
    ...item, manualRoot: root, roots: [{ sourcePrefix: root, destinationName: root.split('/').filter(Boolean).at(-1) ?? item.displayName, fileCount: item.entries.filter((entry) => entry.normalizedPath.startsWith(root)).length }], status: 'ready' as const,
  } : { ...item, manualRoot: '', roots: [], status: 'needs-review' as const }) : item) })),
  installReady: async () => {
    const state = get();
    if (!state.snapshot?.settings.gameRoot) { set({ notice: { kind: 'warning', title: 'War Thunder installation required', detail: 'Select a verified installation before installing or importing packages.' } }); return; }
    const ready = state.queue.filter((item) => ['ready', 'conflict', 'duplicate'].includes(item.status) && !item.warnings.some((warning) => warning.level === 'error'));
    if (!ready.length) { set({ notice: { kind: 'warning', title: 'Nothing is ready to install', detail: 'Review problem items or add more archives.' } }); return; }
    const id = operationId('install');
    set({ installing: true, results: [], notice: null, progress: { operationId: id, operation: 'Preparing installation', filesCompleted: 0, bytesProcessed: 0, itemsCompleted: 0, totalItems: ready.length, successes: 0, warnings: 0, failures: 0 } });
    const result = await window.tailmark.install.run({ analyses: ready, collisionPolicy: state.snapshot.settings.defaultDuplicateBehaviour, operationId: id });
    if (result.ok && result.data) {
      const completed = result.data;
      const byId = new Map(completed.map((item) => [item.archiveId, item]));
      set((current) => ({
        installing: false, results: completed,
        queue: current.queue.map((item) => {
          const installResult = byId.get(item.id); if (!installResult) return item;
          const { failure: _previousFailure, ...withoutFailure } = item;
          return {
            ...withoutFailure,
            status: installResult.status === 'imported' || installResult.status === 'installed' ? 'installed' : installResult.status,
            ...(!installResult.success ? { failure: { stage: 'installation' as const, message: installResult.message, ...(installResult.technicalDetails ? { technicalDetails: installResult.technicalDetails } : {}) } } : {}),
          };
        }),
        selectedId: completed.find((item) => !item.success)?.archiveId ?? current.selectedId,
        notice: (() => {
          const succeeded = completed.filter((item) => item.success && item.status !== 'skipped').length;
          const skipped = completed.filter((item) => item.status === 'skipped').length;
          const failed = completed.filter((item) => !item.success);
          const deleted = completed.filter((item) => item.sourceZipDeleted).length;
          const cleanupWarnings = completed.filter((item) => item.cleanupWarning);
          const summary = `${succeeded} completed, ${skipped} skipped, ${failed.length} failed.${deleted ? ` ${deleted} source ZIP${deleted === 1 ? '' : 's'} moved to the Recycle Bin.` : ''}`;
          if (!failed.length && cleanupWarnings.length) return { kind: 'warning' as const, title: 'Installed with cleanup warning', detail: `${summary} ${cleanupWarnings[0]?.cleanupWarning}` };
          if (!failed.length) return { kind: skipped ? 'warning' as const : 'success' as const, title: 'Batch operation complete', detail: summary };
          const first = failed[0];
          const archive = current.queue.find((item) => item.id === first?.archiveId)?.displayName ?? 'Archive';
          return { kind: 'error' as const, title: 'Batch completed with failures', detail: `${summary} ${archive}: ${first?.message ?? 'No failure reason was returned.'}${failed.length > 1 ? ' Select each failed item to review its reason.' : ''}` };
        })(),
      }));
      await get().refreshSnapshot();
    } else set({ installing: false, notice: { kind: 'error', title: 'Installation stopped', detail: result.error?.message ?? 'No files were changed.', technical: result.error?.details } });
  },
  retry: async (id) => { const item = get().queue.find((entry) => entry.id === id); if (!item) return; get().removeItem(id); await get().addPaths([item.archivePath]); },
  cancel: async () => { const id = get().progress?.operationId; if (id) await window.tailmark.archives.cancel(id); set({ analysing: false, installing: false }); },
  refreshSnapshot: async () => { const result = await window.tailmark.app.snapshot(); if (result.ok && result.data) set({ snapshot: result.data }); },
  updateSettings: async (patch) => { const result = await window.tailmark.settings.update(patch); if (result.ok && result.data) set((state) => ({ snapshot: state.snapshot ? { ...state.snapshot, settings: result.data as AppSettings } : state.snapshot, queue: patch.ignoreDuplicateContent === undefined ? state.queue : state.queue.map((item) => applyDuplicateSetting(item, result.data?.ignoreDuplicateContent ?? true)) })); else set({ notice: { kind: 'error', title: 'Setting was not saved', detail: result.error?.message ?? 'Try again.', technical: result.error?.details } }); },
  dismissNotice: () => set({ notice: null }),
  showNotice: (notice) => set({ notice }),
}));
