import { useEffect, useRef } from 'react';

interface Props { open: boolean; title: string; detail: string; confirmLabel: string; destructive?: boolean; onCancel(): void; onConfirm(): void }

export function ConfirmDialog(props: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = 'confirm-dialog-title';
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (props.open && !dialog.open) dialog.showModal(); if (!props.open && dialog.open) dialog.close(); }, [props.open]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); props.onCancel(); }} className="confirm-dialog">
    <h2 id={titleId}>{props.title}</h2><p>{props.detail}</p>
    <div className="dialog-actions"><button type="button" onClick={props.onCancel}>Cancel</button><button type="button" className={props.destructive ? 'danger-button' : 'primary'} onClick={props.onConfirm}>{props.confirmLabel}</button></div>
  </dialog>;
}
