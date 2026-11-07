import { Logger } from '@nestjs/common';
import type {
  ProcessInputStepArgs,
  ProcessLLMRequestArgs,
  ProcessLLMRequestResult,
  Processor,
} from '@mastra/core/processors';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { Readable } from 'node:stream';
import type { FilesService } from '../files/files.service.js';

const artifactPrefix = 'pal-image-artifact:';
const artifactPattern = /pal-image-artifact:([0-9a-f-]{36})/g;
const computerTools = new Set<string>(Object.values(WORKSPACE_TOOLS.COMPUTER));
const defaultVisualTools = [
  ...computerTools,
  'android_inspect',
  'android_screenshot',
  'inspect_private_fields',
];

type MutableRecord = Record<string, unknown>;
type Artifact = { id: string; mediaType: string };

function record(value: unknown): MutableRecord | undefined {
  return value && typeof value === 'object'
    ? (value as MutableRecord)
    : undefined;
}

function marker(id: string) {
  return artifactPrefix + id;
}

function mediaBytes(data: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(data);
  return Buffer.from(match?.[2] ?? data, 'base64');
}

function extension(mediaType: string) {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/webp') return 'webp';
  return 'png';
}

function replaceKnownStrings(
  value: unknown,
  replacements: Map<string, string>,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      value[index] = replaceKnownStrings(value[index], replacements, seen);
    return value;
  }
  for (const [key, child] of Object.entries(value as MutableRecord))
    (value as MutableRecord)[key] = replaceKnownStrings(
      child,
      replacements,
      seen,
    );
  return value;
}

function findNewestMarker(value: unknown): string | undefined {
  let newest: string | undefined;
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      artifactPattern.lastIndex = 0;
      for (const match of candidate.matchAll(artifactPattern)) newest = match[1];
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const child of Array.isArray(candidate)
      ? candidate
      : Object.values(candidate as MutableRecord))
      visit(child);
  };
  visit(value);
  return newest;
}

function outputText(output: unknown) {
  const value = record(output);
  if (value?.type === 'text' && typeof value.value === 'string')
    return value.value;
  if (value?.type === 'content' && Array.isArray(value.value)) {
    const text = value.value
      .map((part) => record(part))
      .filter(
        (part): part is MutableRecord =>
          !!part && part.type === 'text' && typeof part.text === 'string',
      )
      .map((part) => part.text)
      .join('\n');
    if (text) return text;
  }
  return JSON.stringify(output);
}

/** Externalize completed visual payloads and hydrate only the newest prompt image. */
export class InteractionVisualArtifactsProcessor implements Processor {
  readonly id = 'pal-interaction-visual-artifacts';
  private readonly logger = new Logger(InteractionVisualArtifactsProcessor.name);
  private readonly visualTools: Set<string>;

  constructor(
    private readonly files: FilesService,
    additionalVisualTools: string[] = [],
  ) {
    this.visualTools = new Set([
      ...defaultVisualTools,
      ...additionalVisualTools,
    ]);
  }

  private async store(data: string, mediaType: string, toolName: string) {
    const bytes = mediaBytes(data);
    const saved = await this.files.upload({
      stream: Readable.from([bytes]),
      filename: `${toolName}-${Date.now()}.${extension(mediaType)}`,
      contentType: mediaType,
    });
    return { id: saved.id, mediaType } satisfies Artifact;
  }

  private async compact(toolName: string, result: unknown) {
    const value = record(result);
    if (!value || findNewestMarker(value)) return;
    const artifacts: Artifact[] = [];
    const replacements = new Map<string, string>();
    const save = async (data: string, mediaType: string) => {
      const artifact = await this.store(data, mediaType, toolName);
      artifacts.push(artifact);
      replacements.set(data, marker(artifact.id));
    };

    if (
      value.__workspaceMedia === true &&
      typeof value.data === 'string' &&
      typeof value.mediaType === 'string'
    ) {
      await save(value.data, value.mediaType);
      delete value.data;
      delete value.__workspaceMedia;
    } else if (toolName.startsWith('android_') && Array.isArray(value.content)) {
      for (const part of value.content) {
        const item = record(part);
        if (
          item?.type === 'image' &&
          typeof item.data === 'string' &&
          typeof item.mimeType === 'string'
        ) {
          await save(item.data, item.mimeType);
          item.type = 'text';
          item.text = `Screenshot stored as ${marker(artifacts.at(-1)!.id)}`;
          delete item.data;
          delete item.mimeType;
        }
      }
    } else if (
      toolName === 'inspect_private_fields' &&
      typeof value.image === 'string'
    ) {
      await save(value.image, 'image/png');
      delete value.image;
    }
    if (!artifacts.length) return;
    value.visualArtifacts = artifacts.map((artifact) => ({
      ref: marker(artifact.id),
      mediaType: artifact.mediaType,
    }));
    return { result: value, replacements };
  }

  async processInputStep({ messageList, steps }: ProcessInputStepArgs) {
    const replacements = new Map<string, string>();
    for (const message of messageList.get.all.db()) {
      if (message.role !== 'assistant' || !message.content?.parts) continue;
      for (const part of message.content.parts) {
        if (
          part.type !== 'tool-invocation' ||
          part.toolInvocation?.state !== 'result' ||
          !this.visualTools.has(part.toolInvocation.toolName)
        )
          continue;
        const compacted = await this.compact(
          part.toolInvocation.toolName,
          part.toolInvocation.result,
        );
        if (!compacted) continue;
        for (const entry of compacted.replacements)
          replacements.set(entry[0], entry[1]);
        const providerMetadata = record(part.providerMetadata) ?? {};
        const mastra = record(providerMetadata.mastra) ?? {};
        messageList.updateToolInvocation({
          ...part,
          toolInvocation: {
            ...part.toolInvocation,
            result: compacted.result,
          },
          providerMetadata: {
            ...providerMetadata,
            mastra: {
              ...mastra,
              modelOutput: {
                type: 'content',
                value: [
                  { type: 'text', text: JSON.stringify(compacted.result) },
                ],
              },
            },
          },
        });
      }
    }
    if (replacements.size) replaceKnownStrings(steps, replacements);
    return messageList;
  }

  async processLLMRequest({
    prompt,
  }: ProcessLLMRequestArgs): Promise<ProcessLLMRequestResult> {
    for (let messageIndex = prompt.length - 1; messageIndex >= 0; messageIndex--) {
      const message = prompt[messageIndex];
      if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
        const part = message.content[partIndex];
        if (part.type !== 'tool-result') continue;
        const id = findNewestMarker(part.output);
        if (!id) continue;
        try {
          const { file, handle } = await this.files.content(id);
          try {
            const hydrated = structuredClone(prompt);
            const output = (
              hydrated[messageIndex] as typeof message
            ).content[partIndex] as typeof part;
            output.output = {
              type: 'content',
              value: [
                { type: 'text', text: outputText(part.output) },
                {
                  type: 'media',
                  data: (await handle.readFile()).toString('base64'),
                  mediaType: file.contentType,
                },
              ],
            };
            return { prompt: hydrated };
          } finally {
            await handle.close();
          }
        } catch {
          this.logger.warn(`Visual artifact ${id} could not be hydrated`);
          return;
        }
      }
    }
  }
}
