import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AndroidService } from '../android/android.service.js';
import { androidTools } from '../android/android-tools.js';
import type { SharedBrowserService } from '../browser/shared-browser.service.js';
import type { ExecutionService } from '../execution/execution.service.js';
import type { FilesService } from '../files/files.service.js';
import type { InteractionCoordinator } from '../interaction/interaction-coordinator.js';
import type { LoginService } from '../login/login.service.js';
import { loginTools } from '../login/login-tools.js';
import { loadAgentInstructions } from './agent-instructions.js';
import { chatgptModel, type ModelRequestMeasurement } from './chatgpt-model.js';
import { CodeModeProcessor } from './code-mode.processor.js';
import { interactionHistoryProcessor } from './interaction-history.processor.js';
import { InteractionToolsProcessor } from './interaction-tools.processor.js';
import { InteractionVisualArtifactsProcessor } from './interaction-visual-artifacts.processor.js';
import type { createMainSession } from './main-session.js';
import { X11Computer } from './x11-computer.js';

type SessionOptions = Parameters<typeof createMainSession>[0];

/** Production interaction wiring, also used by exclusive device acceptance. */
export async function interactionSession(
  config: ConfigService,
  execution: ExecutionService,
  browser: SharedBrowserService,
  android: AndroidService,
  login: LoginService,
  files: FilesService,
  coordinator: InteractionCoordinator,
  onModelRequest?: (measurement: ModelRequestMeasurement) => void,
) {
  const instructions = await loadAgentInstructions('worker');
  const logger = new Logger('InteractionSession');
  const visualArtifacts = new InteractionVisualArtifactsProcessor(files);
  const worker: NonNullable<NonNullable<SessionOptions['task']>['worker']> = {
    coordinator,
    model: chatgptModel(
      'gpt-6.1-terra',
      config.getOrThrow<string>('PAL_AGENT_AUTH_PATH'),
      'medium',
      { role: 'worker', onRequest: onModelRequest },
    ),
    instructions: () =>
      instructions +
      '\n' +
      android.instructions +
      '\nCurrent time (UTC): ' +
      new Date().toISOString(),
    tools: async () => ({
      ...(await androidTools(android)),
      ...loginTools(login),
    }),
    inputProcessors: [
      new InteractionToolsProcessor(coordinator),
      visualArtifacts,
      interactionHistoryProcessor(),
      new CodeModeProcessor(),
    ],
    resume: (taskId, assignment) => login.resumeWorker(taskId, assignment),
    cleanup: async (taskId, workerId, completed, startedAt) => {
      const retained = await login
        .finishWorker(taskId, workerId, completed, startedAt)
        .catch((error: unknown) => {
          logger.warn(error);
          return false;
        });
      if (!retained) browser.releaseTarget(taskId, workerId);
    },
  };
  return {
    workingDirectory: execution.home,
    sandbox: execution.sandbox,
    filesystem: execution.filesystem,
    computer: config.get<boolean>('PAL_DESKTOP_ENABLED')
      ? new X11Computer(execution, config.get<string>('PAL_DESKTOP_VIEWER_URL'))
      : undefined,
    worker,
  };
}
