import {
  AlertTriangle, ArchiveRestore, CheckCircle2, Download, Eye, FolderOpen, Layers3,
  PackagePlus, Play, Power, RotateCcw, ShieldCheck, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ManagedHangar, ManagedSight, SkinCollection } from '@shared/models';
import { formatBytes, formatDate } from '../../lib/format';
import { useAppStore } from '../../stores/app-store';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function OperationalStrip(): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot);
  const refresh = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const [working, setWorking] = useState(false);
  if (!snapshot) return <section className="operations-strip" aria-label="Managed content status" />;

  const run = async (
    operation: Promise<{ ok: boolean; error?: { message: string; details?: string } }>,
    success: string,
  ) => {
    setWorking(true);
    const result = await operation;
    setWorking(false);
    if (result.ok) {
      showNotice({ kind: 'success', title: success, detail: 'The managed-content state and recovery journal were updated.' });
      await refresh();
    } else {
      showNotice({ kind: 'error', title: 'Operation failed', detail: result.error?.message ?? 'No changes were made.', technical: result.error?.details });
      await refresh();
    }
  };

  const automationLabel = snapshot.downloadAutomation.status === 'watching'
    ? 'Downloads automation on'
    : snapshot.downloadAutomation.status === 'processing'
      ? 'Installing downloaded skin'
      : snapshot.downloadAutomation.status === 'off'
        ? 'Downloads automation off'
        : snapshot.downloadAutomation.status.replaceAll('-', ' ');

  return <section className={`operations-strip ${snapshot.recovery ? 'needs-recovery' : ''}`} aria-label="Managed content status">
    <div className="operation-state"><Download /><span><strong>{automationLabel}</strong><small>{snapshot.downloadAutomation.folder}</small></span></div>
    <div className="operation-state"><ShieldCheck /><span><strong>{snapshot.safeMode.active ? 'Safe Mode active' : 'Normal operation'}</strong><small>{snapshot.safeMode.active ? 'Tailmark-managed content is stored safely.' : 'Managed content may be active in War Thunder.'}</small></span></div>
    {snapshot.recovery ? <div className="recovery-inline" role="alert"><AlertTriangle /><span><strong>Recovery required</strong><small>{snapshot.recovery.label} stopped during {snapshot.recovery.phase}.</small></span>{snapshot.recovery.canResume ? <button type="button" disabled={working} onClick={() => void run(window.tailmark.recovery.resume(), 'Operation resumed')}><Play />Resume</button> : null}<button type="button" disabled={working} onClick={() => void run(window.tailmark.recovery.rollback(), 'Operation rolled back')}><ArchiveRestore />Roll back safely</button></div> : <button type="button" className={snapshot.safeMode.active ? '' : 'primary'} disabled={working || snapshot.gameRunning} onClick={() => void run(snapshot.safeMode.active ? window.tailmark.safeMode.restore() : window.tailmark.safeMode.enter(), snapshot.safeMode.active ? 'Managed content restored' : 'Safe Mode active')}>{snapshot.safeMode.active ? <RotateCcw /> : <ShieldCheck />}{snapshot.safeMode.active ? 'Restore managed content' : 'Enter Safe Mode'}</button>}
  </section>;
}

export function CollectionsView({ search }: { search: string }): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const refresh = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.collections[0]?.id ?? null);
  const [name, setName] = useState('');
  const [removeTarget, setRemoveTarget] = useState<SkinCollection | null>(null);
  const selected = snapshot.collections.find((item) => item.id === selectedId) ?? snapshot.collections[0] ?? null;
  const [members, setMembers] = useState<string[]>(selected?.skinIds ?? []);
  useEffect(() => { setMembers(selected?.skinIds ?? []); }, [selected?.id, selected?.updatedAt]);
  const managedSkins = snapshot.skins.filter((skin) => !skin.id.startsWith('external:'));
  const filteredCollections = snapshot.collections.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

  const report = async (
    promise: Promise<{ ok: boolean; error?: { message: string; details?: string } }>,
    title: string,
  ) => {
    const result = await promise;
    if (result.ok) {
      showNotice({ kind: 'success', title, detail: 'The managed skin library was updated.' });
      await refresh();
    } else showNotice({ kind: 'error', title: 'Collection operation failed', detail: result.error?.message ?? 'No changes were made.', technical: result.error?.details });
  };
  const create = async () => {
    if (!name.trim()) return;
    const result = await window.tailmark.library.createCollection(name.trim());
    if (result.ok && result.data) {
      setSelectedId(result.data.id);
      setName('');
      await refresh();
    } else showNotice({ kind: 'error', title: 'Collection was not created', detail: result.error?.message ?? 'Choose another name.' });
  };

  return <>
    <section className="managed-split collections-view">
    <aside className="managed-master">
      <div className="managed-create"><input name="collection-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New collection…" aria-label="New collection name" onKeyDown={(event) => { if (event.key === 'Enter') void create(); }} /><button type="button" className="primary icon-button" disabled={!name.trim()} aria-label="Create collection" onClick={() => void create()}><PackagePlus /></button></div>
      <div className="managed-list" role="listbox" aria-label="Skin collections">{filteredCollections.map((collection) => <button key={collection.id} type="button" role="option" aria-selected={selected?.id === collection.id} className={selected?.id === collection.id ? 'selected' : ''} onClick={() => setSelectedId(collection.id)}><Layers3 /><span><strong>{collection.name}</strong><small>{collection.skinIds.length} skins · {collection.active ? 'Active' : 'Stored'}</small></span>{collection.active ? <CheckCircle2 className="managed-success" /> : null}</button>)}</div>
      {!filteredCollections.length ? <ManagedEmpty title="No skin collections" detail="Create a collection to control which managed skins are physically present in UserSkins." /> : null}
    </aside>
    <div className="managed-detail">
      {selected ? <><header><div><h2>{selected.name}</h2><p>{selected.active ? 'This collection currently controls UserSkins.' : 'Stored in Tailmark until activated.'}</p></div><div className="toolbar-actions"><button type="button" disabled={selected.active} onClick={() => void report(window.tailmark.library.activateCollection(selected.id), `${selected.name} activated`)}><Play />Activate</button><button type="button" className="primary" disabled={members.join('|') === selected.skinIds.join('|')} onClick={() => void report(window.tailmark.library.setCollectionMembers(selected.id, members), 'Collection members saved')}><CheckCircle2 />Save members</button><button type="button" className="icon-button danger-icon" disabled={selected.active} aria-label={`Remove ${selected.name}`} onClick={() => setRemoveTarget(selected)}><Trash2 /></button></div></header><div className="member-list"><div className="managed-row-head"><span>Managed skin</span><span>State</span><span>Included</span></div>{managedSkins.map((skin) => <label className="managed-member" key={skin.id}><span><strong>{skin.name}</strong><small>{skin.active === false ? 'Tailmark library' : skin.path}</small></span><span className={`inline-status ${skin.active === false ? 'skipped' : 'ready'}`}><span className="status-dot" />{skin.active === false ? 'Stored' : 'Active'}</span><input name={`collection-skin-${skin.id}`} type="checkbox" checked={members.includes(skin.id)} onChange={(event) => setMembers((current) => event.target.checked ? [...current, skin.id] : current.filter((id) => id !== skin.id))} /></label>)}</div></> : <ManagedEmpty title="Choose a collection" detail="Select a collection to edit its managed skin membership." />}
    </div>
    </section>
    <ConfirmDialog
      open={Boolean(removeTarget)}
      title={`Remove ${removeTarget?.name ?? 'collection'}?`}
      detail="This removes the collection definition. Its managed skins remain available in the Tailmark library."
      confirmLabel="Remove collection"
      destructive
      onCancel={() => setRemoveTarget(null)}
      onConfirm={() => {
        const target = removeTarget;
        setRemoveTarget(null);
        if (target) void report(window.tailmark.library.removeCollection(target.id), 'Collection removed');
      }}
    />
  </>;
}

export function SightsView({ search }: { search: string }): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const items = snapshot.sights.filter((item) => `${item.name} ${item.vehicleId ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <ManagedPackageView
    kind="sight"
    items={items}
    emptyTitle="No custom sights imported"
    emptyDetail="Import sight ZIPs to validate and store them before activating a vehicle or all_tanks package."
  />;
}

export function HangarsView({ search }: { search: string }): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const items = snapshot.hangars.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <ManagedPackageView
    kind="hangar"
    items={items}
    emptyTitle="No custom hangars imported"
    emptyDetail="Import a hangar ZIP containing both a .blk configuration and .bin location."
  />;
}

function ManagedPackageView(props: {
  kind: 'sight' | 'hangar';
  items: Array<ManagedSight | ManagedHangar>;
  emptyTitle: string;
  emptyDetail: string;
}): React.JSX.Element {
  const refresh = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const snapshot = useAppStore((state) => state.snapshot)!;
  const [working, setWorking] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManagedSight | ManagedHangar | null>(null);
  const activeCount = useMemo(() => props.items.filter((item) => item.active).length, [props.items]);
  const run = async (
    promise: Promise<{ ok: boolean; error?: { message: string; details?: string } }>,
    title: string,
  ) => {
    setWorking(true);
    const result = await promise;
    setWorking(false);
    if (result.ok) {
      showNotice({ kind: 'success', title, detail: 'The managed library and activity history were updated.' });
      await refresh();
    } else showNotice({ kind: 'error', title: 'Managed content operation failed', detail: result.error?.message ?? 'No changes were made.', technical: result.error?.details });
  };
  const importPackages = async () => {
    const chosen = await window.tailmark.dialogs.chooseArchives();
    if (!chosen.ok || !chosen.data?.length) return;
    await run(props.kind === 'sight' ? window.tailmark.library.importSights(chosen.data) : window.tailmark.library.importHangars(chosen.data), `${props.kind === 'sight' ? 'Sights' : 'Hangars'} imported`);
  };
  return <section className="managed-packages">
    <header><div><strong>{props.items.length} managed</strong><span>{activeCount} active · stored packages remain outside game folders</span></div><button type="button" className="primary" onClick={() => void importPackages()}><PackagePlus />Import {props.kind === 'sight' ? 'sight' : 'hangar'} ZIP</button></header>
    {props.items.length ? <div className="managed-table"><div className="managed-row-head"><span>Package</span><span>Scope / config</span><span>Imported</span><span>Status</span><span>Actions</span></div>{props.items.map((item) => {
      const sight = props.kind === 'sight' ? item as ManagedSight : null;
      const hangar = props.kind === 'hangar' ? item as ManagedHangar : null;
      return <div className="managed-package-row" key={item.id}><span><strong>{item.name}</strong><small>{formatBytes(item.totalSize)} · {item.fileCount.toLocaleString()} files</small></span><code>{sight ? sight.scope === 'all-tanks' ? 'all_tanks' : sight.vehicleId ?? 'Vehicle needed' : hangar?.configFile}</code><span>{formatDate(item.importedAt)}</span><span className={`inline-status ${item.active ? 'ready' : 'skipped'}`}><span className="status-dot" />{item.active ? 'Active' : 'Stored'}</span><div className="row-toolbar">{item.active ? <button type="button" disabled={working || (props.kind === 'hangar' && snapshot.gameRunning)} onClick={() => void run(props.kind === 'sight' ? window.tailmark.library.deactivateSight(item.id) : window.tailmark.library.deactivateHangar(), `${item.name} deactivated`)}><Power />Deactivate</button> : <button type="button" className="primary" disabled={working || (props.kind === 'hangar' && snapshot.gameRunning)} onClick={() => void run(props.kind === 'sight' ? window.tailmark.library.activateSight(item.id) : window.tailmark.library.activateHangar(item.id), `${item.name} activated`)}><Play />Activate</button>}<button type="button" className="icon-button" aria-label={`Open ${item.name} storage`} onClick={() => void window.tailmark.files.openPath(item.libraryPath)}><FolderOpen /></button><button type="button" className="icon-button danger-icon" aria-label={`Remove ${item.name}`} disabled={item.active || working} onClick={() => setRemoveTarget(item)}><Trash2 /></button></div></div>;
    })}</div> : <ManagedEmpty title={props.emptyTitle} detail={props.emptyDetail} />}
    <ConfirmDialog
      open={Boolean(removeTarget)}
      title={`Remove ${removeTarget?.name ?? props.kind}?`}
      detail={`This deletes the stored ${props.kind} package from Tailmark's managed library. It cannot be recovered unless you still have the source ZIP.`}
      confirmLabel={`Remove ${props.kind}`}
      destructive
      onCancel={() => setRemoveTarget(null)}
      onConfirm={() => {
        const target = removeTarget;
        setRemoveTarget(null);
        if (target) void run(
          props.kind === 'sight'
            ? window.tailmark.library.removeSight(target.id)
            : window.tailmark.library.removeHangar(target.id),
          `${target.name} removed`,
        );
      }}
    />
  </section>;
}

function ManagedEmpty({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return <div className="library-empty"><Eye /><strong>{title}</strong><span>{detail}</span></div>;
}
