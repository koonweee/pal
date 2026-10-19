import { uploadFile, type Attachment } from './api';

const inlineTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);
const paperclip =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.4a2 2 0 0 1-2.83-2.83l8.48-8.48"/></svg>';
export function fileSize(bytes: number) {
  return bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${(bytes / 1000).toFixed(1)} KB`
      : `${(bytes / 1_000_000).toFixed(1)} MB`;
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
function filePill(file: Attachment) {
  const link = document.createElement('a');
  link.className = 'file-pill';
  link.href = `/api/files/${encodeURIComponent(file.id)}/download`;
  link.title = file.filename;
  link.setAttribute(
    'aria-label',
    `Download ${file.filename}, ${fileSize(file.sizeBytes)}`,
  );
  const graphic = document.createElement('span');
  graphic.className = 'file-graphic';
  graphic.innerHTML = paperclip;
  const type = document.createElement('span');
  type.textContent = fileLabel(file);
  graphic.append(type);
  const details = document.createElement('span');
  details.className = 'file-details';
  const name = document.createElement('span');
  name.className = 'file-name';
  const extension = file.filename.match(/\.[^.]+$/)?.[0] ?? '';
  const stem = document.createElement('span');
  stem.className = 'file-stem';
  stem.textContent = extension
    ? file.filename.slice(0, -extension.length)
    : file.filename;
  const suffix = document.createElement('span');
  suffix.className = 'file-extension';
  suffix.textContent = extension;
  name.append(stem, suffix);
  const size = document.createElement('span');
  size.className = 'file-size';
  size.textContent = fileSize(file.sizeBytes);
  details.append(name, size);
  link.append(graphic, details);
  return link;
}

let preview: HTMLDialogElement | undefined;
function openImage(file: Attachment) {
  if (!preview) {
    preview = document.createElement('dialog');
    preview.className = 'image-preview';
    preview.setAttribute('aria-label', 'Image preview');
    document.body.append(preview);
    preview.addEventListener('click', (event) => {
      if (event.target === preview) preview!.close();
    });
    preview.addEventListener('close', () => preview!.replaceChildren());
  }
  const bar = document.createElement('div');
  bar.className = 'image-preview-bar';
  const title = document.createElement('span');
  title.textContent = file.filename;
  const download = document.createElement('a');
  download.href = `/api/files/${encodeURIComponent(file.id)}/download`;
  download.textContent = 'Download';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close image preview');
  close.addEventListener('click', () => preview!.close());
  bar.append(title, download, close);
  const img = document.createElement('img');
  img.src = `/api/files/${encodeURIComponent(file.id)}/content`;
  img.alt = file.filename;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Loading image…';
  img.addEventListener('load', () => status.remove());
  img.addEventListener('error', () => {
    img.hidden = true;
    status.textContent =
      'Image preview unavailable. You can still download the file.';
  });
  preview.replaceChildren(bar, img, status);
  preview.showModal();
}

export function renderAttachments(files: Attachment[]) {
  const container = document.createElement('div');
  container.className = 'message-attachments';
  const images = files.filter((file) => inlineTypes.has(file.contentType));
  if (images.length) {
    const grid = document.createElement('div');
    grid.className = 'image-grid';
    grid.dataset.columns = String(
      images.length === 1 ? 1 : images.length <= 4 ? 2 : 3,
    );
    images.forEach((file, index) => {
      const cell = document.createElement('div');
      cell.className = 'image-cell';
      cell.dataset.state = 'loading';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'image-open';
      button.setAttribute(
        'aria-label',
        `Open image ${index + 1} of ${images.length}: ${file.filename}`,
      );
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `/api/files/${encodeURIComponent(file.id)}/content`;
      img.alt = file.filename;
      const status = document.createElement('span');
      status.className = 'image-status';
      status.textContent = 'Loading…';
      img.addEventListener('load', () => {
        cell.dataset.state = 'ready';
        status.remove();
      });
      img.addEventListener('error', () => {
        cell.dataset.state = 'failed';
        status.textContent = 'Preview unavailable';
      });
      button.append(img, status);
      button.addEventListener('click', () => openImage(file));
      const download = document.createElement('a');
      download.className = 'image-download';
      download.href = `/api/files/${encodeURIComponent(file.id)}/download`;
      download.textContent = '↓';
      download.setAttribute('aria-label', `Download ${file.filename}`);
      cell.append(button, download);
      grid.append(cell);
    });
    container.append(grid);
  }
  const documents = files.filter((file) => !inlineTypes.has(file.contentType));
  if (documents.length) {
    const list = document.createElement('div');
    list.className = 'file-pills';
    list.append(...documents.map(filePill));
    container.append(list);
  }
  return container;
}

interface PendingFile {
  file: File;
  state: 'waiting' | 'uploading' | 'ready' | 'failed';
  attachment?: Attachment;
  error?: string;
  preview?: string;
  controller?: AbortController;
  view?: {
    row: HTMLElement;
    status: HTMLElement;
    retry: HTMLButtonElement;
    remove: HTMLButtonElement;
  };
}

export class PendingFiles {
  private readonly chats = new Map<string, PendingFile[]>();
  private readonly errors = new Map<string, string>();
  private readonly errorNotice = document.createElement('p');
  private readonly scroller = document.createElement('div');
  private active = 0;
  private chat = 'main';
  private busy = false;
  constructor(
    private readonly container: HTMLElement,
    private readonly changed: () => void,
  ) {
    this.scroller.className = 'pending-files-row';
    this.container.append(this.scroller);
    this.scroller.addEventListener('scroll', () => this.updateFades());
    new ResizeObserver(() => this.updateFades()).observe(this.scroller);
  }
  private updateFades() {
    const remaining =
      this.scroller.scrollWidth -
      this.scroller.clientWidth -
      this.scroller.scrollLeft;
    this.scroller.style.setProperty(
      '--fade-left',
      `${Math.min(20, Math.max(0, this.scroller.scrollLeft))}px`,
    );
    this.scroller.style.setProperty(
      '--fade-right',
      `${Math.min(20, Math.max(0, remaining))}px`,
    );
  }
  private entries(chat = this.chat) {
    return this.chats.get(chat) ?? [];
  }
  get attachments() {
    return this.entries().flatMap((entry) =>
      entry.attachment ? [entry.attachment] : [],
    );
  }
  get blocked() {
    return this.entries().some((entry) => entry.state !== 'ready');
  }
  get count() {
    return this.entries().length;
  }
  setChat(chat: string) {
    if (chat !== this.chat) this.scroller.scrollLeft = 0;
    this.chat = chat;
    this.render();
  }
  setBusy(busy: boolean) {
    this.busy = busy;
    for (const button of this.container.querySelectorAll('button'))
      button.disabled = busy;
  }
  add(files: File[]) {
    if (this.busy) return;
    const entries = this.entries();
    if (entries.length + files.length > 100) {
      this.errors.set(this.chat, 'A message can contain at most 100 files.');
      this.render();
      return;
    }
    this.errors.delete(this.chat);
    for (const file of files) {
      const tooLarge = file.size > 25_000_000;
      entries.push({
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
    this.chats.set(this.chat, entries);
    this.render();
    this.changed();
    this.pump();
  }
  clear(chat: string) {
    for (const entry of this.entries(chat)) {
      entry.controller?.abort();
      if (entry.preview) URL.revokeObjectURL(entry.preview);
    }
    this.chats.delete(chat);
    this.errors.delete(chat);
    if (chat === this.chat) {
      this.render();
    }
    this.changed();
  }
  private pump() {
    while (this.active < 3) {
      const entry = [...this.chats.values()]
        .flat()
        .find((entry) => entry.state === 'waiting');
      if (!entry) return;
      entry.state = 'uploading';
      entry.controller = new AbortController();
      this.active++;
      void uploadFile(entry.file, entry.controller.signal)
        .then(({ attachment }) => {
          entry.attachment = attachment;
          entry.state = 'ready';
        })
        .catch((error: unknown) => {
          entry.state = 'failed';
          entry.error =
            error instanceof Error ? error.message : 'Upload failed';
        })
        .finally(() => {
          this.active--;
          this.render();
          this.changed();
          this.pump();
        });
    }
    this.render();
  }
  private createView(entry: PendingFile) {
    const chat = this.chat;
    const row = document.createElement('div');
    row.className = 'pending-file';
    if (entry.preview) {
      const img = document.createElement('img');
      img.src = entry.preview;
      img.alt = '';
      row.append(img);
    }
    const text = document.createElement('span');
    text.className = 'pending-file-details';
    const name = document.createElement('strong');
    name.textContent = entry.file.name;
    name.title = entry.file.name;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    text.append(name, status);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.setAttribute('aria-label', `Retry upload ${entry.file.name}`);
    retry.addEventListener('click', () => {
      entry.state = 'waiting';
      entry.error = undefined;
      this.render();
      this.changed();
      this.pump();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
    remove.addEventListener('click', () => {
      entry.controller?.abort();
      if (entry.preview) URL.revokeObjectURL(entry.preview);
      this.chats.set(
        chat,
        this.entries(chat).filter((item) => item !== entry),
      );
      this.errors.delete(chat);
      this.render();
      this.changed();
    });
    row.append(text, retry, remove);
    return { row, status, retry, remove };
  }
  private render() {
    const entries = this.entries();
    const error = this.errors.get(this.chat);
    this.container.hidden = !entries.length && !error;
    this.scroller.hidden = !entries.length;
    if (error) {
      this.errorNotice.textContent = error;
      this.errorNotice.setAttribute('role', 'alert');
      if (this.errorNotice.parentNode !== this.container)
        this.container.prepend(this.errorNotice);
    } else this.errorNotice.remove();
    const rows = new Set<HTMLElement>();
    for (const entry of entries) {
      const view = (entry.view ??= this.createView(entry));
      view.row.dataset.state = entry.state;
      view.status.textContent =
        entry.error ?? (entry.state === 'ready' ? 'Ready' : 'Uploading…');
      view.status.title = view.status.textContent;
      view.retry.hidden =
        entry.state !== 'failed' || entry.file.size > 25_000_000;
      view.retry.disabled = this.busy;
      view.remove.disabled = this.busy;
      rows.add(view.row);
    }
    for (const node of Array.from(this.scroller.children))
      if (!rows.has(node as HTMLElement)) node.remove();
    for (const row of rows)
      if (row.parentNode !== this.scroller) this.scroller.append(row);
    this.updateFades();
  }
}
