import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import { App } from './App';
import { InstanceSettingsProvider } from './instance-settings/InstanceSettingsProvider';
import { PalThemeProvider } from './theme/ThemeProvider';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <InstanceSettingsProvider
    preview={import.meta.env.DEV && location.pathname.startsWith('/__ui')}
  >
    <PalThemeProvider>
      <App />
    </PalThemeProvider>
  </InstanceSettingsProvider>,
);
