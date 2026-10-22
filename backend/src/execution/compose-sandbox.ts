import Docker from 'dockerode';
import { DockerSandbox } from '@mastra/docker';
import type {
  SandboxComputer,
  SandboxInfo,
  SandboxFileInput,
  WriteFilesOptions,
} from '@mastra/core/workspace';

/** Compose owns provisioning; Mastra owns command execution and process streams. */
export class ComposeSandbox extends DockerSandbox {
  private attached?: Docker.Container;
  private readonly createdAt = new Date();
  override readonly computer?: SandboxComputer;
  private readonly client = new Docker();

  constructor(
    id: string,
    workingDirectory: string,
    computer?: SandboxComputer,
  ) {
    super({
      id,
      workingDirectory,
      instructions:
        'Commands run in the shared persistent Debian desktop. Agent home is /home/pal. HTTP(S) internet access uses the configured proxy; private service networks are unavailable.',
    });
    this.computer = computer;
    // Compose-attached containers use the configured cwd for native spawns.
    const spawn = this.processes.spawn.bind(this.processes);
    this.processes.spawn = (command, options) =>
      spawn(command, { cwd: this.workingDirectory, ...options });
  }

  override get container() {
    if (!this.attached) throw new Error('Execution container is unavailable');
    return this.attached;
  }

  override async start() {
    await this.attach();
  }

  private async attach() {
    const matches = await this.client.listContainers({
      filters: { label: [`mastra.sandbox.id=${this.id}`] },
    });
    if (matches.length !== 1) {
      this.attached = undefined;
      this.status = 'error';
      throw new Error('Expected one running Compose execution container');
    }
    this.attached = this.client.getContainer(matches[0].Id);
    this.processes.setContainer(this.attached);
  }

  override async ensureRunning() {
    // Mastra wraps start() and caches running state; resolve replacement IDs directly.
    if (this.status === 'running') await this.attach();
    else await super.ensureRunning();
  }

  override async writeFiles(
    files: SandboxFileInput[],
    options?: WriteFilesOptions,
  ) {
    await this.ensureRunning();
    return super.writeFiles(files, options);
  }

  override async getInfo(): Promise<SandboxInfo> {
    const info = this.attached
      ? await this.attached.inspect().catch(() => {
          this.attached = undefined;
          this.status = 'error';
          return undefined;
        })
      : undefined;
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      status: this.status,
      createdAt: info ? new Date(info.Created) : this.createdAt,
      metadata: {
        workingDir: this.workingDirectory,
        ...(info ? { containerId: info.Id, image: info.Config.Image } : {}),
      },
    };
  }

  override async stop() {
    // Individual calls carry abort signals. Never stop a shared desktop here.
    this.processes.reset();
    this.attached = undefined;
  }

  override destroy() {
    return this.stop();
  }
}
