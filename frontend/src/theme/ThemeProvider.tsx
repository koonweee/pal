import {
  MantineProvider,
  Radio,
  Stack,
  createTheme,
  type MantineColorScheme,
  type MantineColorsTuple,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { darkTheme, lightTheme, type SemanticTheme } from './tokens';
import './theme.css';

const modes = ['auto', 'light', 'dark'] as const;
export type ThemeMode = (typeof modes)[number];

interface ThemeContextValue {
  mode: ThemeMode;
  select(mode: ThemeMode): void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function mix(color: string, target: 0 | 255, amount: number) {
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
  return `#${channels
    .map((channel) =>
      Math.round(channel + (target - channel) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function accentPalette(accent: string) {
  return [
    mix(accent, 255, 0.92),
    mix(accent, 255, 0.82),
    mix(accent, 255, 0.68),
    mix(accent, 255, 0.52),
    mix(accent, 255, 0.36),
    mix(accent, 255, 0.2),
    mix(accent, 255, 0.08),
    accent,
    mix(accent, 0, 0.14),
    mix(accent, 0, 0.28),
  ] as MantineColorsTuple;
}

function accentForeground(accent: string) {
  const channels = [1, 3, 5].map(
    (start) => Number.parseInt(accent.slice(start, start + 2), 16) / 255,
  );
  const luminance = channels
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (total, channel, index) =>
        total + channel * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    ? '#000000'
    : '#ffffff';
}

function applyVariables(definition: SemanticTheme, accent: string) {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(definition.colors))
    root.setProperty(
      `--pal-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  for (const [name, value] of Object.entries(definition.radii))
    root.setProperty(`--pal-radius-${name}`, value);
  for (const [name, value] of Object.entries(definition.spacing))
    root.setProperty(`--pal-space-${name}`, value);
  for (const [name, value] of Object.entries(definition.shadows))
    root.setProperty(`--pal-shadow-${name}`, value);
  for (const [name, value] of Object.entries(definition.effects))
    root.setProperty(
      `--pal-effect-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  for (const [name, value] of Object.entries(definition.motion))
    root.setProperty(`--pal-motion-${name}`, value);
  const foreground = accentForeground(accent);
  root.setProperty('--pal-accent', accent);
  root.setProperty('--pal-action', accent);
  root.setProperty('--pal-action-hover', mix(accent, 0, 0.14));
  root.setProperty('--pal-action-foreground', foreground);
  root.setProperty('--pal-focus', accent);
  root.setProperty('--pal-user-message', accent);
  root.setProperty('--pal-user-message-foreground', foreground);
}

function createPalTheme(accent: string) {
  return createTheme({
    colors: { pal: accentPalette(accent) },
    primaryColor: 'pal',
    primaryShade: 7,
    autoContrast: true,
    luminanceThreshold: 0.3,
    defaultRadius: lightTheme.radii.control,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    components: {
      ActionIcon: {
        defaultProps: { radius: 'md', size: 44, variant: 'subtle' },
      },
      Alert: { defaultProps: { radius: 'md' } },
      Badge: { defaultProps: { radius: 'xl', variant: 'light' } },
      Button: { defaultProps: { radius: 'md', size: 'md' } },
      Checkbox: { defaultProps: { radius: 'sm' } },
      CloseButton: { defaultProps: { radius: 'xl', size: 44 } },
      Drawer: { defaultProps: { overlayProps: { opacity: 0.34, blur: 1 } } },
      Input: { defaultProps: { radius: 'md', size: 'md' } },
      Loader: { defaultProps: { size: 'sm', type: 'oval' } },
      Menu: { defaultProps: { radius: 'md', shadow: 'md' } },
      Modal: {
        defaultProps: {
          centered: true,
          overlayProps: { opacity: 0.34, blur: 1 },
          radius: 'lg',
        },
      },
      Popover: { defaultProps: { radius: 'md', shadow: 'md' } },
      Progress: { defaultProps: { radius: 'xl', size: 'sm' } },
      NavLink: { defaultProps: { variant: 'subtle' } },
      Radio: { defaultProps: { size: 'md' } },
      Switch: { defaultProps: { radius: 'xl', size: 'md' } },
      Tabs: { defaultProps: { radius: 'md' } },
      Tooltip: { defaultProps: { openDelay: 500, withArrow: true } },
    },
    other: { light: lightTheme, dark: darkTheme },
  });
}

function storedMode(): ThemeMode {
  try {
    const value = localStorage.getItem('pal-theme');
    return modes.includes(value as ThemeMode) ? (value as ThemeMode) : 'auto';
  } catch {
    return 'auto';
  }
}

export function PalThemeProvider({ children }: PropsWithChildren) {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setMode] = useState<ThemeMode>(storedMode);
  const { settings } = useInstanceSettings();
  const accent = settings.accentColor;
  const resolved: MantineColorScheme =
    mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => createPalTheme(accent), [accent]);

  useLayoutEffect(() => {
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.dataset.theme = resolved;
    applyVariables(resolved === 'dark' ? darkTheme : lightTheme, accent);
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
  }, [accent, resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      select(next) {
        setMode(next);
        try {
          localStorage.setItem('pal-theme', next);
        } catch {
          // The selection still applies to the current page.
        }
      },
    }),
    [mode],
  );

  return (
    <ThemeContext.Provider value={value}>
      <MantineProvider theme={theme} forceColorScheme={resolved}>
        {children}
      </MantineProvider>
    </ThemeContext.Provider>
  );
}

export function ThemePreferences() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemePreferences requires PalThemeProvider');

  return (
    <section className="theme-preferences">
      <Radio.Group
        label="Color scheme"
        value={context.mode}
        onChange={(value) => context.select(value as ThemeMode)}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="auto" label="Use system setting" />
          <Radio value="light" label="Light" />
          <Radio value="dark" label="Dark" />
        </Stack>
      </Radio.Group>
    </section>
  );
}
