export {};
const modes = ['auto', 'light', 'dark'] as const;
type Theme = (typeof modes)[number];
const button = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const browserColor = document.querySelector<HTMLMetaElement>(
  'meta[name="theme-color"]',
)!;
const system = matchMedia('(prefers-color-scheme: dark)');
const icons: Record<Theme, string> = {
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
  light:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  dark: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
};
const initial = document.documentElement.style.colorScheme;
let theme: Theme = initial === 'light' || initial === 'dark' ? initial : 'auto';
function renderTheme() {
  document.documentElement.style.colorScheme =
    theme === 'auto' ? 'light dark' : theme;
  const dark = theme === 'dark' || (theme === 'auto' && system.matches);
  browserColor.content = dark ? '#000000' : '#ffffff';
  const next = modes[(modes.indexOf(theme) + 1) % modes.length];
  const label = `Theme: ${theme}. Switch to ${next}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[theme]}</svg>`;
}
button.addEventListener('click', () => {
  theme = modes[(modes.indexOf(theme) + 1) % modes.length]!;
  try {
    localStorage.setItem('pal-theme', theme);
  } catch {
    // Apply the selection for this page even without persistent storage.
  }
  renderTheme();
});
system.addEventListener('change', renderTheme);
renderTheme();
