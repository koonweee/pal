import type {
  McpSnapshot,
  Message,
  Preference,
  PreferenceRevision,
  Task,
  TaskDetails,
} from '../api/client';
import type { MessageView } from '../chat/use-chat';

const now = '2026-10-17T18:30:00.000Z';

function message(
  id: string,
  sequence: number,
  role: Message['role'],
  text: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    suggestedReplies: [],
    attachments: [],
    createdAt: now,
    deliveryDestinationIds: ['web'],
    id,
    idempotencyKey: role === 'user' ? `key-${id}` : null,
    metadata: {},
    notificationDestinationIds: [],
    notify: false,
    originDestinationId: role === 'user' ? 'web' : null,
    mainVisible: false,
    reaction: null,
    phase: role === 'assistant' ? 'final_answer' : null,
    replyTo: null,
    replyToMessageId: null,
    role,
    sequence,
    source: role === 'assistant' ? 'main' : null,
    taskId: null,
    text,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

const first = message(
  '10000000-0000-4000-8000-000000000001',
  1,
  'user',
  'Can you turn these notes into a concise launch checklist?',
);

const second = message(
  '10000000-0000-4000-8000-000000000002',
  2,
  'assistant',
  'Absolutely. I’ll organize it into **before launch**, **launch day**, and **follow-up** sections.\n\n- Confirm the release owner\n- Run the acceptance checks\n- Prepare the rollback note',
);

const third = message(
  '10000000-0000-4000-8000-000000000003',
  3,
  'user',
  'Please include the attached brief and keep it under one page.',
  {
    attachments: [
      {
        contentType: 'application/pdf',
        createdAt: now,
        filename: 'launch-brief.pdf',
        id: '20000000-0000-4000-8000-000000000001',
        sizeBytes: 248_000,
      },
    ],
    replyTo: {
      id: second.id,
      phase: second.phase,
      mainVisible: second.mainVisible,
      role: second.role,
      sequence: second.sequence,
      taskId: null,
      textPreview: 'Absolutely. I’ll organize it into three sections.',
    },
    replyToMessageId: second.id,
  },
);

export const workbenchMessages: MessageView[] = [
  {
    failed: false,
    message: first,
    persisted: true,
    receiptSlot: false,
    read: false,
    retrying: false,
    showQuote: false,
  },
  {
    failed: false,
    message: second,
    persisted: true,
    receiptSlot: false,
    read: false,
    retrying: false,
    showQuote: false,
  },
  {
    failed: false,
    message: third,
    persisted: true,
    receiptSlot: true,
    read: true,
    retrying: false,
    showQuote: true,
  },
];

export const workbenchTasks: Task[] = [
  {
    archived: false,
    createdAt: '2026-10-16T17:00:00.000Z',
    goal: 'Prepare a concise launch plan for the new web experience.',
    id: '30000000-0000-4000-8000-000000000001',
    lastActivityAt: now,
    status: 'in-progress',
    title: 'Launch checklist',
    updatedAt: now,
    version: 3,
  },
  {
    archived: false,
    createdAt: '2026-10-15T17:00:00.000Z',
    goal: 'Compare candidate notification approaches.',
    id: '30000000-0000-4000-8000-000000000002',
    lastActivityAt: '2026-10-17T15:00:00.000Z',
    status: 'needs-input',
    title: 'Notification options',
    updatedAt: '2026-10-17T15:00:00.000Z',
    version: 2,
  },
  {
    archived: false,
    createdAt: '2026-10-14T17:00:00.000Z',
    goal: 'Review onboarding copy.',
    id: '30000000-0000-4000-8000-000000000003',
    lastActivityAt: '2026-10-16T20:00:00.000Z',
    status: 'completed',
    title: 'Onboarding copy',
    updatedAt: '2026-10-16T20:00:00.000Z',
    version: 4,
  },
];

export const workbenchTaskDetails: TaskDetails = {
  ...workbenchTasks[0]!,
  description:
    'A representative task description showing the selected-task treatment.',
};

const preference: Preference = {
  appliesWhen: 'When arranging personal travel',
  basis: 'user-stated',
  createdAt: '2026-10-10T17:00:00.000Z',
  id: '40000000-0000-4000-8000-000000000001',
  sourceMessageIds: ['10000000-0000-4000-8000-000000000010'],
  sources: [
    {
      createdAt: '2026-10-10T17:00:00.000Z',
      id: '10000000-0000-4000-8000-000000000010',
      sequence: 42,
      taskId: null,
      textPreview: 'I prefer morning flights and aisle seats.',
    },
  ],
  statement: 'Prefer morning flights and aisle seats.',
  status: 'active',
  topic: 'travel.flights',
  updatedAt: now,
  version: 2,
};

const olderPreference = {
  ...preference,
  appliesWhen: null,
  statement: 'Prefer aisle seats.',
  updatedAt: '2026-10-10T17:00:00.000Z',
  version: 1,
};

export const workbenchPreferencePreview: {
  preferences: Preference[];
  revisions: PreferenceRevision[];
} = {
  preferences: [
    preference,
    {
      ...preference,
      appliesWhen: 'For weeknight meals',
      basis: 'model-inferred',
      id: '40000000-0000-4000-8000-000000000002',
      sourceMessageIds: [],
      sources: [],
      statement: 'Favor recipes that take less than 30 minutes.',
      topic: 'food.cooking',
      version: 1,
    },
  ],
  revisions: [
    {
      actor: 'human',
      createdAt: now,
      preferenceId: preference.id,
      reason: 'Added a time-of-day preference.',
      snapshot: preference,
      taskId: null,
      version: 2,
    },
    {
      actor: 'human',
      createdAt: olderPreference.updatedAt,
      preferenceId: preference.id,
      reason: 'Created by the user.',
      snapshot: olderPreference,
      taskId: null,
      version: 1,
    },
  ],
};

export const workbenchMcpPreview: McpSnapshot = {
  applyNeeded: true,
  servers: [
    {
      applyNeeded: false,
      auth: { type: 'oauth', clientId: 'pal-web', scope: 'read write' },
      enabled: true,
      hasLogin: true,
      id: '50000000-0000-4000-8000-000000000001',
      loginPending: false,
      name: 'workspace',
      status: { state: 'connected', toolCount: 12 },
      url: 'https://example.com/mcp',
    },
    {
      applyNeeded: true,
      auth: { type: 'oauth', clientId: 'pal-web' },
      enabled: true,
      hasLogin: false,
      id: '50000000-0000-4000-8000-000000000002',
      loginPending: false,
      name: 'research',
      status: { state: 'needs-auth', toolCount: 0 },
      url: 'https://research.example.com/mcp',
    },
    {
      applyNeeded: false,
      auth: { type: 'none' },
      enabled: false,
      hasLogin: false,
      id: '50000000-0000-4000-8000-000000000003',
      loginPending: false,
      name: 'archive',
      status: { state: 'disabled', toolCount: 0 },
      url: 'https://archive.example.com/mcp',
    },
  ],
};
