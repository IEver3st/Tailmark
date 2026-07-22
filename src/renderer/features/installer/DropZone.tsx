import { FolderSearch2, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../stores/app-store';

export function DropZone(): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const addPaths = useAppStore((state) => state.addPaths);
  const chooseArchives = useAppStore((state) => state.chooseArchives);
  const chooseFolder = useAppStore((state) => state.chooseFolder);
  return <section
    className={`drop-zone ${dragging ? 'dragging' : ''}`}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); const paths = window.tailmark.files.pathsForDroppedFiles([...event.dataTransfer.files]); void addPaths(paths); }}
  >
    <div className="drop-icon"><Upload aria-hidden="true" /></div>
    <h1>Bring in your mod archives</h1>
    <p>Drop any number of ZIP files here. Tailmark inspects their contents first and shows exactly where each package will go.</p>
    <div className="drop-actions"><button type="button" className="primary" onClick={() => void chooseArchives()}><Plus />Select ZIP files</button><button type="button" onClick={() => void chooseFolder()}><FolderSearch2 />Scan a folder</button></div>
    <span className="drop-note">Folders are scanned recursively. Nothing is extracted into War Thunder until review.</span>
  </section>;
}
