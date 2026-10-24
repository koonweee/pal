import { loadAgentInstructions } from './agent-instructions.js';
import { agentSkillPaths } from './agent-skills.js';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { Mastra } from '@mastra/core/mastra';
import type { ScheduleHooks } from '@mastra/core/schedules';
import { noopLogger } from '@mastra/core/logger';
import { Agent, type ToolsInput } from '@mastra/core/agent';
import {
  AgentController,
  type AgentControllerEvent,
} from '@mastra/core/agent-controller';
import { Memory } from '@mastra/memory';
import type { MemoryConfig } from '@mastra/core/memory';
import { PostgresStore } from '@mastra/pg';
import {
  Workspace,
  WORKSPACE_TOOLS,
  type SandboxComputer,
  type WorkspaceSandbox,
  type WorkspaceFilesystem,
} from '@mastra/core/workspace';
import { MAX_FILE_BYTES } from '../files/application-file-storage.js';
import { taskWorkerDelegation, WORKER_ID } from './task-workers.js';
import { TaskSchedulerWorker } from './task-scheduler.worker.js';
import {
  publishTextProcessor,
  type TextContext,
} from './publish-text.processor.js';
import {
  publicOutputOptions,
  type PublicOutput,
  type PublicResponse,
} from './public-output.js';

export const MAIN_RESOURCE_ID = 'pal-owner';
export const MAIN_THREAD_ID = 'pal-main';

export async function createMainSession(options: {
  connectionString: string;
  schemaName?: string;
  workingDirectory?: string;
  computer?: SandboxComputer;
  sandbox?: WorkspaceSandbox;
  filesystem?: WorkspaceFilesystem;
  model: Agent['model'];
  memoryOptions?: MemoryConfig;
  tools?: NonNullable<ConstructorParameters<typeof Agent>[0]['tools']>;
  task?: {
    instructions: ConstructorParameters<typeof Agent>[0]['instructions'];
    tools: NonNullable<ConstructorParameters<typeof Agent>[0]['tools']>;
    inputProcessors?: ConstructorParameters<typeof Agent>[0]['inputProcessors'];
    publish: (output: PublicOutput, context: TextContext) => Promise<void>;
    worker?: {
      model: Agent['model'];
      instructions: ConstructorParameters<typeof Agent>[0]['instructions'];
      tools: NonNullable<ConstructorParameters<typeof Agent>[0]['tools']>;
      inputProcessors?: ConstructorParameters<
        typeof Agent
      >[0]['inputProcessors'];
      resume?: (
        taskId: string,
        assignment: string,
      ) => Promise<string | undefined>;
      cleanup: (
        taskId: string,
        workerId: string,
        completed: boolean,
        startedAt: number,
      ) => Promise<void>;
    };
  };
  scheduleHooks?: ScheduleHooks<Mastra>;
  onTaskActivity?: (
    runId: string,
    working: boolean,
    threadId?: string,
    interrupted?: boolean,
  ) => void;
  onTaskError?: (threadId: string) => Promise<void>;
  mainContext?: () => Promise<string>;
  onEvent: (event: AgentControllerEvent) => void;
}) {
  const mainInstructions = await loadAgentInstructions('main');
  const workspace = options.workingDirectory
    ? new Workspace({
        id: 'pal-main-workspace',
        filesystem: options.filesystem,
        sandbox: options.sandbox,
        tools: {
          requireApproval: false,
          [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: {
            maxMediaBytes: MAX_FILE_BYTES,
          },
        },
      })
    : undefined;
  if (options.workingDirectory && (!options.sandbox || !options.filesystem))
    throw new Error('An execution sandbox is required for the agent workspace');
  if (options.sandbox && options.computer)
    Object.defineProperty(options.sandbox, 'computer', {
      value: options.computer,
      configurable: true,
    });
  const storage = new PostgresStore({
    id: 'pal-main-storage',
    connectionString: options.connectionString,
    schemaName: options.schemaName ?? 'mastra',
  });
  try {
    await storage.init();
    // Providers start lazily so history and chat remain available during desktop outages.
    const memory = new Memory({
      storage,
      options: options.memoryOptions ?? {
        lastMessages: 20,
        semanticRecall: false,
        workingMemory: { enabled: false },
        observationalMemory: {
          model: options.model,
          scope: 'thread',
          observation: {
            messageTokens: 12_000,
            bufferActivation: 3_000,
          },
          reflection: { observationTokens: 12_000 },
        },
      },
    });
    // Zero removes the runtime ceiling; stopWhen disables the default five-step stop.
    const unlimitedSteps = {
      maxSteps: 0,
      stopWhen: () => false,
    };
    const mainSteps = {
      ...unlimitedSteps,
      modelSettings: { headers: { 'session-id': MAIN_THREAD_ID } },
    };
    const withMainSessionHeader = <T extends { modelSettings?: unknown }>(
      options: T,
    ) => {
      const settings = options.modelSettings as
        { headers?: Record<string, string> } | undefined;
      return {
        ...options,
        ...mainSteps,
        modelSettings: {
          ...settings,
          headers: { ...settings?.headers, 'session-id': MAIN_THREAD_ID },
        },
      };
    };
    const agent = new Agent({
      id: 'pal-main-agent',
      name: 'Main',
      instructions: async () =>
        mainInstructions + '\n' + ((await options.mainContext?.()) ?? ''),
      model: options.model,
      defaultOptions: mainSteps,
      memory,
      tools: options.tools,
      workspace,
      maxProcessorRetries: 1,
    });
    const controller = new AgentController({
      id: 'pal-main-controller',
      agent,
      storage,
      memory,
      workspace,
      // Main publishes through its application messaging tool.
      disableBuiltinTools: [
        'ask_user',
        'submit_plan',
        'task_write',
        'task_update',
        'task_complete',
        'task_check',
        'subagent',
      ],
      modes: [
        {
          id: 'main',
          name: 'Main',
          ...(options.task
            ? {
                availableTools: [
                  ...Object.keys(options.tools ?? {}),
                  ...(workspace ? [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE] : []),
                ],
              }
            : {}),
        },
      ],
      defaultModeId: 'main',
    });
    // A supported parent host exposes scheduler configuration to the Controller.
    const mastra = new Mastra({
      storage,
      logger: noopLogger,
      agentControllers: { main: controller },
      schedules: options.scheduleHooks,
      ...(options.task
        ? { scheduler: { enabled: true }, workers: [new TaskSchedulerWorker()] }
        : {}),
    });
    await controller.init();
    const taskWorkspace =
      options.task && workspace
        ? new Workspace({
            id: 'pal-task-workspace',
            filesystem: options.filesystem,
            sandbox: options.sandbox,
            tools: {
              requireApproval: false,
              [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: {
                maxMediaBytes: MAX_FILE_BYTES,
              },
              ...Object.fromEntries(
                Object.values(WORKSPACE_TOOLS.COMPUTER).map((name) => [
                  name,
                  { enabled: false },
                ]),
              ),
            },
          })
        : undefined;
    const interactionWorkspace =
      options.task?.worker && workspace
        ? new Workspace({
            id: 'pal-interaction-workspace',
            filesystem: options.filesystem,
            sandbox: options.sandbox,
            tools: {
              enabled: false,
              requireApproval: false,
              ...Object.fromEntries(
                Object.values(WORKSPACE_TOOLS.COMPUTER).map((name) => [
                  name,
                  { enabled: true },
                ]),
              ),
            },
          })
        : undefined;
    const worker = options.task?.worker
      ? new Agent({
          id: 'pal-task-worker',
          name: 'Interaction',
          skills: agentSkillPaths('worker'),
          description:
            'Complete a browser, computer or website-login workflow and return verified findings to Task. Supply all relevant facts, URLs, constraints, requested interaction method and required evidence; no conversation history is inherited.',
          instructions: options.task.worker.instructions,
          model: options.task.worker.model,
          memory: new Memory({
            storage,
            options: {
              lastMessages: false,
              semanticRecall: false,
              workingMemory: { enabled: false },
            },
          }),
          defaultOptions: ({ requestContext }) => ({
            maxSteps: 0,
            stopWhen: () => false,
            modelSettings: {
              headers: {
                'session-id': 'pal-worker:' + requestContext.get(WORKER_ID),
              },
            },
          }),
          tools: options.task.worker.tools,
          inputProcessors: options.task.worker.inputProcessors,
          workspace: interactionWorkspace,
        })
      : undefined;
    const delegation = options.task?.worker
      ? taskWorkerDelegation(
          options.task.worker.cleanup,
          options.task.worker.resume,
        )
      : undefined;
    const taskAgent = options.task
      ? new Agent<string, ToolsInput, PublicResponse>({
          id: 'pal-task-agent',
          name: 'Task',
          skills: agentSkillPaths('task'),
          instructions: options.task.instructions,
          model: options.model,
          defaultOptions: ({ requestContext }) => {
            const threadId = requestContext.get(MASTRA_THREAD_ID_KEY);
            let runId: string | undefined;
            const clear = (interrupted = false) => {
              if (runId)
                options.onTaskActivity?.(
                  runId,
                  false,
                  typeof threadId === 'string' ? threadId : undefined,
                  interrupted,
                );
            };
            return {
              ...unlimitedSteps,
              structuredOutput: publicOutputOptions,
              ...(delegation ? { delegation } : {}),
              modelSettings: {
                timeout: {
                  firstChunkMs: 120_000,
                  stepMs: 300_000,
                },
                maxRetries: 1,
                ...(typeof threadId === 'string'
                  ? { headers: { 'session-id': threadId } }
                  : {}),
              },
              onChunk: (chunk) => {
                if (
                  chunk.type === 'finish' ||
                  chunk.type === 'error' ||
                  chunk.type === 'abort'
                )
                  return;
                if (!runId && chunk.runId) {
                  runId = chunk.runId;
                  options.onTaskActivity?.(
                    runId,
                    true,
                    typeof threadId === 'string' ? threadId : undefined,
                  );
                }
              },
              onFinish: ({ finishReason }) => clear(finishReason === 'error'),
              onAbort: () => clear(true),
              onError: async () => {
                clear(true);
                if (requestContext.get('palScheduledExecution')) {
                  const thread: unknown =
                    requestContext.get(MASTRA_THREAD_ID_KEY);
                  if (typeof thread === 'string')
                    await options.onTaskError?.(thread);
                }
              },
            };
          },
          memory,
          tools: options.task.tools,
          ...(worker ? { agents: { worker } } : {}),
          inputProcessors: options.task.inputProcessors,
          workspace: taskWorkspace,
          maxProcessorRetries: 1,
          outputProcessors: [publishTextProcessor(options.task.publish)],
        })
      : undefined;
    if (taskAgent) mastra.addAgent(taskAgent);
    const session = await controller.createSession({
      id: 'pal-main-session',
      ownerId: MAIN_RESOURCE_ID,
      resourceId: MAIN_RESOURCE_ID,
      threadId: MAIN_THREAD_ID,
    });
    // Controller hard-codes 1,000 steps without a configuration option. Its public
    // Session machinery boundary lets us remove that cap for initial runs and resumes.
    const machinery = session.machinery;
    session.setMachinery({
      ...machinery,
      buildStreamOptions: async (input) =>
        withMainSessionHeader(await machinery.buildStreamOptions(input)),
      buildSharedRunOptions: () =>
        withMainSessionHeader(machinery.buildSharedRunOptions()),
    });
    // AgentController has its own approval policy in addition to workspace configuration.
    await session.state.set({ yolo: true });
    const unsubscribe = session.subscribe(options.onEvent);
    return {
      session,
      mastra,
      agent,
      taskAgent,
      worker,
      memory,
      storage,
      workspace,
      async close() {
        // Keep the native event consumer attached until cancellation finishes,
        // so final persistence settles before its pool is closed.
        if (session.stream.isActive()) {
          const finished = new Promise<void>((resolve) => {
            const stop = session.subscribe((event) => {
              if (event.type === 'agent_end') {
                stop();
                resolve();
              }
            });
          });
          session.abort();
          await finished;
        }
        await controller.deleteSession({ resourceId: MAIN_RESOURCE_ID });
        unsubscribe();
        await memory.settled();
        await (await worker?.getMemory())?.settled();
        await mastra.shutdown();
      },
    };
  } catch (error) {
    try {
      await workspace?.stop();
    } finally {
      await storage.close();
    }
    throw error;
  }
}
