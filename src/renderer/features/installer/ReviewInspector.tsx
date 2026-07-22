import { AlertTriangle, CheckCircle2, CircleX, File, Folder, Info, ShieldAlert, X } from 'lucide-react';
import type { ArchiveAnalysis, ModType } from '@shared/models';
import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../stores/app-store';

function ArchiveTree({ item }: { item: ArchiveAnalysis }): React.JSX.Element {
  const visible = item.entries.filter((entry) => !entry.ignored).slice(0, 120);
  return <div className="archive-tree" role="tree" aria-label="Archive contents">
    {visible.map((entry) => <div key={entry.path} role="treeitem" aria-level={entry.normalizedPath.split('/').length} className={entry.unsafeReason ? 'unsafe' : ''} style={{ paddingLeft: `${Math.min(7, entry.normalizedPath.split('/').length - 1) * 14 + 8}px` }}>
      {entry.isDirectory ? <Folder aria-hidden="true" /> : <File aria-hidden="true" />}<span>{entry.normalizedPath.split('/').at(-1)}</span>{entry.executable ? <ShieldAlert aria-label="Executable file" /> : null}
    </div>)}
    {item.entries.length > visible.length ? <span className="tree-more">{item.entries.length - visible.length} more entries</span> : null}
  </div>;
}

export function ReviewInspector({ item }: { item: ArchiveAnalysis }): React.JSX.Element {
  const select = useAppStore((state) => state.select);
  const overrideType = useAppStore((state) => state.overrideType);
  const chooseRoot = useAppStore((state) => state.chooseRoot);
  const ignoreDuplicateContent = useAppStore((state) => state.snapshot?.settings.ignoreDuplicateContent ?? true);
  const type = item.manualType ?? item.detected.type;
  return <aside className="review-inspector" aria-label={`Review ${item.displayName}`}>
    <header><div><span>Installation review</span><h2>{item.displayName}</h2></div><button type="button" className="icon-button" aria-label="Close inspector" onClick={() => select(null)}><X /></button></header>
    <div className="inspector-scroll">
      <section className="inspector-summary"><div><span>Detected as</span><strong>{type === 'skin' ? 'User skin' : type === 'sound' ? 'Sound mod' : 'Needs review'}</strong></div><div><span>Contents</span><strong>{item.fileCount} files · {formatBytes(item.uncompressedSize)}</strong></div></section>
      {item.failure ? <section className="failure-section" aria-live="polite"><h3>{item.failure.stage === 'analysis' ? 'Analysis failed' : 'Installation failed'}</h3><div className="operation-failure"><CircleX /><div><strong>Why it failed</strong><p>{item.failure.message}</p>{item.failure.technicalDetails ? <details><summary>Show technical details</summary><pre>{item.failure.technicalDetails}</pre></details> : null}</div></div></section> : null}
      <section><h3>Detection</h3>{item.detected.reasons.length ? <ul className="reason-list">{item.detected.reasons.map((reason) => <li key={`${reason.kind}-${reason.label}-${reason.weight}`}><CheckCircle2 /><span>{reason.label}</span></li>)}</ul> : <p className="section-copy">No credible skin or sound signatures were found.</p>}</section>
      {item.warnings.length ? <section><h3>Warnings</h3><div className="warning-list">{item.warnings.map((warning) => <div key={warning.code} className={warning.level}><AlertTriangle /><div><strong>{warning.title}</strong><span>{warning.detail}</span></div></div>)}</div></section> : null}
      <section><h3>Folder plan</h3>{item.transformations.length ? item.transformations.map((transformation) => <div className="transformation" key={`${transformation.kind}-${transformation.from}-${transformation.to}`}><code>{transformation.from}</code><span>→</span><code>{transformation.to}</code><small>{transformation.reason}</small></div>) : <p className="section-copy">Choose a type and an installation root before this archive can proceed.</p>}<div className="destination-preview"><span>Destination</span><code>{item.proposedDestination}</code></div></section>
      {item.conflicts.length ? <section><h3>Conflicts</h3>{item.conflicts.map((conflict) => <div className="conflict-row" key={`${conflict.kind}-${conflict.relativePath}`}><AlertTriangle /><div><strong>{conflict.relativePath}</strong><span>{conflict.kind === 'duplicate-content' ? ignoreDuplicateContent ? 'These files match an installed skin and will not be installed.' : 'These files match an installed skin. Confirm the duplicate warning before continuing.' : conflict.kind === 'file-collision' ? 'One or more files already exist at this destination. The Settings collision policy will apply.' : 'A folder already exists at this destination. The Settings collision policy will apply.'}</span></div></div>)}</section> : null}
      <section><h3>Archive structure</h3><ArchiveTree item={item} /></section>
      <section className="override-section"><h3>Manual review</h3><label>Install this archive as<select value={type === 'ambiguous' ? '' : type} onChange={(event) => overrideType(item.id, event.target.value as ModType)}><option value="">Choose a type</option><option value="skin">User skin</option><option value="sound">Sound mod</option><option value="unsupported">Ignore this archive</option></select></label><label>Meaningful archive root<input type="text" value={item.manualRoot ?? ''} placeholder="For example: Download/F16_Skin" onChange={(event) => chooseRoot(item.id, event.target.value.replace(/^\/+|\/+$/g, ''))} /></label><p><Info />Only use a manual root when the tree clearly shows the mod files beneath that folder.</p></section>
    </div>
  </aside>;
}
