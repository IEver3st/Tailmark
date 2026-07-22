import { AlertTriangle, CheckCircle2, FolderCog, FolderOpen, Palette, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { CollisionPolicy } from '@shared/models';
import type { AppTheme } from '@shared/themes';
import { THEME_OPTIONS } from '@shared/themes';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { applyTheme } from '../lib/theme';
import { formatBytes } from '../lib/format';
import { useAppStore } from '../stores/app-store';

export function SettingsPage(): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot);
  const update = useAppStore((state) => state.updateSettings);
  const refresh = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const [resetOpen, setResetOpen] = useState(false);
  if (!snapshot) return <main className="page"><div className="skeleton-page" /></main>;
  const settings = snapshot.settings;
  const chooseRoot = async () => {
    const result = await window.tailmark.dialogs.chooseGameRoot();
    if (result.ok && result.data) { showNotice({ kind: 'success', title: 'War Thunder installation selected', detail: `${result.data.root} was validated using ${result.data.evidence.join(', ')}.` }); await refresh(); }
    else if (!result.ok) showNotice({ kind: 'error', title: 'Folder was not accepted', detail: result.error?.message ?? 'Choose the folder containing config.blk and aces.exe.', technical: result.error?.details });
  };
  const detect = async () => {
    const result = await window.tailmark.game.detect();
    if (result.ok && result.data) { showNotice({ kind: 'success', title: 'War Thunder found', detail: `${result.data.root} was detected with ${result.data.confidence}% confidence.` }); await refresh(); }
    else showNotice({ kind: 'warning', title: 'Automatic detection was inconclusive', detail: 'Choose Select folder and point Tailmark at the War Thunder installation directory.' });
  };
  const checkRunning = async () => {
    const result = await window.tailmark.game.running();
    if (result.ok) { showNotice({ kind: result.data ? 'warning' : 'success', title: result.data ? 'War Thunder is running' : 'War Thunder is not running', detail: result.data ? 'User skins can still be installed. Close the game and launcher before activating or deactivating sound mods.' : 'User skin installation and sound-mod activation are available.' }); await refresh(); }
  };
  const reset = async () => { const result = await window.tailmark.settings.reset(); setResetOpen(false); if (result.ok) { showNotice({ kind: 'success', title: 'Settings reset', detail: 'Library metadata and backups were preserved.' }); await refresh(); } };
  const clearTemp = async () => { const result = await window.tailmark.app.clearTemporaryFiles(); if (result.ok) showNotice({ kind: 'success', title: 'Temporary files cleared', detail: `${formatBytes(result.data ?? 0)} removed. Library packages and backups were preserved.` }); else showNotice({ kind: 'error', title: 'Temporary files could not be cleared', detail: result.error?.message ?? 'Close active operations and try again.' }); };
  const chooseTheme = (theme: AppTheme) => {
    applyTheme(theme);
    void update({ theme });
  };
  return <main className="page settings-page"><div className="page-toolbar"><div><h1>Settings</h1><span>Appearance, game location, collision safety, backups, and advanced sound behaviour.</span></div></div><div className="settings-workspace">
    <nav className="settings-nav" aria-label="Settings sections"><a href="#appearance">Appearance</a><a href="#game">War Thunder</a><a href="#imports">Imports</a><a href="#backups">Backups</a><a href="#sound">Sound Mods</a><a href="#storage">Storage</a></nav>
    <div className="settings-content">
      <section id="appearance"><header><Palette /><div><h2>Appearance</h2><p>Choose a color theme for the Tailmark interface.</p></div></header><div className="theme-grid" role="listbox" aria-label="Color theme">{THEME_OPTIONS.map((option) => <button key={option.id} type="button" role="option" aria-selected={settings.theme === option.id} className={`theme-option ${settings.theme === option.id ? 'active' : ''}`} onClick={() => chooseTheme(option.id)}><div className="theme-swatch" aria-hidden="true">{option.swatches.map((color) => <span key={color} style={{ background: color }} />)}</div><strong>{option.label}</strong><small>{option.description}</small></button>)}</div></section>
      <section id="game"><header><FolderCog /><div><h2>War Thunder installation</h2><p>Tailmark validates this location again before every write.</p></div></header><div className={`path-status ${snapshot.installation?.valid ? 'valid' : 'invalid'}`}>{snapshot.installation?.valid ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{snapshot.installation?.valid ? 'Verified installation' : 'No verified installation'}</strong><code>{settings.gameRoot ?? 'Select the directory containing config.blk and aces.exe'}</code>{snapshot.installation ? <span>Evidence: {snapshot.installation.evidence.join(', ') || 'none'} · {snapshot.installation.confidence}% confidence</span> : null}</div></div><div className="setting-actions"><button type="button" className="primary" onClick={() => void chooseRoot()}><FolderOpen />Select folder</button><button type="button" onClick={() => void detect()}><RefreshCw />Detect automatically</button><button type="button" onClick={() => void checkRunning()}><RefreshCw />Check game process</button></div><SettingToggle label="Automatically detect installation" detail="Check saved, Steam library, and common Gaijin locations when no valid path is available." checked={settings.autoDetectInstallation} onChange={(value) => void update({ autoDetectInstallation: value })} /></section>
      <section id="imports"><header><FolderCog /><div><h2>Import behaviour</h2><p>Control content duplicates, destination collisions, and source ZIP cleanup.</p></div></header><SettingToggle label="Ignore duplicate content" detail="Skip skin folders and sound packages whose files are already installed, even when their names differ." checked={settings.ignoreDuplicateContent} onChange={(value) => void update({ ignoreDuplicateContent: value })} /><label className="setting-select"><span><strong>Existing folder behaviour</strong><small>Used for name collisions. Replacement and merge create a backup first.</small></span><select value={settings.defaultDuplicateBehaviour} onChange={(event) => void update({ defaultDuplicateBehaviour: event.target.value as CollisionPolicy })}><option value="skip">Skip existing folder</option><option value="replace">Replace after backup</option><option value="merge">Merge after backup</option><option value="copy">Install as readable copy</option></select></label><SettingToggle label="Move source ZIP to Recycle Bin" detail="After a skin installs successfully, remove its source ZIP. Failed and skipped archives are kept." checked={settings.deleteSourceZipAfterInstall} onChange={(value) => void update({ deleteSourceZipAfterInstall: value })} /><SettingToggle label="Confirm before replacement" detail="Require an explicit review before batch replacement operations." checked={settings.confirmBeforeReplacement} onChange={(value) => void update({ confirmBeforeReplacement: value })} /></section>
      <section id="backups"><header><RotateCcw /><div><h2>Backup retention</h2><p>Older application-managed backups are pruned after successful operations.</p></div></header><label className="setting-select"><span><strong>Backups to retain</strong><small>Applies after the next operation.</small></span><input name="backup-retention" type="number" min="1" max="100" value={settings.retainBackupCount} onChange={(event) => { const parsed = event.currentTarget.valueAsNumber; if (Number.isFinite(parsed)) void update({ retainBackupCount: Math.max(1, Math.min(100, parsed)) }); }} /></label></section>
      <section id="sound"><header><AlertTriangle /><div><h2>Advanced sound-mod merging</h2><p>One package at a time is safest. Combined profiles may contain incompatible FMOD banks.</p></div></header><SettingToggle label="Enable Create Combined Profile" detail="Shows filename conflicts and uses explicit package priority. It never silently merges ordinary activations." checked={settings.advancedSoundMerging} onChange={(value) => void update({ advancedSoundMerging: value })} warning /></section>
      <section id="storage"><header><FolderOpen /><div><h2>Application storage</h2><p>Managed sound packages, backup records, settings, and operation history.</p></div></header><div className="setting-actions"><button type="button" onClick={() => void window.tailmark.app.openAppData()}><FolderOpen />Open application data</button><button type="button" onClick={() => void clearTemp()}><Trash2 />Clear temporary files</button><button type="button" className="danger-button" onClick={() => setResetOpen(true)}><RotateCcw />Reset settings</button></div></section>
    </div>
  </div><ConfirmDialog open={resetOpen} title="Reset all settings?" detail="Game location and preferences will return to defaults. Installed packages, library metadata, backups, and activity history will not be deleted." confirmLabel="Reset settings" destructive onCancel={() => setResetOpen(false)} onConfirm={() => void reset()} /></main>;
}

function SettingToggle({ label, detail, checked, onChange, warning = false }: { label: string; detail: string; checked: boolean; onChange(value: boolean): void; warning?: boolean }): React.JSX.Element {
  return <label className={`setting-toggle ${warning ? 'warning' : ''}`}><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}
