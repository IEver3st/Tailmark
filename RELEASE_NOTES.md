# Tailmark 1.1.0 Release Notes

## Release title

Tailmark 1.1.0 - downloads automation, tray support, collections, sights, and hangars

## Summary

Tailmark 1.1.0 adds background downloads automation, system-tray operation, and managed support for skin collections, custom sights, and custom hangars. The Library now shows total installed size, and Safe Mode plus a recovery journal make interrupted operations safer to resume or roll back.

## What's new

- **Downloads automation** - watch a folder for completed skin ZIPs and install high-confidence, skin-only archives automatically.
- **System tray mode** - keep Tailmark running in the Windows notification area so the watcher stays alive without an open window.
- **Managed skin collections** - group skins and activate one collection at a time.
- **Custom sights** - import, store, and activate per-vehicle or `all_tanks` sight packages.
- **Custom hangars** - import, store, and activate hangar packages with `.blk` and `.bin` files.
- **Safe Mode and recovery journal** - temporarily restore managed content and resume or roll back interrupted operations.
- **Library totals** - see total installed size for skins, sounds, and backups, plus size and file count per package.
- **Cleaner duplicate handling** - `Ignore duplicate content` is applied to the installer queue, and source ZIPs are only recycled after successful installs or confirmed duplicates.
- **Branding and packaging polish** - transparent branding assets, separate header branding from app icon, and `icon.ico` bundled as an extra resource.

## Install / upgrade

1. Download `Tailmark-Setup-1.1.0.exe` from this release.
2. Run the installer. It will upgrade an existing Tailmark 1.0.0 install in place because the `appId` (`com.tailmark.app`) is unchanged.
3. Launch Tailmark from the Start Menu or desktop shortcut.

Your existing settings, library, and backups are preserved.

## Build from source

```powershell
npm install
npm run dist:win
```

The installer will be at `release/Tailmark-Setup-1.1.0.exe`.

## Known issues

- This release is unsigned; Windows SmartScreen may show a warning until an Authenticode certificate is configured.
- Downloads automation installs only high-confidence, skin-only archives. Sounds, sights, hangars, mixed archives, and anything needing review are left in the Installer queue for manual handling.

## Assets

- `Tailmark-Setup-1.1.0.exe` - Windows x64 NSIS installer

## Checksums

| File | SHA-256 |
|---|---|
| `Tailmark-Setup-1.1.0.exe` | `DD9FC60D4B9B3FCEFC0A2EE822B9EA4457EAA625A4394C80E9BE5C03575C2D0C` |
