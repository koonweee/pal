import type { SandboxComputer } from '@mastra/core/workspace';
import {
  ExecutionUnavailableError,
  type ExecutionService,
} from '../execution/execution.service.js';

const aliases: Record<string, string> = {
  ctrl: 'Control_L',
  control: 'Control_L',
  alt: 'Alt_L',
  shift: 'Shift_L',
  meta: 'Super_L',
  super: 'Super_L',
  win: 'Super_L',
  enter: 'Return',
  return: 'Return',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'BackSpace',
  delete: 'Delete',
  tab: 'Tab',
  space: 'space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'Prior',
  pagedown: 'Next',
  home: 'Home',
  end: 'End',
  ' ': 'space',
  '+': 'plus',
  '-': 'minus',
  '.': 'period',
  '/': 'slash',
};

export class X11Computer implements SandboxComputer {
  constructor(
    private readonly execution: Pick<ExecutionService, 'run'>,
    private readonly viewerUrl?: string,
    private readonly uncertain?: () => void,
  ) {}

  private async run(
    command: string,
    args: string[],
    input?: string,
    mutates = true,
  ): Promise<Buffer> {
    // Drain dispatched subprocesses even when the worker is cancelled. The
    // coordinator holds the turn until this bounded operation settles.
    let result;
    try {
      // Keep settlement local to execution even if the backend dies. Inherited
      // flock ownership survives the client; timeout bounds orphaned input.
      result = await this.execution.run(
        'flock',
        [
          '--exclusive',
          '--wait',
          '35',
          '/home/pal/tmp/pal-desktop-input.lock',
          'timeout',
          '--kill-after=2s',
          '30s',
          command,
          ...args,
        ],
        { input, timeout: 70_000 },
      );
    } catch (error) {
      if (mutates && !(error instanceof ExecutionUnavailableError))
        this.uncertain?.();
      throw error;
    }
    if (
      mutates &&
      (result.timedOut || result.killed || [124, 137].includes(result.exitCode))
    )
      this.uncertain?.();
    if (!result.success)
      throw new Error('Desktop operation failed or could not be confirmed');
    return Buffer.from(result.stdout);
  }

  private xdo(...args: string[]) {
    return this.run(
      'xdotool',
      args,
      undefined,
      !['getdisplaygeometry', 'getmouselocation'].includes(args[0]),
    );
  }

  async screenshot() {
    const encoded = await this.run(
      'python3',
      [
        '-c',
        "import os,io,base64; from PIL import ImageGrab; data=io.BytesIO(); ImageGrab.grab(xdisplay=os.environ['DISPLAY']).save(data, format='PNG'); print(base64.b64encode(data.getvalue()).decode())",
      ],
      undefined,
      false,
    );
    return {
      data: Buffer.from(encoded.toString().trim(), 'base64'),
      mediaType: 'image/png' as const,
    };
  }

  async moveMouse(x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0)
      throw new Error('Desktop coordinates must be nonnegative integers');
    await this.xdo('mousemove', '--sync', String(x), String(y));
  }

  private async click(x: number, y: number, button: string, count = '1') {
    await this.moveMouse(x, y);
    await this.xdo(
      'click',
      '--clearmodifiers',
      '--repeat',
      count,
      '--delay',
      '100',
      button,
    );
  }

  leftClick(x: number, y: number) {
    return this.click(x, y, '1');
  }
  rightClick(x: number, y: number) {
    return this.click(x, y, '3');
  }
  doubleClick(x: number, y: number) {
    return this.click(x, y, '1', '2');
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await this.moveMouse(from.x, from.y);
    try {
      await this.xdo('mousedown', '1');
      await this.moveMouse(to.x, to.y);
    } finally {
      await this.xdo('mouseup', '1');
    }
  }

  async scroll(direction: 'up' | 'down', amount: number) {
    if (
      !['up', 'down'].includes(direction) ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 1000
    )
      throw new Error('Scroll requires up/down and 1–1000 ticks');
    await this.xdo(
      'click',
      '--clearmodifiers',
      '--repeat',
      String(amount),
      '--delay',
      '10',
      direction === 'up' ? '4' : '5',
    );
  }

  async type(text: string) {
    // X11 clients need time to process temporary keymap changes for Unicode.
    // Bound each subprocess while allowing longer text through small chunks.
    for (const chunk of text.match(/[\s\S]{1,256}/gu) ?? []) {
      const delay = Array.from(chunk).some(
        (character) => character.charCodeAt(0) > 127,
      )
        ? '50'
        : '1';
      await this.run(
        'xdotool',
        ['type', '--clearmodifiers', '--delay', delay, '--file', '-'],
        chunk,
      );
    }
  }

  async press(key: string | string[]) {
    const chord = Array.isArray(key) && key.length > 1;
    const keys = (Array.isArray(key) ? key : [key]).map(
      (name) =>
        aliases[name.toLowerCase()] ??
        // Tool chords name physical keys. Uppercase must not imply Shift:
        // CTRL+T opens a tab; CTRL+SHIFT+T explicitly restores a closed tab.
        (chord && /^[a-z]$/i.test(name) ? name.toLowerCase() : name),
    );
    if (!keys.length || keys.some((name) => !/^[a-zA-Z0-9_]+$/.test(name)))
      throw new Error('Use X11 key names or an array of keys for a chord');
    try {
      await this.xdo('key', '--clearmodifiers', keys.join('+'));
    } finally {
      await this.xdo('keyup', ...keys);
    }
  }

  async getScreenSize() {
    const [width, height] = (await this.xdo('getdisplaygeometry'))
      .toString()
      .trim()
      .split(/\s+/)
      .map(Number);
    if (!width || !height) throw new Error('Invalid X11 display dimensions');
    return { width, height };
  }

  async getCursorPosition() {
    const value = (await this.xdo('getmouselocation', '--shell')).toString();
    const x = Number(/^X=(\d+)$/m.exec(value)?.[1]);
    const y = Number(/^Y=(\d+)$/m.exec(value)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('Invalid X11 pointer position');
    return { x, y };
  }

  streamUrl() {
    return Promise.resolve(this.viewerUrl ?? null);
  }
}
