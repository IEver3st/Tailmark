import { AlertTriangle, CheckCircle2, CircleX, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function NoticeBar(): React.JSX.Element | null {
  const notice = useAppStore((state) => state.notice);
  const dismiss = useAppStore((state) => state.dismissNotice);
  const [details, setDetails] = useState(false);
  if (!notice) return null;
  const Icon = notice.kind === 'success' ? CheckCircle2 : notice.kind === 'warning' ? AlertTriangle : CircleX;
  return <section className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
    <Icon aria-hidden="true" /><div><strong>{notice.title}</strong><span>{notice.detail}</span>{notice.technical && details ? <pre>{notice.technical}</pre> : null}{notice.technical ? <button type="button" className="link-button" onClick={() => setDetails((value) => !value)}>{details ? 'Hide' : 'Show'} technical details</button> : null}</div>
    <button type="button" className="icon-button" aria-label="Dismiss message" onClick={dismiss}><X /></button>
  </section>;
}
