import { LoginService } from '../login/login.service.js';
import { loginTools } from '../login/login-tools.js';
import { webSearchTool } from './web-search.js';
import {
  isMastraSignalMessage,
  mastraDBMessageToSignal,
  type MastraDBMessage,
} from '@mastra/core/agent';
import { DestinationService } from '../delivery/destination.service.js';
import { sendToUserTool } from './send-to-user.tool.js';
import { loadAgentInstructions } from './agent-instructions.js';
import { resolve } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { ConfigService } from '@nestjs/config';
import { McpService } from '../mcp/mcp.service.js';
import { AgentAdmissionService } from '../mcp/agent-admission.service.js';
import {
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import type { MastraModelOutput } from '@mastra/core/stream';
import { ChatService } from '../chat/chat.service.js';
import { TaskSchedulesService } from '../tasks/task-schedules.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { FilesService } from '../files/files.service.js';
import { inspectMessageTool } from './file-tools.js';
import type { PublishMessage, UserVisibleMessage } from '../chat/chat.types.js';
import { messageVisibleInChat } from '../chat/chat.types.js';
import { AgentHandoffError, type AgentRuntime } from './agent-runtime.js';
import { AgentActivityService } from './agent-activity.service.js';
import { TaskToolDiscoveryProcessor } from './task-tool-discovery.processor.js';
import { CodeModeProcessor } from './code-mode.processor.js';
import { chatgptModel } from './chatgpt-model.js';
import { BrowserService } from '../browser/browser.service.js';
import { PreferencesService } from '../preferences/preferences.service.js';
import { InstanceSettingsService } from '../instance-settings/instance-settings.service.js';
import {
  mainPreferenceActor,
  preferenceReadTool,
  preferenceWriteTool,
  taskPreferenceActor,
} from '../preferences/preference-tools.js';
import { browserTools } from '../browser/browser-tools.js';
import { ExecutionService } from '../execution/execution.service.js';
import { X11Computer } from './x11-computer.js';
import { createMainSession, MAIN_RESOURCE_ID } from './main-session.js';
import type { TextContext } from './publish-text.processor.js';
import {
  AttachmentDeliveryError,
  type GeneratedFile,
  type PublicOutput,
} from './public-output.js';
import { publicOutputOptions } from './public-output.js';
import {
  mainTaskTools,
  taskStatusTool,
  taskUpdateTool,
  taskScheduleTools,
  taskThreadId,
  taskIdFromThread,
  TASK_THREAD_PREFIX,
  type DelegationInput,
} from './task-tools.js';

interface TaskProvenance {
  origins: { messageRef: number; destinationId: string | null }[];
  scheduleIds: string[];
}

@Injectable()
export class MastraAgentRuntime
  implements AgentRuntime, OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(MastraAgentRuntime.name);
  private main?: Awaited<ReturnType<typeof createMainSession>>;
  private closing = false;
  private generationFailed = false;
  private readonly publications = new Set<Promise<void>>();
  private readonly taskRuns = new Set<Promise<void>>();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(AgentActivityService)
    private readonly activity: AgentActivityService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(TaskSchedulesService)
    private readonly schedules: TaskSchedulesService,
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(AgentAdmissionService)
    private readonly admission: AgentAdmissionService,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(LoginService) private readonly login: LoginService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(PreferencesService)
    private readonly preferences: PreferencesService,
    @Inject(DestinationService)
    private readonly destinations: DestinationService,
    @Inject(InstanceSettingsService)
    private readonly instanceSettings: InstanceSettingsService,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
  ) {}

  async onModuleInit() {
    this.login.bindNotifier((taskId, text) =>
      this.sendTask(taskId, text, false),
    );
    this.browser.bindActiveTasks(() =>
      (this.main?.taskAgent?.listActiveThreadRuns() ?? [])
        .filter((run) => run.threadId.startsWith(TASK_THREAD_PREFIX))
        .map((run) => taskIdFromThread(run.threadId)),
    );
    this.admission.bind(
      () =>
        this.closing ||
        !!this.main?.session.stream.isActive() ||
        !!this.main?.taskAgent?.listActiveThreadRuns().length ||
        this.taskRuns.size > 0,
    );
    await this.mcp.loadAtStartup();
    const [taskInstructions, workerInstructions] = await Promise.all([
      loadAgentInstructions('task'),
      loadAgentInstructions('worker'),
    ]);
    this.main = await createMainSession({
      mainContext: async () => {
        const [name, destinations] = await Promise.all([
          this.agentNameInstruction(),
          this.destinations.list(),
        ]);
        return (
          name +
          '\nEnabled additional channels: ' +
          JSON.stringify(
            destinations
              .filter((destination) => destination.role === 'secondary')
              .map(({ id, adapterId }) => ({ id, adapterId })),
          ) +
          '\nCurrent time (UTC): ' +
          new Date().toISOString()
        );
      },
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      workingDirectory: this.execution.home,
      sandbox: this.execution.sandbox,
      filesystem: this.execution.filesystem,
      computer: this.config.get<boolean>('PAL_DESKTOP_ENABLED')
        ? new X11Computer(
            this.execution,
            this.config.get<string>('PAL_DESKTOP_VIEWER_URL'),
          )
        : undefined,
      model: chatgptModel(
        this.config.getOrThrow<string>('PAL_AGENT_MODEL'),
        this.config.getOrThrow<string>('PAL_AGENT_AUTH_PATH'),
        this.config.getOrThrow<string>('PAL_AGENT_THINKING_EFFORT'),
      ),
      // Keep Main's tool set focused on routing to preserve fast acknowledgments.
      tools: {
        sendToUser: sendToUserTool(
          (output, { destinationIds, notify }, key, request) =>
            this.publishMessage(
              {
                role: 'assistant',
                text: output.text,
                suggestedReplies: output.suggestedReplies,
                replyToSequence: output.replyTo,
                attachmentIds: output.attachmentIds,
                destinationIds,
                notify,
              },
              output.files,
              key,
              request,
            ),
          (input, key) => this.chat.react(input, key),
        ),
        ...mainTaskTools(
          this.tasks,
          this.chat,
          (input) => this.delegate(input),
          this.files,
        ),
        inspect_message: inspectMessageTool(this.files, this.chat),
        read_preferences: preferenceReadTool(this.preferences),
        update_preference: preferenceWriteTool(
          this.preferences,
          mainPreferenceActor,
        ),
      },
      task: {
        instructions: async ({ requestContext }) => {
          const id = taskIdFromThread(requestContext.get(MASTRA_THREAD_ID_KEY));
          const [task, history, name] = await Promise.all([
            this.tasks.details(id),
            this.chat.history({ taskId: id, limit: 15 }),
            this.agentNameInstruction(),
          ]);
          return (
            taskInstructions +
            '\n' +
            name +
            '\n' +
            this.mcp.instructions() +
            '\nCurrent time (UTC): ' +
            new Date().toISOString() +
            '\nTask: ' +
            JSON.stringify({
              id,
              title: task.title,
              goal: task.goal,
              description: task.description,
              status: task.status,
            }) +
            '\nRecent public messages (for reply references): ' +
            JSON.stringify(
              history.messages.reverse().map((message) => ({
                ref: message.sequence,
                role: message.role,
                text: message.text.slice(0, 120),
              })),
            )
          );
        },
        // Broad task primitives are always available here; Mastra adds workspace tools.
        tools: () => ({
          web_search: webSearchTool(),
          inspect_message: inspectMessageTool(this.files, this.chat),
          set_task_status: taskStatusTool(this.tasks),
          update_task: taskUpdateTool(this.tasks),
          ...taskScheduleTools(this.schedules),
          read_preferences: preferenceReadTool(this.preferences),
          update_preference: preferenceWriteTool(
            this.preferences,
            taskPreferenceActor,
          ),
        }),
        // Service-specific capabilities enter through the searchable MCP catalog.
        // Placement guidance: architecture/backend.md#connected-services-mcp.
        inputProcessors: [
          new TaskToolDiscoveryProcessor(() => this.mcp.tools()),
        ],
        worker: {
          model: chatgptModel(
            'gpt-6-luna',
            this.config.getOrThrow<string>('PAL_AGENT_AUTH_PATH'),
            'high',
          ),
          instructions: () =>
            workerInstructions +
            '\nCurrent time (UTC): ' +
            new Date().toISOString(),
          tools: () => ({
            ...browserTools(this.browser),
            ...loginTools(this.login),
          }),
          inputProcessors: [new CodeModeProcessor()],
          resume: (taskId, assignment) =>
            this.login.resumeWorker(taskId, assignment),
          cleanup: async (taskId, workerId, completed, startedAt) => {
            const retain = await this.login
              .retainWorkerSession(taskId, workerId, completed, startedAt)
              .catch((error: unknown) => {
                this.logger.warn(error);
                return false;
              });
            if (retain) return;
            await this.browser
              .closeSession(taskId, workerId)
              .catch((error: unknown) => this.logger.warn(error));
          },
        },
        publish: (output, context) => this.publishTask(output, context),
      },
      onTaskActivity: (runId, working, threadId, interrupted) =>
        this.activity.setRunWorking(
          runId,
          working,
          threadId ? taskIdFromThread(threadId) : undefined,
          interrupted,
        ),
      onTaskError: async (threadId) => {
        if (!this.closing)
          await this.publishFailure(
            'I could not complete that scheduled check.',
            taskIdFromThread(threadId),
          );
      },
      scheduleHooks: {
        prepare: async ({ schedule, trigger }) => {
          if (this.closing) return null;
          await this.admission.prepareSchedule(
            schedule.id + ':' + trigger.firedAt.toISOString(),
          );
          return this.closing ? null : undefined;
        },
        onFinish: ({ schedule, trigger }) =>
          this.admission.finishSchedule(
            schedule.id + ':' + trigger.firedAt.toISOString(),
          ),
        onAbort: ({ schedule, trigger }) =>
          this.admission.finishSchedule(
            schedule.id + ':' + trigger.firedAt.toISOString(),
          ),
        onError: async ({ schedule, trigger }) => {
          this.admission.finishSchedule(
            schedule.id + ':' + trigger.firedAt.toISOString(),
          );
          if (!this.closing && typeof schedule.threadId === 'string') {
            this.logger.error('Scheduled task dispatch failed');
            await this.publishFailure(
              'I could not start that scheduled check.',
              taskIdFromThread(schedule.threadId),
              schedule.id,
            );
          }
        },
      },
      onEvent: (event) => {
        if (event.type === 'agent_start') {
          this.generationFailed = false;
          this.activity.setWorking(true);
        }
        if (event.type === 'error') this.generationFailed = true;
        if (event.type === 'agent_end') {
          this.activity.setWorking(false);
          if (
            (event.reason === 'error' || this.generationFailed) &&
            !this.closing
          ) {
            this.logger.error('Main generation failed');
          }
        }
      },
    });
    await this.schedules.bind(this.main.mastra);
    await this.main.mastra.startWorkers();
  }

  private async agentNameInstruction() {
    return `Your name is ${(await this.instanceSettings.get()).agentName}.`;
  }

  async submit(message: UserVisibleMessage) {
    return this.admission.dispatch(async () => {
      try {
        await this.submitAdmitted(message);
      } catch (error) {
        if (error instanceof AgentHandoffError) throw error;
        throw new AgentHandoffError(false, 'Input preparation failed');
      }
    });
  }

  private async submitAdmitted(message: UserVisibleMessage) {
    if (this.closing || !this.main)
      throw new AgentHandoffError(false, 'Main is unavailable');
    const references = await this.chat.history({
      taskId: message.taskId ?? undefined,
      limit: 20,
    });
    const recentMessages = JSON.stringify(
      references.messages.reverse().map((entry) => ({
        ref: entry.sequence,
        role: entry.role,
        text: entry.text.slice(0, 120),
      })),
    );
    const quoted = message.replyToMessageId
      ? await this.chat.get(message.replyToMessageId)
      : null;
    let contents = quoted
      ? `Quoted earlier ${quoted.role} message #${quoted.sequence}: ${JSON.stringify(quoted.text)}\nCurrent user message #${message.sequence}: ${message.text}`
      : message.text;
    if (quoted?.attachments.length)
      contents +=
        '\nQuoted attachments (user-provided files): ' +
        JSON.stringify(
          await this.files.manifest(quoted.attachments.map((file) => file.id)),
        );
    if (message.attachments.length)
      contents +=
        '\nAttachments (user-provided files): ' +
        JSON.stringify(
          await this.files.manifest(message.attachments.map((file) => file.id)),
        );
    const attributes = {
      ...message.metadata,
      originDestinationId: message.originDestinationId,
      messageRef: message.sequence,
      recentMessages,
      ...(quoted ? { replyToRef: quoted.sequence } : {}),
    };
    if (message.taskId) {
      await this.tasks.details(message.taskId);
      await this.sendTask(message.taskId, contents, true, attributes);
    } else {
      try {
        await this.main.session.sendSignal(
          {
            type: 'user',
            contents,
            attributes,
          },
          { requireDelivery: true },
        ).accepted;
      } catch {
        throw new AgentHandoffError(
          true,
          'Main acceptance could not be confirmed',
        );
      }
    }
  }

  async delegate(input: DelegationInput) {
    return this.admission.dispatch(() => this.delegateAdmitted(input));
  }

  private async delegateAdmitted(input: DelegationInput) {
    if (this.closing || !this.main)
      throw new Error('Agent runtime is unavailable');
    if (!input.message.trim())
      throw new ApplicationError('invalid_input', 'Task message is required');
    const sources: UserVisibleMessage[] = [];
    for (const ref of input.sourceMessageRefs ?? []) {
      const source = await this.chat.getBySequence(ref);
      if (!source || !messageVisibleInChat(source, null))
        throw new ApplicationError(
          'invalid_input',
          'Source message is not in Main chat',
        );
      sources.push(source);
    }
    const attachmentIds = [
      ...new Set([
        ...(sources[0]?.attachments.map((file) => file.id) ?? []),
        ...(input.attachmentIds ?? []),
      ]),
    ];
    const manifest = await this.files.manifest(attachmentIds);
    const task = input.taskId
      ? await this.tasks.details(input.taskId)
      : await this.tasks.create({
          title: input.title ?? '',
          goal: input.goal ?? '',
          description: input.message,
        });
    const text = manifest.length
      ? input.message +
        '\nAttachments (user-provided files): ' +
        JSON.stringify(manifest)
      : input.message;
    try {
      await this.sendTask(
        task.id,
        sources[0]
          ? `${text}\nSource ${sources[0].role} message #${sources[0].sequence}: ${JSON.stringify(sources[0].text)}`
          : text,
        false,
        {
          sourceMessageRefs: JSON.stringify(
            sources.map((source) => source.sequence),
          ),
          origins: JSON.stringify(
            sources.map((source) => ({
              messageRef: source.sequence,
              destinationId: source.originDestinationId,
            })),
          ),
        },
      );
    } catch {
      this.logger.error('Task delegation handoff failed');
      throw new Error(
        'Task agent could not accept the message. The task record was retained.',
      );
    }
    return { taskId: task.id };
  }

  private async sendTask(
    taskId: string,
    text: string,
    userAuthored: boolean,
    attributes: Record<string, string | number | boolean | null> = {},
  ) {
    const agent = this.main?.taskAgent;
    if (this.closing || !agent) throw new Error('Task agent is unavailable');
    const threadId = taskThreadId(taskId);
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    const target = {
      resourceId: MAIN_RESOURCE_ID,
      threadId,
      ifIdle: {
        attributes: { executionStart: true },
        streamOptions: {
          requestContext,
          structuredOutput: publicOutputOptions,
        },
      },
    };
    const delivery = userAuthored
      ? agent.sendMessage({ contents: text, attributes }, target)
      : agent.sendSignal(
          {
            type: 'reactive',
            tagName: 'delegation',
            contents: text,
            attributes,
          },
          target,
        );
    let accepted: Awaited<typeof delivery.accepted>;
    try {
      accepted = await delivery.accepted;
    } catch {
      throw new AgentHandoffError(
        true,
        'Task acceptance could not be confirmed',
      );
    }
    if (accepted.action !== 'wake' && accepted.action !== 'deliver')
      throw new Error('Task input was not accepted');
    if (accepted.action === 'wake') {
      this.activity.setRunWorking(accepted.runId, true, taskId);
      const run = this.consumeTask(
        accepted.output,
        taskId,
        accepted.runId,
      ).finally(() => this.taskRuns.delete(run));
      this.taskRuns.add(run);
    }
  }

  private async consumeTask(
    output: MastraModelOutput<unknown>,
    taskId: string,
    runId: string,
  ) {
    let failed = false;
    let interrupted = false;
    try {
      for await (const part of output.fullStream) {
        if (part.type === 'error') failed = true;
        if (part.type === 'abort') interrupted = true;
      }
      if (failed) throw new Error('Task generation failed');
    } catch {
      failed = true;
      if (!this.closing) {
        this.logger.error('Task generation failed');
        await this.publishFailure(
          'I could not complete that response. Please send your message again.',
          taskId,
        );
      }
    } finally {
      this.activity.setRunWorking(runId, false, taskId, failed || interrupted);
    }
  }

  private publishFailure(text: string, taskId: string, scheduleId?: string) {
    return this.publishTask(
      { text, replyTo: null, attachmentIds: [], files: [] },
      { threadId: taskThreadId(taskId), phase: 'final_answer' },
      scheduleId ? { origins: [], scheduleIds: [scheduleId] } : undefined,
    );
  }

  // The native idle-wake marker bounds provenance; canonical messages own origins.
  private async taskSources(
    taskId: string,
    currentMessages: MastraDBMessage[] = [],
  ): Promise<TaskProvenance> {
    const store = await this.main?.storage.getStore('memory');
    if (!store) return { origins: [], scheduleIds: [] };
    const refs = new Set<number>();
    const scheduleIds = new Set<string>();
    let executionStart = false;
    // Streaming finals can precede native input persistence. Prefer the live list;
    // compressed context can recover the same boundary from native storage.
    const batches = async function* () {
      yield currentMessages.toReversed();
      for (let page = 0; ; page++) {
        const result = await store.listMessages({
          threadId: taskThreadId(taskId),
          perPage: 100,
          page,
          orderBy: { field: 'createdAt', direction: 'DESC' },
          includeTotal: false,
        });
        yield result.messages;
        if (!result.hasMore) break;
      }
    };
    for await (const messages of batches()) {
      for (const message of messages) {
        if (!isMastraSignalMessage(message)) continue;
        const signal = mastraDBMessageToSignal(message);
        const attributes = signal.attributes;
        if (
          signal.tagName === 'scheduled-execution' &&
          typeof attributes?.scheduleId === 'string'
        )
          scheduleIds.add(attributes.scheduleId);
        if (
          signal.type === 'user' &&
          typeof attributes?.messageRef === 'number'
        )
          refs.add(attributes.messageRef);
        if (
          signal.tagName === 'delegation' &&
          typeof attributes?.sourceMessageRefs === 'string'
        ) {
          const selected: unknown = JSON.parse(attributes.sourceMessageRefs);
          if (Array.isArray(selected))
            for (const ref of selected)
              if (Number.isSafeInteger(ref) && ref > 0) refs.add(ref);
        }
        if (attributes?.executionStart === true) {
          executionStart = true;
          break;
        }
      }
      if (executionStart) break;
    }
    if (!executionStart) return { origins: [], scheduleIds: [] };
    const messages = await Promise.all(
      [...refs].map((ref) => this.chat.getBySequence(ref)),
    );
    const origins = messages.flatMap((message) =>
      message
        ? [
            {
              messageRef: message.sequence,
              destinationId: message.originDestinationId,
            },
          ]
        : [],
    );
    return { origins, scheduleIds: [...scheduleIds] };
  }

  private publishTask(
    output: PublicOutput,
    context: TextContext,
    provenance?: TaskProvenance,
  ): Promise<void> {
    return this.trackPublication(async () => {
      const taskId = taskIdFromThread(context.threadId);
      const final = context.phase === 'final_answer';
      const message = await this.publishMessage(
        {
          role: 'assistant',
          text: output.text,
          suggestedReplies: output.suggestedReplies,
          taskId,
          phase: context.phase ?? null,
          replyToSequence: output.replyTo,
          attachmentIds: output.attachmentIds,
        },
        output.files,
      );
      if (context.phase === 'commentary' && context.runId) {
        this.activity.commentary(context.runId, taskId, {
          messageId: message.id,
          sequence: message.sequence,
          text: message.text,
        });
      }
      if (final && this.main && !this.closing) {
        try {
          const sources =
            provenance ?? (await this.taskSources(taskId, context.messages));
          const delivery = this.main.session.sendSignal(
            {
              type: 'reactive',
              tagName: 'task-result',
              attributes: {
                taskId,
                messageId: message.id,
                messageRef: message.sequence,
                origins: JSON.stringify(sources.origins),
                ...(sources.scheduleIds.length
                  ? { scheduleIds: JSON.stringify(sources.scheduleIds) }
                  : {}),
                ...(message.replyTo
                  ? { replyToRef: message.replyTo.sequence }
                  : {}),
              },
              contents:
                `Task outcome #${message.sequence}:\n` +
                message.text +
                (message.attachments.length
                  ? '\nAttachments: ' +
                    JSON.stringify(
                      await this.files.manifest(
                        message.attachments.map((file) => file.id),
                      ),
                    )
                  : ''),
            },
            {
              requireDelivery: true,
            },
          );
          await delivery.accepted;
        } catch {
          this.logger.error('Task result delivery to Main failed');
        }
      }
    });
  }

  private async publishMessage(
    input: PublishMessage,
    generatedFiles: GeneratedFile[] = [],
    key?: string,
    request?: Record<string, unknown>,
  ) {
    const attachmentIds = [...(input.attachmentIds ?? [])];
    try {
      if (generatedFiles.length) {
        await this.files.manifest(attachmentIds);
        for (const file of generatedFiles) {
          const attachment = await this.files.importFile({
            ...file,
            path: resolve(
              this.config.getOrThrow<string>('PAL_AGENT_WORKING_DIR'),
              file.path,
            ),
          });
          attachmentIds.push(attachment.id);
        }
      }
      return await this.chat.publish({ ...input, attachmentIds }, key, request);
    } catch (error) {
      if (
        (attachmentIds.length || generatedFiles.length) &&
        error instanceof ApplicationError
      )
        throw new AttachmentDeliveryError(error.message, {
          text: input.text,
          replyTo: input.replyToSequence ?? null,
        });
      throw error;
    }
  }

  private trackPublication(work: () => Promise<void>): Promise<void> {
    if (this.closing) return Promise.resolve();
    const publication = work()
      .catch((error: unknown) => {
        if (error instanceof AttachmentDeliveryError) throw error;
        this.logger.error('Agent text publication failed');
      })
      .finally(() => this.publications.delete(publication));
    this.publications.add(publication);
    return publication;
  }

  async beforeApplicationShutdown() {
    if (this.closing) return;
    this.closing = true;
    const stopping = this.main?.mastra.stopWorkers();
    const agent = this.main?.taskAgent;
    for (const run of agent?.listActiveThreadRuns() ?? [])
      if (run.threadId.startsWith(TASK_THREAD_PREFIX))
        agent!.abortRunStream(run.runId);
    await stopping;
    await Promise.all(this.taskRuns);
    await this.main?.close();
    await this.browser.shutdown();
    await Promise.all(this.publications);
    this.activity.reset();
  }
}
