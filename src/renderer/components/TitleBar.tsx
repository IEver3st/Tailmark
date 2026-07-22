import brandingUrl from '../assets/branding.png';

function MinimizeIcon(): React.JSX.Element { return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>; }
function MaximizeIcon(): React.JSX.Element { return <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>; }
function CloseIcon(): React.JSX.Element { return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>; }

export function TitleBar(): React.JSX.Element {
  return <header className="titlebar">
    <div className="titlebar-brand"><img className="brand-logo" src={brandingUrl} alt="Tailmark" /></div>
    <div className="titlebar-drag" />
    <div className="window-controls">
      <button type="button" aria-label="Minimize window" onClick={() => void window.tailmark.window.control('minimize')}><MinimizeIcon /></button>
      <button type="button" aria-label="Maximize or restore window" onClick={() => void window.tailmark.window.control('maximize')}><MaximizeIcon /></button>
      <button type="button" className="close" aria-label="Close window" onClick={() => void window.tailmark.window.control('close')}><CloseIcon /></button>
    </div>
  </header>;
}
