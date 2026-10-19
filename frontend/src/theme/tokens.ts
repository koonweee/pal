export interface SemanticColors {
  accent: string;
  app: string;
  panel: string;
  raised: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderEssential: string;
  successForeground: string;
  successBackground: string;
  successBorder: string;
  warningForeground: string;
  warningBackground: string;
  warningBorder: string;
  dangerForeground: string;
  dangerBackground: string;
  dangerBorder: string;
  selection: string;
  selectionForeground: string;
  overlay: string;
  imageForeground: string;
}

export interface SemanticTheme {
  colors: SemanticColors;
  radii: {
    control: string;
    surface: string;
    round: string;
  };
  spacing: {
    control: string;
    content: string;
    section: string;
  };
  shadows: {
    raised: string;
    overlay: string;
  };
  effects: {
    raisedBackdrop: string;
  };
  motion: {
    quick: string;
    standard: string;
  };
}

export const lightTheme = {
  colors: {
    accent: '#0066d6',
    app: '#ffffff',
    panel: '#f9f9fb',
    raised: '#f3f3f5',
    text: '#1c1c1e',
    textSecondary: '#6c6c70',
    textMuted: '#8e8e93',
    borderSubtle: '#e5e5ea',
    borderEssential: '#d1d1d6',
    successForeground: '#248a3d',
    successBackground: '#effaf1',
    successBorder: '#b7e4c0',
    warningForeground: '#c93400',
    warningBackground: '#fff4e6',
    warningBorder: '#ffd8a8',
    dangerForeground: '#d70015',
    dangerBackground: '#fff1f0',
    dangerBorder: '#ffd5d2',
    selection: '#cce5ff',
    selectionForeground: '#1c1c1e',
    overlay: 'rgba(0, 0, 0, 0.28)',
    imageForeground: '#ffffff',
  },
  radii: { control: '8px', surface: '14px', round: '999px' },
  spacing: { control: '8px', content: '16px', section: '24px' },
  shadows: {
    raised: '0 8px 28px rgba(0, 0, 0, 0.12)',
    overlay: '0 12px 36px rgba(0, 0, 0, 0.16)',
  },
  effects: { raisedBackdrop: 'none' },
  motion: { quick: '120ms', standard: '180ms' },
} satisfies SemanticTheme;

export const darkTheme = {
  colors: {
    accent: '#0066d6',
    app: '#000000',
    panel: '#1c1c1e',
    raised: 'rgba(27, 27, 29, 0.8)',
    text: '#f2f2f7',
    textSecondary: '#aeaeb2',
    textMuted: '#98989d',
    borderSubtle: '#2c2c2e',
    borderEssential: '#48484a',
    successForeground: '#30d158',
    successBackground: '#102a18',
    successBorder: '#1f5a30',
    warningForeground: '#ff9f0a',
    warningBackground: '#2b200f',
    warningBorder: '#664817',
    dangerForeground: '#ff6961',
    dangerBackground: '#2d1212',
    dangerBorder: '#5b2525',
    selection: '#004a99',
    selectionForeground: '#ffffff',
    overlay: 'rgba(0, 0, 0, 0.42)',
    imageForeground: '#ffffff',
  },
  radii: { control: '8px', surface: '14px', round: '999px' },
  spacing: { control: '8px', content: '16px', section: '24px' },
  shadows: {
    raised: '0 8px 28px rgba(0, 0, 0, 0.38)',
    overlay: '0 12px 36px rgba(0, 0, 0, 0.38)',
  },
  effects: { raisedBackdrop: 'blur(8px) saturate(130%)' },
  motion: { quick: '120ms', standard: '180ms' },
} satisfies SemanticTheme;
