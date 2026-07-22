import type { QueueStatus } from '@shared/models';

const labels: Record<QueueStatus, string> = {
  analysing: 'Analysing', ready: 'Ready', 'needs-review': 'Needs Review', duplicate: 'Duplicate', conflict: 'Conflict',
  installing: 'Installing', installed: 'Installed', skipped: 'Skipped', failed: 'Failed',
};

export function Status({ status }: { status: QueueStatus }): React.JSX.Element {
  return <span className={`inline-status ${status}`}><span className="status-dot" />{labels[status]}</span>;
}
