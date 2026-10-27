import { Alert, Loader, Modal, UnstyledButton } from '@mantine/core';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fileContentUrl, type Attachment } from '../api/client';
import { fileSize } from '../attachments/use-pending-files';
import { IconAction } from '../ui/IconAction';

const inlineTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

const swipeDistance = 48;

function fileDownloadUrl(file: Attachment) {
  return `/api/files/${encodeURIComponent(file.id)}/download`;
}

function supportsFileSharing() {
  return (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  );
}

function expectedShareDismissal(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'NotAllowedError')
  );
}

function useFileHandoff(file: Attachment) {
  const [state, setState] = useState<'idle' | 'preparing' | 'failed'>('idle');
  const prepared = useRef<File | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const available = supportsFileSharing();

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  async function share(preparedFile: File) {
    try {
      await navigator.share({ files: [preparedFile], title: file.filename });
      setState('idle');
    } catch (error) {
      if (!expectedShareDismissal(error)) setState('failed');
    }
  }

  async function open() {
    if (!available) return;
    if (prepared.current) {
      await share(prepared.current);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setState('preparing');
    try {
      const response = await fetch(fileContentUrl(file.id), {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`File request failed: ${response.status}`);
      const blob = await response.blob();
      const preparedFile = new File([blob], file.filename, {
        type: file.contentType || blob.type || 'application/octet-stream',
      });
      if (!navigator.canShare({ files: [preparedFile] })) {
        window.location.assign(fileDownloadUrl(file));
        return;
      }
      prepared.current = preparedFile;
      setState('idle');
      await share(preparedFile);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setState('failed');
    } finally {
      request.current = undefined;
    }
  }

  return { available, open, state };
}

function fileLabel(file: Attachment) {
  const extension = file.filename.match(/\.([a-z0-9]{1,10})$/i)?.[1];
  return (
    extension?.toUpperCase() ??
    {
      'application/pdf': 'PDF',
      'application/json': 'JSON',
      'text/plain': 'TXT',
    }[file.contentType] ??
    'FILE'
  );
}

function FilePill({ file }: { file: Attachment }) {
  const handoff = useFileHandoff(file);
  const extension = file.filename.match(/\.[^.]+$/)?.[0] ?? '';
  const contents = (
    <>
      <span className="file-graphic">
        {handoff.state === 'preparing' ? (
          <Loader size={24} color="currentColor" aria-hidden="true" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.4a2 2 0 0 1-2.83-2.83l8.48-8.48" />
          </svg>
        )}
        <span>{fileLabel(file)}</span>
      </span>
      <span className="file-details">
        <span className="file-name">
          <span className="file-stem">
            {extension
              ? file.filename.slice(0, -extension.length)
              : file.filename}
          </span>
          <span className="file-extension">{extension}</span>
        </span>
        <span
          className="file-size"
          role={handoff.state === 'failed' ? 'status' : undefined}
        >
          {handoff.state === 'failed'
            ? 'Couldn’t open'
            : fileSize(file.sizeBytes)}
        </span>
      </span>
    </>
  );

  return handoff.available ? (
    <UnstyledButton
      type="button"
      className="file-pill"
      title={file.filename}
      aria-busy={handoff.state === 'preparing' || undefined}
      aria-label={`${handoff.state === 'failed' ? 'Retry opening' : 'Open or share'} ${file.filename}, ${fileSize(file.sizeBytes)}`}
      disabled={handoff.state === 'preparing'}
      onClick={() => void handoff.open()}
    >
      {contents}
    </UnstyledButton>
  ) : (
    <a
      className="file-pill"
      href={fileDownloadUrl(file)}
      title={file.filename}
      aria-label={`Download ${file.filename}, ${fileSize(file.sizeBytes)}`}
    >
      {contents}
    </a>
  );
}

function ImageFileAction({ file }: { file: Attachment }) {
  const handoff = useFileHandoff(file);
  const contents =
    handoff.state === 'preparing' ? (
      <Loader size={20} color="currentColor" aria-hidden="true" />
    ) : (
      <Download aria-hidden="true" size={20} strokeWidth={1.75} />
    );

  return handoff.available ? (
    <UnstyledButton
      type="button"
      className="image-lightbox-download"
      aria-busy={handoff.state === 'preparing' || undefined}
      aria-label={`${handoff.state === 'failed' ? 'Retry opening' : 'Open or share'} ${file.filename}`}
      disabled={handoff.state === 'preparing'}
      onClick={() => void handoff.open()}
    >
      {contents}
    </UnstyledButton>
  ) : (
    <a
      className="image-lightbox-download"
      href={fileDownloadUrl(file)}
      aria-label={`Download ${file.filename}`}
    >
      {contents}
    </a>
  );
}

function ImageCell({
  file,
  index,
  count,
  open,
}: {
  file: Attachment;
  index: number;
  count: number;
  open(trigger: HTMLButtonElement): void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return (
    <div className="image-cell" data-state={state}>
      <UnstyledButton
        type="button"
        className="image-open"
        aria-label={`Open image ${index + 1} of ${count}: ${file.filename}`}
        onClick={(event) => open(event.currentTarget)}
      >
        <img
          loading="lazy"
          src={fileContentUrl(file.id)}
          alt={file.filename}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
        {state !== 'ready' && (
          <span className="image-status">
            {state === 'failed' ? 'Preview unavailable' : 'Loading…'}
          </span>
        )}
      </UnstyledButton>
    </div>
  );
}

function ImageLightbox({
  images,
  index,
  onClose,
  onSelect,
}: {
  images: Attachment[];
  index: number;
  onClose(restoreFocus: boolean): void;
  onSelect(index: number): void;
}) {
  const [failed, setFailed] = useState(false);
  const swipe = useRef<{ id: number; x: number; y: number } | undefined>(
    undefined,
  );
  const image = images[index]!;
  const previous = index > 0;
  const next = index < images.length - 1;

  function select(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= images.length) return;
    setFailed(false);
    onSelect(nextIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' && previous) {
      event.preventDefault();
      select(index - 1);
    }
    if (event.key === 'ArrowRight' && next) {
      event.preventDefault();
      select(index + 1);
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose(false);
  }

  function handlePointerDown(event: PointerEvent<HTMLImageElement>) {
    if (event.pointerType !== 'touch') return;
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLImageElement>) {
    const start = swipe.current;
    swipe.current = undefined;
    if (!start || start.id !== event.pointerId) return;
    const horizontal = event.clientX - start.x;
    const vertical = event.clientY - start.y;
    if (
      Math.abs(horizontal) < swipeDistance ||
      Math.abs(horizontal) <= Math.abs(vertical)
    )
      return;
    select(horizontal < 0 ? index + 1 : index - 1);
  }

  return (
    <Modal
      fullScreen
      opened
      onClose={() => onClose(true)}
      onKeyDown={handleKeyDown}
      closeOnClickOutside={false}
      returnFocus={false}
      transitionProps={{ duration: 0 }}
      withCloseButton={false}
      title={<span className="sr-only">Image preview: {image.filename}</span>}
      classNames={{
        overlay: 'pal-overlay-backdrop',
        content: 'image-lightbox pal-raised-backdrop',
        header: 'image-lightbox-header',
        body: 'image-lightbox-body',
      }}
    >
      <div className="image-lightbox-stage" onClick={handleBackdropClick}>
        <span className="sr-only" aria-live="polite">
          Image {index + 1} of {images.length}: {image.filename}
        </span>
        <IconAction
          className="image-lightbox-close"
          label="Close image preview"
          onClick={(event) => onClose(event.detail === 0)}
          tooltipLabel={null}
          type="button"
        >
          <X aria-hidden="true" size={24} strokeWidth={1.5} />
        </IconAction>
        <ImageFileAction key={image.id} file={image} />
        {images.length > 1 && (
          <>
            <span className="image-lightbox-counter" aria-hidden="true">
              {index + 1}/{images.length}
            </span>
            <IconAction
              className="image-lightbox-arrow image-lightbox-previous"
              disabled={!previous}
              label="Previous image"
              onClick={() => select(index - 1)}
              tooltipLabel={null}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={28} strokeWidth={1.5} />
            </IconAction>
            <IconAction
              className="image-lightbox-arrow image-lightbox-next"
              disabled={!next}
              label="Next image"
              onClick={() => select(index + 1)}
              tooltipLabel={null}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={28} strokeWidth={1.5} />
            </IconAction>
          </>
        )}
        <img
          key={image.id}
          className="image-lightbox-image"
          src={fileContentUrl(image.id)}
          alt={image.filename}
          hidden={failed}
          onError={() => setFailed(true)}
          onPointerCancel={() => {
            swipe.current = undefined;
          }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        />
        {failed && (
          <Alert className="image-lightbox-error" role="status" color="red">
            Image preview unavailable. You can still download the file.
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export function MessageAttachments({
  files,
  onPreviewChange,
}: {
  files: Attachment[];
  onPreviewChange(open: boolean): void;
}) {
  const [previewIndex, setPreviewIndex] = useState<number>();
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const images = files.filter((file) => inlineTypes.has(file.contentType));
  const documents = files.filter((file) => !inlineTypes.has(file.contentType));
  const columns = Math.min(images.length, 4);

  function closePreview(restoreFocus: boolean) {
    setPreviewIndex(undefined);
    onPreviewChange(false);
    if (restoreFocus)
      requestAnimationFrame(() => previewTrigger.current?.focus());
  }

  return (
    <div className="message-attachments">
      {!!images.length && (
        <div
          className="image-grid"
          data-columns={columns}
          style={{ '--pal-image-columns': columns } as CSSProperties}
        >
          {images.map((file, index) => (
            <ImageCell
              key={file.id}
              file={file}
              index={index}
              count={images.length}
              open={(trigger) => {
                previewTrigger.current = trigger;
                onPreviewChange(true);
                setPreviewIndex(index);
              }}
            />
          ))}
        </div>
      )}
      {!!documents.length && (
        <div className="file-pills">
          {documents.map((file) => (
            <FilePill key={file.id} file={file} />
          ))}
        </div>
      )}
      {previewIndex !== undefined && (
        <ImageLightbox
          images={images}
          index={previewIndex}
          onClose={closePreview}
          onSelect={setPreviewIndex}
        />
      )}
    </div>
  );
}
