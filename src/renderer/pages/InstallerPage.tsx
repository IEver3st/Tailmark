import { AlertTriangle, FolderSearch2, PackageCheck, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ArchiveAnalysis } from '@shared/models';
import { DropZone } from '../features/installer/DropZone';
import { QueueTable } from '../features/installer/QueueTable';
import { ReviewInspector } from '../features/installer/ReviewInspector';
import { useAppStore } from '../stores/app-store';
import { ConfirmDialog } from '../components/ConfirmDialog';

type Filter = 'all' | 'ready' | 'problems' | 'skin' | 'sound';

function isFullyIgnoredDuplicate(item: ArchiveAnalysis, ignoreDuplicateContent: boolean): boolean {
  if (!ignoreDuplicateContent || !item.warnings.some((warning) => warning.code === 'duplicate-skin' || warning.code === 'duplicate-sound')) return false;
  if ((item.manualType ?? item.detected.type) === 'sound') return true;
  const duplicateRoots = new Set<string>();
  for (const conflict of item.conflicts) if (conflict.kind === 'duplicate-content') duplicateRoots.add(conflict.relativePath.toLowerCase());
  return item.roots.length > 0 && (duplicateRoots.size === 0 || item.roots.every((root) => duplicateRoots.has(root.destinationName.toLowerCase())));
}

function isInstallable(item: ArchiveAnalysis, ignoreDuplicateContent: boolean): boolean {
  return ['ready', 'conflict', 'duplicate'].includes(item.status) && !isFullyIgnoredDuplicate(item, ignoreDuplicateContent);
}

export function InstallerPage(): React.JSX.Element {
  const queue = useAppStore((state) => state.queue);
  const selectedId = useAppStore((state) => state.selectedId);
  const analysing = useAppStore((state) => state.analysing);
  const installing = useAppStore((state) => state.installing);
  const snapshot = useAppStore((state) => state.snapshot);
  const progress = useAppStore((state) => state.progress);
  const chooseArchives = useAppStore((state) => state.chooseArchives);
  const chooseFolder = useAppStore((state) => state.chooseFolder);
  const clearQueue = useAppStore((state) => state.clearQueue);
  const installReady = useAppStore((state) => state.installReady);
  const setPage = useAppStore((state) => state.setPage);
  const cancel = useAppStore((state) => state.cancel);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const selected = queue.find((item) => item.id === selectedId) ?? null;
  const ignoreDuplicateContent = snapshot?.settings.ignoreDuplicateContent ?? true;
  const stats = useMemo(() => ({
    skins: queue.filter((item) => (item.manualType ?? item.detected.type) === 'skin' && isInstallable(item, ignoreDuplicateContent)).length,
    sounds: queue.filter((item) => (item.manualType ?? item.detected.type) === 'sound' && isInstallable(item, ignoreDuplicateContent)).length,
    duplicates: queue.filter((item) => item.warnings.some((warning) => warning.code === 'duplicate-skin' || warning.code === 'duplicate-sound')).length,
    problems: queue.filter((item) => ['needs-review', 'failed'].includes(item.status)).length,
  }), [queue, ignoreDuplicateContent]);
  const visible = queue.filter((item) => {
    const matchesSearch = !search || `${item.displayName} ${item.originalFilename} ${item.proposedDestination}`.toLowerCase().includes(search.toLowerCase());
    const type = item.manualType ?? item.detected.type;
    const matchesFilter = filter === 'all' || (filter === 'ready' && isInstallable(item, ignoreDuplicateContent)) || (filter === 'problems' && ['needs-review', 'failed'].includes(item.status)) || filter === type;
    return matchesSearch && matchesFilter;
  });
  const duplicateItems = ignoreDuplicateContent ? [] : queue.filter((item) => item.status === 'duplicate');
  const requestReplacementReview = () => {
    const policy = snapshot?.settings.defaultDuplicateBehaviour;
    if (snapshot?.settings.confirmBeforeReplacement && (policy === 'replace' || policy === 'merge') && queue.some((item) => item.conflicts.length > 0)) setConfirmReplace(true);
    else void installReady();
  };
  const requestInstall = () => {
    if (duplicateItems.length) setConfirmDuplicates(true);
    else requestReplacementReview();
  };

  if (!queue.length) return <main className="page installer-empty"><div className="page-toolbar"><div><h1>Installer</h1><span>Analyse and install mod archives safely.</span></div></div>{!snapshot?.installation?.valid ? <section className="game-missing"><AlertTriangle /><div><strong>War Thunder was not found</strong><span>Select the installation folder before installing. You can still analyse archives now.</span></div><button type="button" onClick={() => setPage('settings')}>Open Settings</button></section> : null}<DropZone /></main>;

  return <main className={`page installer-page ${selected ? 'with-inspector' : ''}`}>
    <div className="page-toolbar"><div><h1>Installer</h1><span>{queue.length} {queue.length === 1 ? 'archive' : 'archives'} in queue</span></div><div className="toolbar-actions"><button type="button" className="compact" onClick={() => void chooseArchives()}><Plus />Add files</button><button type="button" className="compact" onClick={() => void chooseFolder()}><FolderSearch2 />Add folder</button></div></div>
    <section className="analysis-summary" aria-label="Analysis summary">
      <div><strong>{queue.length}</strong><span>analysed</span></div><div><strong>{stats.skins}</strong><span>skins ready</span></div><div><strong>{stats.sounds}</strong><span>sound mods ready</span></div><div><strong>{stats.duplicates}</strong><span>duplicates</span></div><div className={stats.problems ? 'warning' : ''}><strong>{stats.problems}</strong><span>need review</span></div>
      <div className="summary-actions"><button type="button" className="primary" disabled={installing || analysing || (!stats.skins && !stats.sounds)} onClick={requestInstall}><PackageCheck />Install ready items</button><button type="button" disabled={!stats.problems} onClick={() => setFilter('problems')}>Review problems</button><button type="button" className="text-button" onClick={clearQueue}><Trash2 />Clear queue</button></div>
    </section>
    <div className="queue-toolbar"><label className="search-field"><Search /><span className="sr-only">Search archives</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search queue" />{search ? <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X /></button> : null}</label><div className="filter-tabs" role="group" aria-label="Filter queue">{(['all', 'ready', 'problems', 'skin', 'sound'] as const).map((value) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'skin' ? 'Skins' : value === 'sound' ? 'Sounds' : value[0]?.toUpperCase() + value.slice(1)}</button>)}</div></div>
    <div className="queue-workspace"><QueueTable items={visible} />{selected ? <ReviewInspector item={selected} /> : null}</div>
    {(analysing || installing) && progress ? <section className="progress-strip" aria-live="polite"><div className="progress-main"><span className="spinner" /><div><strong>{progress.currentArchive ?? 'Working through queue'}</strong><span>{progress.operation} · {progress.filesCompleted.toLocaleString()} files · {progress.itemsCompleted}/{progress.totalItems} items</span></div></div>{progress.totalBytes ? <div className="progress-track"><span style={{ width: `${Math.min(100, progress.bytesProcessed / progress.totalBytes * 100)}%` }} /></div> : <div className="progress-track indeterminate"><span /></div>}<div className="progress-counts"><span className="success">{progress.successes} succeeded</span><span>{progress.warnings} skipped</span><span className="danger">{progress.failures} failed</span></div><button type="button" onClick={() => void cancel()}>Cancel safely</button></section> : null}
    <ConfirmDialog open={confirmReplace} title="Replace existing mod folders?" detail={`The ${snapshot?.settings.defaultDuplicateBehaviour ?? 'replace'} policy will apply to every destination conflict in this batch. Tailmark creates a backup before each change and rolls back failed commits.`} confirmLabel="Back up and continue" onCancel={() => setConfirmReplace(false)} onConfirm={() => { setConfirmReplace(false); void installReady(); }} />
    <ConfirmDialog open={confirmDuplicates} title="Install duplicate content?" detail={`${duplicateItems.length} ${duplicateItems.length === 1 ? 'archive matches content already installed' : 'archives match content already installed'}. Continuing can create another copy; no duplicate is installed silently.`} confirmLabel="Continue with duplicates" onCancel={() => setConfirmDuplicates(false)} onConfirm={() => { setConfirmDuplicates(false); requestReplacementReview(); }} />
  </main>;
}
