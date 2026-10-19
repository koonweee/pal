import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadFile, type Attachment } from '../api/client';

const inlineTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

export interface PendingFile {
  id: string;
  file: File;
  state: 'waiting' | 'uploading' | 'ready' | 'failed';
  attachment?: Attachment;
  error?: string;
  preview?: string;
  controller?: AbortController;
}

export function fileSize(bytes: number) {
  return bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${(bytes / 1000).toFixed(1)} KB`
      : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function usePendingFiles(chat: string) {
  const chats = useRef(new Map<string, PendingFile[]>());
  const errors = useRef(new Map<string, string>());
  const active = useRef(0);
  const mounted = useRef(true);
  const pumpRef = useRef<() => void>(() => undefined);
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);

  const pump = useCallback(() => {
    while (active.current < 3) {
      const entry = [...chats.current.values()]
        .flat()
        .find((candidate) => candidate.state === 'waiting');
      if (!entry) break;
      entry.state = 'uploading';
      entry.controller = new AbortController();
      active.current++;
      void uploadFile(entry.file, entry.controller.signal)
        .then(({ attachment }) => {
          entry.attachment = attachment;
          entry.state = 'ready';
          entry.error = undefined;
        })
        .catch((error: unknown) => {
          if (entry.controller?.signal.aborted) return;
          entry.state = 'failed';
          entry.error =
            error instanceof Error ? error.message : 'Upload failed';
        })
        .finally(() => {
          active.current--;
          if (mounted.current) changed();
          pumpRef.current();
        });
    }
    changed();
  }, [changed]);
  pumpRef.current = pump;

  useEffect(
    () => () => {
      mounted.current = false;
      for (const entry of [...chats.current.values()].flat()) {
        entry.controller?.abort();
        if (entry.preview) URL.revokeObjectURL(entry.preview);
      }
    },
    [],
  );

  const add = useCallback(
    (files: File[], destination = chat) => {
      const entries = chats.current.get(destination) ?? [];
      if (entries.length + files.length > 100) {
        errors.current.set(
          destination,
          'A message can contain at most 100 files.',
        );
        changed();
        return;
      }
      errors.current.delete(destination);
      for (const file of files) {
        const tooLarge = file.size > 25_000_000;
        entries.push({
          id: crypto.randomUUID(),
          file,
          state: tooLarge ? 'failed' : 'waiting',
          error: tooLarge
            ? 'File exceeds 25 MB. Remove it to continue.'
            : undefined,
          preview: inlineTypes.has(file.type)
            ? URL.createObjectURL(file)
            : undefined,
        });
      }
      chats.current.set(destination, entries);
      changed();
      pumpRef.current();
    },
    [changed, chat],
  );

  const remove = useCallback(
    (entry: PendingFile, destination = chat) => {
      entry.controller?.abort();
      if (entry.preview) URL.revokeObjectURL(entry.preview);
      chats.current.set(
        destination,
        (chats.current.get(destination) ?? []).filter(
          (candidate) => candidate !== entry,
        ),
      );
      errors.current.delete(destination);
      changed();
    },
    [changed, chat],
  );

  const retry = useCallback(
    (entry: PendingFile) => {
      entry.state = 'waiting';
      entry.error = undefined;
      changed();
      pumpRef.current();
    },
    [changed],
  );

  const clear = useCallback(
    (destination: string) => {
      for (const entry of chats.current.get(destination) ?? []) {
        entry.controller?.abort();
        if (entry.preview) URL.revokeObjectURL(entry.preview);
      }
      chats.current.delete(destination);
      errors.current.delete(destination);
      changed();
    },
    [changed],
  );

  return useMemo(() => {
    const entries = chats.current.get(chat) ?? [];
    return {
      add,
      attachments: entries.flatMap((entry) =>
        entry.attachment ? [entry.attachment] : [],
      ),
      blocked: entries.some((entry) => entry.state !== 'ready'),
      clear,
      count: entries.length,
      entries,
      error: errors.current.get(chat),
      remove,
      retry,
    };
  }, [add, chat, clear, remove, retry, revision]);
}
