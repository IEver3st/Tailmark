import { ChevronRight, RefreshCw, Trash2, X } from 'lucide-react';
import type { ArchiveAnalysis } from '@shared/models';
import { formatBytes } from '../../lib/format';
import { useAppStore } from '../../stores/app-store';
import { Status } from '../../components/Status';

function TypeLabel({ item }: { item: ArchiveAnalysis }): React.JSX.Element {
  const type = item.manualType ?? item.detected.type;
  return <div className="type-cell"><span>{type === 'skin' ? 'User skin' : type === 'sound' ? 'Sound mod' : type === 'ambiguous' ? 'Mixed signals' : 'Unknown'}</span>{item.detected.confidence > 0 ? <small>{item.detected.confidence}% confidence</small> : null}</div>;
}

function IssuesCell({ item }: { item: ArchiveAnalysis }): React.JSX.Element {
  if (item.failure) {
    return <>
      <strong title={item.failure.message}>{item.failure.message}</strong>
      <span>{item.failure.stage === 'analysis' ? 'Analysis failed' : 'Installation failed'}</span>
    </>;
  }
  const issueCount = item.warnings.length + item.conflicts.length;
  if (!issueCount) return <span className="muted">None</span>;
  const primaryWarning = item.warnings.find((warning) => warning.level === 'error') ?? item.warnings[0];
  return <>
    <strong title={primaryWarning?.title}>{primaryWarning?.title ?? `${issueCount} issues`}</strong>
    <span>{item.warnings.some((warning) => warning.level === 'error') ? 'Action required' : `${issueCount} to review`}</span>
  </>;
}

export function QueueTable({ items }: { items: ArchiveAnalysis[] }): React.JSX.Element {
  const selectedId = useAppStore((state) => state.selectedId);
  const select = useAppStore((state) => state.select);
  const remove = useAppStore((state) => state.removeItem);
  const retry = useAppStore((state) => state.retry);
  return <table className="queue-table" aria-label="Archive install queue">
    <thead><tr className="queue-head"><th>Archive</th><th>Type</th><th>Contents</th><th>Destination</th><th>Status</th><th>Issues</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody className="queue-body">
      {items.map((item) => <tr key={item.id} className={`queue-row ${selectedId === item.id ? 'selected' : ''}`} tabIndex={0} onClick={() => select(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(item.id); } }}>
        <td className="archive-cell"><strong title={item.originalFilename}>{item.displayName}</strong><span>{item.originalFilename}</span></td>
        <td><TypeLabel item={item} /></td>
        <td><strong>{item.fileCount.toLocaleString()} files</strong><span>{formatBytes(item.uncompressedSize)}</span></td>
        <td className="destination-cell" title={item.proposedDestination}>{item.proposedDestination}</td>
        <td><Status status={item.status} /></td>
        <td className={`issues-cell ${item.failure ? 'failure' : item.warnings.some((warning) => warning.level === 'error') ? 'critical' : item.warnings.length + item.conflicts.length ? 'warning' : ''}`}><IssuesCell item={item} /></td>
        <td className="row-actions">
          {item.status === 'failed' ? <button type="button" className="icon-button" aria-label={`Retry ${item.displayName}`} title="Retry analysis" onClick={(event) => { event.stopPropagation(); void retry(item.id); }}><RefreshCw /></button> : null}
          <button type="button" className="icon-button" aria-label={`Remove ${item.displayName}`} title="Remove from queue" onClick={(event) => { event.stopPropagation(); remove(item.id); }}><Trash2 /></button>
          <ChevronRight className="row-chevron" aria-hidden="true" />
        </td>
      </tr>)}
    </tbody>
  </table>;
}
