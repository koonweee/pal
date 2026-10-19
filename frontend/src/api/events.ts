import { decodePalEvent, type PalEvent } from './client';
import { FIRST_PARTY_CONTRACT_VERSION } from './contract';
import {
  observeFrontendRelease,
  requestFrontendUpdateCheck,
} from '../pwa/releases';

const eventNames = [
  'message.added',
  'message.updated',
  'task.added',
  'task.updated',
  'agent.activity',
  'frontend.updated',
  'heartbeat',
  'instance.settings.updated',
] as const;

export interface PalEventHandlers {
  onOpen(): void;
  onError(): void;
  onEvent(event: PalEvent): void;
  onMalformed(): void;
}

export function openPalEventStream(handlers: PalEventHandlers) {
  const source = new EventSource(
    `/api/stream?contractVersion=${FIRST_PARTY_CONTRACT_VERSION}`,
  );
  source.onopen = () => {
    requestFrontendUpdateCheck();
    handlers.onOpen();
  };
  source.onerror = handlers.onError;
  for (const name of eventNames) {
    source.addEventListener(name, (message: MessageEvent<string>) => {
      const event = decodePalEvent(name, message.data);
      if (event) {
        if (event.event === 'frontend.updated') observeFrontendRelease(event);
        handlers.onEvent(event);
      } else handlers.onMalformed();
    });
  }
  return () => source.close();
}
