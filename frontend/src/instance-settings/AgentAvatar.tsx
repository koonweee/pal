import { useState } from 'react';
import { fileContentUrl } from '../api/client';

export function AgentAvatar({
  attachmentId,
  previewUrl,
}: {
  attachmentId?: string | null;
  previewUrl?: string;
}) {
  const src =
    previewUrl ?? (attachmentId ? fileContentUrl(attachmentId) : undefined);
  const [failed, setFailed] = useState<string>();
  const showImage = !!src && src !== failed;
  return (
    <span
      className="agent-avatar"
      data-image={showImage || undefined}
      aria-hidden="true"
    >
      {showImage && <img src={src} alt="" onError={() => setFailed(src)} />}
    </span>
  );
}
