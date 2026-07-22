export const APP_THEMES = [
  'everforest',
  'catppuccin-mocha',
  'catppuccin-latte',
  'nord',
  'tokyo-night',
  'gruvbox-dark',
  'rose-pine',
  'one-dark',
  'dracula',
  'solarized-dark',
] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const DEFAULT_THEME: AppTheme = 'everforest';

export interface ThemeOption {
  id: AppTheme;
  label: string;
  description: string;
  swatches: [string, string, string];
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'everforest', label: 'Everforest', description: 'Muted forest greens with warm neutrals.', swatches: ['#2d353b', '#7fbbb3', '#a7c080'] },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', description: 'Soft pastel dark theme with cozy contrast.', swatches: ['#1e1e2e', '#89b4fa', '#a6e3a1'] },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', description: 'Light Catppuccin palette for bright environments.', swatches: ['#eff1f5', '#1e66f5', '#40a02b'] },
  { id: 'nord', label: 'Nord', description: 'Arctic, bluish interface with calm accents.', swatches: ['#2e3440', '#88c0d0', '#a3be8c'] },
  { id: 'tokyo-night', label: 'Tokyo Night', description: 'Deep indigo workspace with vivid highlights.', swatches: ['#1a1b26', '#7aa2f7', '#9ece6a'] },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', description: 'Retro earthy tones with warm yellow text.', swatches: ['#282828', '#83a598', '#b8bb26'] },
  { id: 'rose-pine', label: 'Rosé Pine', description: 'Muted rose and pine with elegant contrast.', swatches: ['#191724', '#c4a7e7', '#9ccfd8'] },
  { id: 'one-dark', label: 'One Dark', description: 'Atom-inspired dark UI with crisp syntax colors.', swatches: ['#282c34', '#61afef', '#98c379'] },
  { id: 'dracula', label: 'Dracula', description: 'High-contrast purple dark theme.', swatches: ['#282a36', '#bd93f9', '#50fa7b'] },
  { id: 'solarized-dark', label: 'Solarized Dark', description: 'Precision palette with restrained cyan accents.', swatches: ['#002b36', '#268bd2', '#859900'] },
];
