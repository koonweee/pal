import { ColorSwatch, Group } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fileContentUrl } from '../api/client';
import { IconAction } from '../ui/IconAction';
import { avatarColors } from './avatar-colors';

function useAvatarColors(attachmentId: string | null) {
  const [sample, setSample] = useState<{ id: string; colors: string[] }>();
  useEffect(() => {
    if (!attachmentId) return;
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(
          1,
          32 / Math.max(image.naturalWidth, image.naturalHeight),
        );
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setSample({
          id: attachmentId,
          colors: avatarColors(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          ),
        });
      } catch {
        setSample({ id: attachmentId, colors: [] });
      }
    };
    image.onerror = () => setSample({ id: attachmentId, colors: [] });
    image.src = fileContentUrl(attachmentId);
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [attachmentId]);
  return sample?.id === attachmentId ? sample.colors : [];
}

export function AvatarAccentChoices({
  attachmentId,
  value,
  disabled,
  onChange,
}: {
  attachmentId: string | null;
  value: string;
  disabled: boolean;
  onChange(color: string): void;
}) {
  const colors = useAvatarColors(attachmentId);
  if (!colors.length) return null;
  return (
    <Group gap={4} role="group" aria-label="Colors from profile image">
      {colors.map((color) => (
        <IconAction
          key={color}
          type="button"
          label={`Use ${color} as accent color`}
          tooltipLabel={null}
          aria-pressed={value.toLowerCase() === color}
          disabled={disabled}
          onClick={() => onChange(color)}
        >
          <ColorSwatch color={color} size={22} aria-hidden="true" />
        </IconAction>
      ))}
    </Group>
  );
}
