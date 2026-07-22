import { Activity, Library, PackageOpen, Settings } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

const items = [
  { id: 'installer' as const, label: 'Installer', icon: PackageOpen },
  { id: 'library' as const, label: 'Library', icon: Library },
  { id: 'activity' as const, label: 'Activity', icon: Activity },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function Sidebar(): React.JSX.Element {
  const page = useAppStore((state) => state.page);
  const setPage = useAppStore((state) => state.setPage);
  return <aside className="sidebar">
    <nav aria-label="Main navigation">
      {items.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}
    </nav>
  </aside>;
}
