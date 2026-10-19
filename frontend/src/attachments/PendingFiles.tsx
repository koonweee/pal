import { Alert, Button, ScrollArea } from '@mantine/core';
import { X } from 'lucide-react';
import { IconAction } from '../ui/IconAction';
import type { PendingFile } from './use-pending-files';

interface PendingFilesProps {
  busy: boolean;
  entries: PendingFile[];
  error?: string;
  onRemove(entry: PendingFile): void;
  onRetry(entry: PendingFile): void;
}

export function PendingFiles({
  busy,
  entries,
  error,
  onRemove,
  onRetry,
}: PendingFilesProps) {
  if (!entries.length && !error) return null;
  return (
    <div id="pending-files" className="pending-files">
      {error && (
        <Alert className="pending-files-error" role="alert" color="red">
          {error}
        </Alert>
      )}
      {!!entries.length && (
        <ScrollArea
          className="pending-files-scroll"
          type="auto"
          scrollbars="x"
          scrollbarSize={6}
          offsetScrollbars="x"
          classNames={{
            viewport: 'pending-files-row',
            content: 'pending-files-content',
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="pending-file"
              data-state={entry.state}
            >
              {entry.preview && <img src={entry.preview} alt="" />}
              <span className="pending-file-details">
                <strong title={entry.file.name}>{entry.file.name}</strong>
                <span role="status" title={entry.error}>
                  {entry.error ??
                    (entry.state === 'ready' ? 'Ready' : 'Uploading…')}
                </span>
              </span>
              {entry.state === 'failed' && entry.file.size <= 25_000_000 && (
                <Button
                  type="button"
                  variant="transparent"
                  size="compact-sm"
                  disabled={busy}
                  aria-label={`Retry upload ${entry.file.name}`}
                  onClick={() => onRetry(entry)}
                >
                  Retry
                </Button>
              )}
              <IconAction
                type="button"
                disabled={busy}
                label={`Remove ${entry.file.name}`}
                onClick={() => onRemove(entry)}
              >
                <X aria-hidden="true" size={16} strokeWidth={1.75} />
              </IconAction>
            </div>
          ))}
        </ScrollArea>
      )}
    </div>
  );
}
