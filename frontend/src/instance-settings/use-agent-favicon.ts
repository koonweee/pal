import { useEffect } from 'react';
import { fileContentUrl, type InstanceSettings } from '../api/client';

export function useAgentFavicon(settings: InstanceSettings) {
  useEffect(() => {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="${settings.accentColor}" stroke-width="32"/></svg>`,
    )}`;
    document.head.append(icon);

    const image = new Image();
    if (settings.agentAvatarAttachmentId) {
      image.onload = () => {
        icon.type = 'image/png';
        icon.href = image.src;
      };
      image.src = fileContentUrl(settings.agentAvatarAttachmentId);
    }

    return () => {
      image.onload = null;
      icon.remove();
    };
  }, [settings]);
}
