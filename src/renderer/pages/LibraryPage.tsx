import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Link2,
  Layers3,
  PackagePlus,
  Pencil,
  Play,
  Power,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { BackupRecord, SkinPackage, SoundPackage } from "@shared/models";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatBytes, formatDate } from "../lib/format";
import { useAppStore } from "../stores/app-store";

type Tab = "skins" | "sounds" | "backups";
interface ConfirmState {
  title: string;
  detail: string;
  label: string;
  action: () => Promise<void>;
}

export function LibraryPage(): React.JSX.Element {
  const snapshot = useAppStore((state) => state.snapshot);
  const refresh = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const addPaths = useAppStore((state) => state.addPaths);
  const setPage = useAppStore((state) => state.setPage);
  const [tab, setTab] = useState<Tab>("skins");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [profileName, setProfileName] = useState("");
  const [adoptName, setAdoptName] = useState("");
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null);
  const [profileRenameValue, setProfileRenameValue] = useState("");
  if (!snapshot)
    return (
      <main className="page">
        <div className="skeleton-page" />
      </main>
    );

  const handleResult = async (
    promise: Promise<{
      ok: boolean;
      error?: { message: string; details?: string };
    }>,
    success: string,
  ) => {
    const result = await promise;
    if (result.ok) {
      showNotice({
        kind: "success",
        title: success,
        detail: "The library and activity history have been updated.",
      });
      await refresh();
    } else
      showNotice({
        kind: "error",
        title: "Operation failed",
        detail: result.error?.message ?? "No changes were made.",
        technical: result.error?.details,
      });
  };
  const removeSkin = (skin: SkinPackage) =>
    setConfirm({
      title: `Remove ${skin.name}?`,
      detail:
        "Tailmark will create a restorable backup before removing this folder from UserSkins.",
      label: "Back up and remove",
      action: () =>
        handleResult(
          window.tailmark.library.removeSkin(skin.id),
          "User skin removed",
        ),
    });
  const removeSound = (sound: SoundPackage) =>
    setConfirm({
      title: `Remove ${sound.name}?`,
      detail:
        "The stored package will be backed up first. Combined profiles that reference it will also be removed.",
      label: "Back up and remove",
      action: () =>
        handleResult(
          window.tailmark.library.removeSound(sound.id),
          "Sound package removed",
        ),
    });
  const restoreBackup = (backup: BackupRecord) =>
    setConfirm({
      title: "Restore this backup?",
      detail: `The current destination at ${backup.sourcePath} will be replaced by the selected backup.`,
      label: "Restore backup",
      action: () =>
        handleResult(
          window.tailmark.library.restoreBackup(backup.id),
          "Backup restored",
        ),
    });
  const saveRename = async (skin: SkinPackage) => {
    const value = renameValue.trim();
    if (!value || value === skin.name) {
      setRenaming(null);
      return;
    }
    await handleResult(
      window.tailmark.library.renameSkin(skin.id, value),
      "User skin renamed",
    );
    setRenaming(null);
  };
  const reinstall = async (skin: SkinPackage) => {
    if (!skin.sourceArchive) {
      showNotice({
        kind: "warning",
        title: "Original archive unavailable",
        detail:
          "This skin was discovered in UserSkins and has no recorded source ZIP.",
      });
      return;
    }
    await addPaths([skin.sourceArchive]);
    setPage("installer");
  };
  const filteredSkins = snapshot.skins.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredSounds = snapshot.sounds.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredBackups = snapshot.backups.filter((item) =>
    `${item.reason} ${item.sourcePath}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const skinStats = {
    count: snapshot.skins.length,
    totalSize: snapshot.skins.reduce((sum, skin) => sum + skin.totalSize, 0),
    totalFiles: snapshot.skins.reduce((sum, skin) => sum + skin.fileCount, 0),
    issues: snapshot.skins.filter((skin) => skin.validationStatus !== "valid").length,
  };
  const soundStats = {
    count: snapshot.sounds.length,
    totalSize: snapshot.sounds.reduce((sum, sound) => sum + sound.totalSize, 0),
    active: snapshot.sounds.filter((sound) => sound.active).length
      || (snapshot.externalSound?.enabled ? 1 : 0),
    external: Boolean(snapshot.externalSound),
  };
  const backupStats = {
    count: snapshot.backups.length,
    totalSize: snapshot.backups.reduce((sum, backup) => sum + backup.size, 0),
  };
  const selectedPackageIds = new Set(selectedPackages);
  const createProfile = async () => {
    if (selectedPackages.length < 1 || !profileName.trim()) return;
    if (!snapshot.settings.advancedSoundMerging && selectedPackages.length !== 1) return;
    const result = await window.tailmark.library.createProfile(
      profileName.trim(),
      selectedPackages,
    );
    if (result.ok && result.data) {
      showNotice({
        kind: "success",
        title: selectedPackages.length > 1 ? "Combined profile created" : "Sound profile created",
        detail: selectedPackages.length > 1
          ? `${result.data.conflicts.length} filename conflicts were resolved by package priority. The last selected package wins.`
          : `${result.data.name} is ready to activate from the profiles list.`,
      });
      setSelectedPackages([]);
      setProfileName("");
      await refresh();
    } else
      showNotice({
        kind: "error",
        title: "Profile was not created",
        detail: result.error?.message ?? "Review the selected packages.",
      });
  };
  const adoptExternal = async () => {
    if (!adoptName.trim()) return;
    const result = await window.tailmark.library.adoptSound(adoptName.trim());
    if (result.ok && result.data) {
      showNotice({
        kind: "success",
        title: "Sound profile created",
        detail: `${result.data.name} was saved from the installed sound/mod folder.`,
      });
      setAdoptName("");
      await refresh();
    } else {
      showNotice({
        kind: "error",
        title: "Could not save installed sound mod",
        detail: result.error?.message ?? "Check the War Thunder sound/mod folder and try again.",
      });
    }
  };
  const reconnectExternal = async () => {
    const result = await window.tailmark.library.reconnectSound();
    if (result.ok && result.data) {
      showNotice({
        kind: "success",
        title: "Sound profile reconnected",
        detail: `${result.data.name} now owns the exact files already installed in sound/mod. No payload files were replaced.`,
      });
      await refresh();
    } else {
      showNotice({
        kind: "error",
        title: "Profile could not be reconnected",
        detail: result.error?.message ?? "Refresh detection and try again.",
        technical: result.error?.details,
      });
    }
  };
  const saveProfileRename = async (id: string) => {
    const value = profileRenameValue.trim();
    if (!value) return;
    await handleResult(window.tailmark.library.renameProfile(id, value), "Sound profile renamed");
    setRenamingProfile(null);
  };
  const removeProfile = (id: string, name: string) => setConfirm({
    title: `Remove ${name}?`,
    detail: "This removes only the saved profile. Its sound packages remain in the library.",
    label: "Remove profile",
    action: () => handleResult(window.tailmark.library.removeProfile(id), "Sound profile removed"),
  });

  const externalProfile = snapshot.externalSound?.profileId
    ? snapshot.profiles.find((profile) => profile.id === snapshot.externalSound?.profileId)
    : undefined;
  const externalTitle = snapshot.externalSound
    ? snapshot.externalSound.ownership === "managed"
      ? `${externalProfile?.name ?? "Sound profile"} verified on disk`
      : snapshot.externalSound.ownership === "matched"
        ? `${externalProfile?.name ?? "Saved profile"} detected on disk`
        : snapshot.externalSound.ownership === "modified"
          ? "Installed sound mod changed outside Tailmark"
          : snapshot.externalSound.ownership === "stale"
            ? "Installed sound mod has a stale profile marker"
            : "Existing sound mod detected"
    : "";

  return (
    <main className="page library-page">
      <div className="page-toolbar">
        <div>
          <h1>Library</h1>
          <span>
            Installed skins, managed sound packages, and recoverable backups.
          </span>
        </div>
      </div>
      <section className="library-summary" aria-label="Library summary">
        {tab === "skins" ? (
          <>
            <div>
              <strong>{skinStats.count.toLocaleString()}</strong>
              <span>skins installed</span>
            </div>
            <div>
              <strong>{formatBytes(skinStats.totalSize)}</strong>
              <span>total size</span>
            </div>
            <div>
              <strong>{skinStats.totalFiles.toLocaleString()}</strong>
              <span>files</span>
            </div>
            {skinStats.issues ? (
              <div className="warning">
                <strong>{skinStats.issues}</strong>
                <span>need attention</span>
              </div>
            ) : null}
          </>
        ) : null}
        {tab === "sounds" ? (
          <>
            <div>
              <strong>{soundStats.count.toLocaleString()}</strong>
              <span>packages</span>
            </div>
            <div>
              <strong>{formatBytes(soundStats.totalSize)}</strong>
              <span>stored</span>
            </div>
            <div>
              <strong>{soundStats.active}</strong>
              <span>active</span>
            </div>
          </>
        ) : null}
        {tab === "backups" ? (
          <>
            <div>
              <strong>{backupStats.count.toLocaleString()}</strong>
              <span>backups</span>
            </div>
            <div>
              <strong>{formatBytes(backupStats.totalSize)}</strong>
              <span>recoverable</span>
            </div>
          </>
        ) : null}
        {search ? (
          <div className="library-summary-filter">
            <Search />
            <span>
              Showing{" "}
              {tab === "skins"
                ? filteredSkins.length
                : tab === "sounds"
                  ? filteredSounds.length
                  : filteredBackups.length}{" "}
              results
            </span>
          </div>
        ) : null}
      </section>
      <div className="library-controls">
        <div className="segment-control" role="tablist">
          {(["skins", "sounds", "backups"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {value === "skins"
                ? `User Skins · ${snapshot.skins.length}`
                : value === "sounds"
                  ? `Sound Mods · ${snapshot.sounds.length}`
                  : `Backups · ${snapshot.backups.length}`}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search />
          <span className="sr-only">Search library</span>
          <input
            name="library-search"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search library…"
          />
          {search ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X />
            </button>
          ) : null}
        </label>
      </div>
      <div className="library-workspace">
        {tab === "skins" ? (
          <section className="library-list skins" aria-label="Installed user skins">
            <div className="list-header skins">
              <span>Skin</span>
              <span>Size</span>
              <span>Installed</span>
              <span className="sr-only">Actions</span>
            </div>
            {filteredSkins.length ? (
              filteredSkins.map((skin) => (
                <div className="library-row skins" key={skin.id}>
                  <div className="package-name">
                    {renaming === skin.id ? (
                      <div className="inline-rename">
                        <input
                          autoFocus
                          aria-label={`New name for ${skin.name}`}
                          name="skin-name"
                          autoComplete="off"
                          value={renameValue}
                          onChange={(event) =>
                            setRenameValue(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveRename(skin);
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="Save name"
                          onClick={() => void saveRename(skin)}
                        >
                          <Check />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="Cancel rename"
                          onClick={() => setRenaming(null)}
                        >
                          <X />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="package-title">
                          <strong>{skin.name}</strong>
                          {skin.validationStatus !== "valid" ? (
                            <span
                              className="package-flag warning"
                              title="Some files may be missing or invalid"
                            >
                              <AlertTriangle />
                              Check files
                            </span>
                          ) : null}
                        </span>
                        <span className="package-path" title={skin.path}>
                          {skin.path}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="size-cell">
                    <strong>{formatBytes(skin.totalSize)}</strong>
                    <span>
                      {skin.fileCount.toLocaleString()}{" "}
                      {skin.fileCount === 1 ? "file" : "files"}
                    </span>
                  </div>
                  <span className="date-cell">{formatDate(skin.installedAt)}</span>
                  <div className="row-toolbar">
                    <button
                      type="button"
                      className="icon-button"
                      title="Open folder"
                      aria-label={`Open ${skin.name} folder`}
                      onClick={() =>
                        void window.tailmark.files.openPath(skin.path)
                      }
                    >
                      <FolderOpen />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Rename"
                      aria-label={`Rename ${skin.name}`}
                      onClick={() => {
                        setRenaming(skin.id);
                        setRenameValue(skin.name);
                      }}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Reinstall from source ZIP"
                      aria-label={`Reinstall ${skin.name}`}
                      onClick={() => void reinstall(skin)}
                    >
                      <RotateCcw />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger-icon"
                      title="Remove"
                      aria-label={`Remove ${skin.name}`}
                      onClick={() => removeSkin(skin)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyLibrary
                icon={<PackagePlus />}
                title="No user skins found"
                detail="Install skin archives from Installer, or create UserSkins folders in the game directory and refresh."
              />
            )}
          </section>
        ) : null}
        {tab === "sounds" ? (
          <section className="sound-layout">
            <div className="library-list" aria-label="Managed sound packages">
              {snapshot.externalSound ? (
                <div className={`external-sound-banner ${snapshot.externalSound.enabled ? "enabled" : "disabled"} ${snapshot.externalSound.ownership}`}>
                  <AlertTriangle />
                  <div className="external-sound-summary">
                    <strong>{externalTitle}</strong>
                    <span>
                      {snapshot.externalSound.fileCount.toLocaleString()} files ·{" "}
                      {snapshot.externalSound.soundFileCount.toLocaleString()} recognized sound files ·{" "}
                      {formatBytes(snapshot.externalSound.totalSize)} · enable_mod{" "}
                      {snapshot.externalSound.enabled ? "on" : "off"}
                    </span>
                    {snapshot.externalSound.warnings[0] ? (
                      <p>{snapshot.externalSound.warnings[0]}</p>
                    ) : null}
                  </div>
                  {snapshot.externalSound.ownership === "matched" ? (
                    <button
                      type="button"
                      className="primary compact"
                      onClick={() => void reconnectExternal()}
                    >
                      <Link2 />
                      Reconnect profile
                    </button>
                  ) : ["unmanaged", "modified", "stale"].includes(snapshot.externalSound.ownership) ? (
                    <div className="external-sound-actions">
                      <input
                        name="existing-sound-profile-name"
                        autoComplete="off"
                        value={adoptName}
                        onChange={(event) => setAdoptName(event.target.value)}
                        placeholder="Profile name…"
                        aria-label="Name for installed sound mod profile"
                      />
                      <button
                        type="button"
                        className="primary compact"
                        disabled={!adoptName.trim()}
                        onClick={() => void adoptExternal()}
                      >
                        {snapshot.externalSound.ownership === "unmanaged" ? "Save as profile" : "Save current files"}
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button"
                    title="Open sound/mod folder"
                    aria-label="Open sound/mod folder"
                    onClick={() => void window.tailmark.files.openPath(snapshot.externalSound!.path)}
                  >
                    <FolderOpen />
                  </button>
                </div>
              ) : null}
              <div className="list-header sound">
                <span>Sound package</span>
                <span>Files</span>
                <span>Imported</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {filteredSounds.length ? (
                filteredSounds.map((sound) => (
                  <div
                    key={sound.id}
                    className={`sound-row-wrap ${expanded === sound.id ? "expanded" : ""}`}
                  >
                    <div className="library-row sound">
                      <div className="package-name">
                        <strong>{sound.name}</strong>
                        <span title={sound.archiveSource}>
                          {sound.archiveSource}
                        </span>
                      </div>
                      <div>
                        <strong>{sound.fileCount.toLocaleString()}</strong>
                        <span>{formatBytes(sound.totalSize)}</span>
                      </div>
                      <span>{formatDate(sound.importedAt)}</span>
                      <span
                        className={`inline-status ${sound.active ? "ready" : "skipped"}`}
                      >
                        <span className="status-dot" />
                        {sound.active ? "Active" : "Inactive"}
                      </span>
                      <div className="action-group">
                        {sound.active ? (
                          <button
                            type="button"
                            className="compact"
                            onClick={() =>
                              void handleResult(
                                window.tailmark.library.deactivateSound(),
                                "Sound mod deactivated",
                              )
                            }
                          >
                            <Power />
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="compact primary"
                            disabled={snapshot.gameRunning}
                            onClick={() =>
                              void handleResult(
                                window.tailmark.library.activateSound(sound.id),
                                "Sound profile activated",
                              )
                            }
                          >
                            <Play />
                            Activate
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button"
                          title="Open stored package"
                          aria-label={`Open ${sound.name} stored package`}
                          onClick={() =>
                            void window.tailmark.files.openPath(
                              sound.libraryPath,
                            )
                          }
                        >
                          <FolderOpen />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="View package details"
                          aria-label={`View details for ${sound.name}`}
                          aria-expanded={expanded === sound.id}
                          onClick={() =>
                            setExpanded(expanded === sound.id ? null : sound.id)
                          }
                        >
                          {expanded === sound.id ? (
                            <ChevronUp />
                          ) : (
                            <ChevronDown />
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          title="Remove"
                          aria-label={`Remove ${sound.name}`}
                          disabled={sound.active}
                          onClick={() => removeSound(sound)}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </div>
                    {expanded === sound.id ? (
                      <div className="package-details">
                        <div>
                          <span>Validation</span>
                          <strong>{sound.validationStatus}</strong>
                        </div>
                        <div>
                          <span>Known conflicts</span>
                          <strong>{sound.conflicts.length}</strong>
                        </div>
                        <div>
                          <span>Variants</span>
                          <strong>
                            {sound.variants.length
                              ? sound.variants.join(", ")
                              : "No declared variants"}
                          </strong>
                        </div>
                        {sound.notes ? (
                          <article>
                            <span>Package notes</span>
                            <pre>{sound.notes}</pre>
                          </article>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <EmptyLibrary
                  icon={<PackagePlus />}
                  title="No sound packages imported"
                  detail="Add a sound-mod ZIP in Installer. It will be stored here without changing active game files."
                />
              )}
            </div>
            <aside className="profile-builder">
              <header>
                <Layers3 />
                <div>
                  <h2>Sound profiles</h2>
                  <p>
                    Imports create a named single-package profile automatically.
                    Select one package to save another name, or enable advanced
                    merging for multi-package profiles.
                  </p>
                </div>
              </header>
              <label>
                Profile name
                <input
                  name="sound-profile-name"
                  autoComplete="off"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder={
                    snapshot.settings.advancedSoundMerging
                      ? "Crew voices + engines…"
                      : "Crew voices…"
                  }
                />
              </label>
              <div className="package-checklist">
                {snapshot.sounds.map((sound) => (
                  <label key={sound.id}>
                    <input
                      type="checkbox"
                      checked={selectedPackageIds.has(sound.id)}
                      onChange={(event) =>
                        setSelectedPackages((current) => {
                          if (!event.target.checked) return current.filter((id) => id !== sound.id);
                          if (!snapshot.settings.advancedSoundMerging) return [sound.id];
                          return [...current, sound.id];
                        })
                      }
                    />
                    <span>
                      <strong>{sound.name}</strong>
                      <small>
                        {selectedPackageIds.has(sound.id)
                          ? snapshot.settings.advancedSoundMerging
                            ? `Priority ${selectedPackages.indexOf(sound.id) + 1}`
                            : "Selected"
                          : "Not selected"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="primary"
                disabled={
                  !profileName.trim()
                  || selectedPackages.length < 1
                  || (!snapshot.settings.advancedSoundMerging && selectedPackages.length !== 1)
                }
                onClick={() => void createProfile()}
              >
                <Layers3 />
                {selectedPackages.length > 1 ? "Create combined profile" : "Create profile"}
              </button>
              {!snapshot.settings.advancedSoundMerging ? (
                <p className="section-copy">
                  Multi-package merges stay off until advanced sound-mod merging
                  is enabled in Settings.
                </p>
              ) : null}
              <div className="saved-profiles">
                <h3>Saved profiles</h3>
                {snapshot.profiles.length ? (
                  snapshot.profiles.map((profile) => {
                    const isOnlyPackageProfile = profile.packageIds.length === 1
                      && !snapshot.profiles.some((item) => item.id !== profile.id && item.packageIds.length === 1 && item.packageIds[0] === profile.packageIds[0]);
                    return (
                    <div className="saved-profile" key={profile.id}>
                      <div>
                        <span>
                          {renamingProfile === profile.id ? (
                            <span className="inline-rename profile-inline-rename">
                              <input
                                name={`profile-name-${profile.id}`}
                                autoComplete="off"
                                value={profileRenameValue}
                                onChange={(event) => setProfileRenameValue(event.target.value)}
                                aria-label={`Rename ${profile.name}`}
                                autoFocus
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void saveProfileRename(profile.id);
                                  if (event.key === "Escape") setRenamingProfile(null);
                                }}
                              />
                              <button type="button" className="icon-button" aria-label="Save profile name" onClick={() => void saveProfileRename(profile.id)}><Check /></button>
                              <button type="button" className="icon-button" aria-label="Cancel profile rename" onClick={() => setRenamingProfile(null)}><X /></button>
                            </span>
                          ) : <strong>{profile.name}</strong>}
                          <small>
                            {profile.packageIds.length}{" "}
                            {profile.packageIds.length === 1 ? "package" : "packages"}
                            {profile.conflicts.length
                              ? ` · ${profile.conflicts.length} conflicts`
                              : ""}
                          </small>
                        </span>
                        <div className="profile-actions">
                          <button
                            type="button"
                            className="compact"
                            disabled={snapshot.gameRunning || profile.active}
                            onClick={() =>
                              void handleResult(
                                window.tailmark.library.activateProfile(profile.id),
                                "Sound profile activated",
                              )
                            }
                          >
                            {profile.active ? "Active" : "Activate"}
                          </button>
                          <button type="button" className="icon-button" aria-label={`Rename ${profile.name}`} title="Rename profile" onClick={() => { setRenamingProfile(profile.id); setProfileRenameValue(profile.name); }}><Pencil /></button>
                          <button type="button" className="icon-button danger-icon" aria-label={`Remove ${profile.name}`} title={isOnlyPackageProfile ? "Every package keeps one profile" : "Remove profile"} disabled={profile.active || isOnlyPackageProfile} onClick={() => removeProfile(profile.id, profile.name)}><Trash2 /></button>
                        </div>
                      </div>
                      <details>
                        <summary>Review packages</summary>
                        <ol>
                          {profile.priority.map((packageId) => (
                            <li key={packageId}>
                              {snapshot.sounds.find((sound) => sound.id === packageId)?.name ??
                                "Missing package"}
                            </li>
                          ))}
                        </ol>
                        {profile.conflicts.length ? (
                          <div className="profile-conflicts">
                            {profile.conflicts.map((conflict) => (
                              <div key={conflict.path}>
                                <code>{conflict.path}</code>
                                <span>
                                  Won by{" "}
                                  {snapshot.sounds.find(
                                    (sound) => sound.id === conflict.winnerPackageId,
                                  )?.name ?? "missing package"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No overlapping filenames.</p>
                        )}
                      </details>
                    </div>
                    );
                  })
                ) : (
                  <p className="section-copy">No profiles yet. Import a sound ZIP or save the detected install.</p>
                )}
              </div>
            </aside>
          </section>
        ) : null}
        {tab === "backups" ? (
          <section className="library-list" aria-label="Backups">
            <div className="list-header backups">
              <span>Backup</span>
              <span>Size</span>
              <span>Created</span>
              <span>Source</span>
              <span>Actions</span>
            </div>
            {filteredBackups.length ? (
              filteredBackups.map((backup) => (
                <div className="library-row backups" key={backup.id}>
                  <div className="package-name">
                    <strong>{backup.reason}</strong>
                    <span>{backup.id}</span>
                  </div>
                  <strong>{formatBytes(backup.size)}</strong>
                  <span>{formatDate(backup.createdAt)}</span>
                  <span className="path-cell" title={backup.sourcePath}>
                    {backup.sourcePath}
                  </span>
                  <div className="action-group">
                    <button
                      type="button"
                      className="icon-button"
                      title="Open backup"
                      aria-label="Open backup folder"
                      onClick={() =>
                        void window.tailmark.files.openPath(backup.backupPath)
                      }
                    >
                      <FolderOpen />
                    </button>
                    <button
                      type="button"
                      className="compact"
                      disabled={!backup.restorable}
                      onClick={() => restoreBackup(backup)}
                    >
                      <ArchiveRestore />
                      Restore
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyLibrary
                icon={<ArchiveRestore />}
                title="No backups available"
                detail="Backups appear here before Tailmark replaces, removes, activates, or deactivates managed content."
              />
            )}
          </section>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        detail={confirm?.detail ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) void action();
        }}
      />
    </main>
  );
}

function EmptyLibrary({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="library-empty">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
