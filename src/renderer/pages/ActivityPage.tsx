import { CheckCircle2, ChevronDown, ChevronUp, Clipboard, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDate } from '../lib/format';
import { useAppStore } from '../stores/app-store';

export function ActivityPage(): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot);
  const activity = snapshot?.activity ?? EMPTY_ACTIVITY;
  const showNotice = useAppStore((state) => state.showNotice);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => activity.filter((item) => `${item.action} ${item.packageName} ${item.destination} ${item.details}`.toLowerCase().includes(search.toLowerCase())), [activity, search]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(activity, null, 2)); showNotice({ kind: 'success', title: 'Activity copied', detail: 'The full technical history is on the clipboard.' }); }
    catch { showNotice({ kind: 'error', title: 'Could not copy activity', detail: 'Use Export log to save the history instead.' }); }
  };
  const exportLog = async () => {
    const result = await window.tailmark.dialogs.exportActivity(`Tailmark-activity-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(activity, null, 2));
    if (result.ok && result.data) showNotice({ kind: 'success', title: 'Activity exported', detail: result.data });
    else if (!result.ok) showNotice({ kind: 'error', title: 'Export failed', detail: result.error?.message ?? 'Choose another destination.' });
  };
  return <main className="page activity-page"><div className="page-toolbar"><div><h1>Activity</h1><span>A persistent, exportable record of filesystem and configuration operations.</span></div><div className="toolbar-actions"><button type="button" onClick={() => void copy()}><Clipboard />Copy log</button><button type="button" className="primary" onClick={() => void exportLog()}><Download />Export log</button></div></div><div className="activity-toolbar"><label className="search-field"><Search /><span className="sr-only">Search activity</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actions, packages, and destinations" /></label><span>{filtered.length} records</span></div><section className="activity-list" aria-label="Operation history"><div className="activity-head"><span>Date and time</span><span>Action</span><span>Package</span><span>Result</span><span>Files</span><span>Destination</span><span /></div>{filtered.length ? filtered.map((record) => <div className={`activity-wrap ${expanded === record.id ? 'expanded' : ''}`} key={record.id}><button type="button" className="activity-row" onClick={() => setExpanded(expanded === record.id ? null : record.id)} aria-expanded={expanded === record.id}><span>{formatDate(record.createdAt)}</span><span>{record.action.replaceAll('-', ' ')}</span><strong>{record.packageName}</strong><span className={`inline-status ${record.result === 'success' ? 'ready' : record.result === 'warning' ? 'conflict' : 'failed'}`}><span className="status-dot" />{record.result}</span><span>{record.fileCount.toLocaleString()}</span><span className="path-cell">{record.destination}</span>{expanded === record.id ? <ChevronUp /> : <ChevronDown />}</button>{expanded === record.id ? <div className="activity-details"><div><span>Technical details</span><p>{record.details}</p></div><div><span>Backup reference</span><code>{record.backupId ?? 'No backup was required'}</code></div></div> : null}</div>) : <div className="activity-empty"><CheckCircle2 /><strong>No operations recorded yet</strong><span>Completed imports, installations, activations, removals, and restores will appear here.</span></div>}</section></main>;
}

const EMPTY_ACTIVITY: never[] = [];
