import { DEFAULT_THEME, type AppTheme } from '@shared/themes';

export const THEME_STORAGE_KEY = 'tailmark-theme';

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'catppuccin-latte' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function readCachedTheme(): AppTheme | null {
  const cached = localStorage.getItem(THEME_STORAGE_KEY);
  if (!cached) return null;
  return cached as AppTheme;
}

export function bootstrapTheme(): void {
  applyTheme(readCachedTheme() ?? DEFAULT_THEME);
}
