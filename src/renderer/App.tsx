import { useEffect } from 'react';
import { NoticeBar } from './components/NoticeBar';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { ActivityPage } from './pages/ActivityPage';
import { InstallerPage } from './pages/InstallerPage';
import { LibraryPage } from './pages/LibraryPage';
import { SettingsPage } from './pages/SettingsPage';
import { applyTheme } from './lib/theme';
import { useAppStore } from './stores/app-store';

export function App(): React.JSX.Element {
  const page = useAppStore((state) => state.page);
  const snapshot = useAppStore((state) => state.snapshot);
  const initialize = useAppStore((state) => state.initialize);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (snapshot?.settings.theme) applyTheme(snapshot.settings.theme);
  }, [snapshot?.settings.theme]);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a><TitleBar /><div className="app-body"><Sidebar /><div className="workspace" id="main-content"><NoticeBar />{page === 'installer' ? <InstallerPage /> : page === 'library' ? <LibraryPage /> : page === 'activity' ? <ActivityPage /> : <SettingsPage />}</div></div></div>;
}
