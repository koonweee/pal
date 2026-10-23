export interface paths {
  '/chat/actions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['selectMessageAction'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/chat/history': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getChatHistory'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/chat/messages': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['sendChatMessage'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/files': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['uploadFile'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/files/{id}/content': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getFileContent'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/files/{id}/download': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['downloadFile'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/frontend-updates': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['publishFrontendUpdate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getHealth'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/instance-settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getInstanceSettings'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['updateInstanceSettings'];
    trace?: never;
  };
  '/login/inspections/{id}/image': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getLoginInspectionImage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/login/requests/{id}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['cancelLoginRequest'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/login/requests/{id}/code': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['submitLoginCode'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/login/requests/{id}/save': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['saveLoginRequest'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/login/tasks/{taskId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getLoginSnapshot'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/mcp/apply': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['applyMcpServers'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/mcp/oauth/callback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['completeMcpOauth'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/mcp/servers': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getMcpServers'];
    put?: never;
    post: operations['createMcpServer'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/mcp/servers/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations['removeMcpServer'];
    options?: never;
    head?: never;
    patch: operations['updateMcpServer'];
    trace?: never;
  };
  '/mcp/servers/{id}/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['startMcpLogin'];
    delete: operations['forgetMcpLogin'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/notifications/web/config': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getWebPushConfig'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/notifications/web/installations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['registerWebPush'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/notifications/web/installations/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations['disableWebPush'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/preferences': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getPreferences'];
    put?: never;
    post: operations['createPreference'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/preferences/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getPreference'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['updatePreference'];
    trace?: never;
  };
  '/preferences/{id}/history': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getPreferenceHistory'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/stream': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['streamEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/tasks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getTasks'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/tasks/{id}/archive': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['setTaskArchived'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/tasks/details/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getTaskDetails'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    ActivityCommentaryResponseDto: {
      messageId: string;
      sequence: number;
      text: string;
    };
    ActivityCompletionResponseDto: {
      cueId: string;
      id: string;
      /** Format: date-time */
      occurredAt: string;
      title: string;
    };
    ActivityTaskResponseDto: {
      id: string;
      title: string;
    };
    AgentActivityEventResponseDto: {
      /** @enum {string} */
      event: 'agent.activity';
      state: components['schemas']['AgentActivityResponseDto'];
    };
    AgentActivityResponseDto: {
      latestCompletion:
        | components['schemas']['ActivityCompletionResponseDto']
        | null;
      mainWorking: boolean;
      needsInputTasks: components['schemas']['ActivityTaskResponseDto'][];
      revision: number;
      runningTasks: components['schemas']['RunningTaskResponseDto'][];
      /** @enum {string} */
      status: 'idle' | 'working';
    };
    ApplicationErrorResponseDto: {
      current?: components['schemas']['PreferenceResponseDto'];
      message: string | string[];
      statusCode: number;
    };
    ArchiveTaskDto: {
      archived: boolean;
    };
    AttachmentResponseDto: {
      contentType: string;
      /** Format: date-time */
      createdAt: string;
      filename: string;
      /** Format: uuid */
      id: string;
      sizeBytes: number;
    };
    AuthorizationUrlResponseDto: {
      /** Format: uri */
      authorizationUrl: string;
    };
    CreatePreferenceDto: {
      appliesWhen?: string | null;
      reason: string;
      sourceMessageIds?: string[];
      statement: string;
      topic: string;
    };
    FrontendUpdatedEventResponseDto: {
      contractVersion: number;
      /** @enum {string} */
      event: 'frontend.updated';
      releaseId: string;
    };
    FrontendUpdateRequestDto: {
      revision: string;
    };
    HeartbeatEventResponseDto: {
      /** @enum {string} */
      event: 'heartbeat';
    };
    HistoryPageResponseDto: {
      before: number | null;
      messages: components['schemas']['MessageResponseDto'][];
    };
    IdResponseDto: {
      /** Format: uuid */
      id: string;
    };
    InstanceSettingsResponseDto: {
      accentColor: string;
      /** Format: uuid */
      agentAvatarAttachmentId: string | null;
      agentName: string;
      version: number;
    };
    InstanceSettingsUpdatedEventResponseDto: {
      /** @enum {string} */
      event: 'instance.settings.updated';
    };
    LoginAccountDto: {
      id: string;
      label: string;
    };
    LoginFinishedDto: {
      id: string;
      /** @enum {string} */
      status: 'saved' | 'filled' | 'cancelled';
    };
    LoginInspectionDto: {
      id: string;
      origin: string;
      targets: components['schemas']['LoginTargetDto'][];
    };
    LoginRequestDto: {
      accounts: components['schemas']['LoginAccountDto'][];
      id: string;
      /** @enum {string} */
      kind: 'credentials' | 'code';
      origin: string;
      /** @enum {string} */
      status: 'pending' | 'saved' | 'filled' | 'cancelled';
    };
    LoginSnapshotDto: {
      configured: boolean;
      inspections: components['schemas']['LoginInspectionDto'][];
      requests: components['schemas']['LoginRequestDto'][];
    };
    LoginTargetDto: {
      fields: string[];
      origin: string;
      targetRef: string;
    };
    LoginUpdatedEventDto: {
      /** @enum {string} */
      event: 'login.updated';
      taskId: string;
    };
    McpAuthDto: {
      clientId?: string;
      clientMetadataUrl?: string;
      clientSecret?: string | null;
      headers?: {
        [key: string]: string;
      } | null;
      scope?: string;
      /** @enum {string} */
      type: 'none' | 'headers' | 'oauth';
    };
    McpAuthResponseDto: {
      clientId?: string;
      clientMetadataUrl?: string;
      hasClientSecret?: boolean;
      headerNames?: string[];
      scope?: string;
      /** @enum {string} */
      type: 'none' | 'oauth' | 'headers';
    };
    McpServerResponseDto: {
      applyNeeded: boolean;
      auth: components['schemas']['McpAuthResponseDto'];
      enabled: boolean;
      hasLogin: boolean;
      /** Format: uuid */
      id: string;
      loginError?: string;
      loginPending: boolean;
      name: string;
      status: components['schemas']['McpStatusResponseDto'];
      /** Format: uri */
      url: string;
    };
    McpSnapshotResponseDto: {
      applyNeeded: boolean;
      servers: components['schemas']['McpServerResponseDto'][];
    };
    McpStatusResponseDto: {
      error?: string;
      /** @enum {string} */
      state: 'disabled' | 'not-applied' | 'connected' | 'needs-auth' | 'error';
      toolCount: number;
    };
    MessageAcceptedResponseDto: {
      /** Format: uuid */
      messageId: string;
    };
    MessageActionResponseDto: {
      id: string;
      label: string;
    };
    MessageActionsResponseDto: {
      actions: components['schemas']['MessageActionResponseDto'][];
      selectedActionId: string | null;
      /** @enum {string} */
      state: 'available' | 'selected' | 'disabled';
    };
    MessageEventResponseDto: {
      /** @enum {string} */
      event: 'message.added' | 'message.updated';
      message: components['schemas']['MessageResponseDto'];
    };
    MessageMetadataDto: {
      timezone?: string;
    };
    MessageMetadataResponseDto: {
      timezone?: string;
    };
    MessageReplySummaryResponseDto: {
      /** Format: uuid */
      id: string;
      mainVisible: boolean;
      /** @enum {string|null} */
      phase: 'commentary' | 'final_answer' | null;
      /** @enum {string} */
      role: 'user' | 'assistant';
      sequence: number;
      /** Format: uuid */
      taskId: string | null;
      textPreview: string;
    };
    MessageResponseDto: {
      actions: components['schemas']['MessageActionsResponseDto'] | null;
      attachments: components['schemas']['AttachmentResponseDto'][];
      /** Format: date-time */
      createdAt: string;
      deliveryDestinationIds: string[];
      /** Format: uuid */
      id: string;
      idempotencyKey: string | null;
      mainVisible: boolean;
      metadata: components['schemas']['MessageMetadataResponseDto'];
      notificationDestinationIds: string[];
      notify: boolean;
      originDestinationId: string | null;
      /** @enum {string|null} */
      phase: 'commentary' | 'final_answer' | null;
      reaction: string | null;
      replyTo: components['schemas']['MessageReplySummaryResponseDto'] | null;
      /** Format: uuid */
      replyToMessageId: string | null;
      /** @enum {string} */
      role: 'user' | 'assistant';
      sequence: number;
      source: string | null;
      /** Format: uuid */
      taskId: string | null;
      text: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    PreferencePageResponseDto: {
      after: string | null;
      preferences: components['schemas']['PreferenceSnapshotResponseDto'][];
    };
    PreferenceResponseDto: {
      appliesWhen: string | null;
      /** @enum {string} */
      basis: 'user-stated' | 'model-inferred';
      /** Format: date-time */
      createdAt: string;
      /** Format: uuid */
      id: string;
      sourceMessageIds: string[];
      sources: components['schemas']['PreferenceSourceResponseDto'][];
      statement: string;
      /** @enum {string} */
      status: 'active' | 'retired';
      topic: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    PreferenceRevisionPageResponseDto: {
      after: string | null;
      revisions: components['schemas']['PreferenceRevisionResponseDto'][];
    };
    PreferenceRevisionResponseDto: {
      /** @enum {string} */
      actor: 'human' | 'main' | 'task';
      /** Format: date-time */
      createdAt: string;
      /** Format: uuid */
      preferenceId: string;
      reason: string;
      snapshot: components['schemas']['PreferenceSnapshotResponseDto'];
      /** Format: uuid */
      taskId: string | null;
      version: number;
    };
    PreferenceSnapshotResponseDto: {
      appliesWhen: string | null;
      /** @enum {string} */
      basis: 'user-stated' | 'model-inferred';
      /** Format: date-time */
      createdAt: string;
      /** Format: uuid */
      id: string;
      sourceMessageIds: string[];
      statement: string;
      /** @enum {string} */
      status: 'active' | 'retired';
      topic: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    PreferenceSourceResponseDto: {
      /** Format: date-time */
      createdAt: string;
      /** Format: uuid */
      id: string;
      sequence: number;
      /** Format: uuid */
      taskId: string | null;
      textPreview: string;
    };
    RegisterWebPushDto: {
      endpoint: string;
      keys: components['schemas']['WebPushKeysDto'];
    };
    RunningTaskResponseDto: {
      commentary: components['schemas']['ActivityCommentaryResponseDto'] | null;
      id: string;
      title: string;
    };
    SaveLoginDto: {
      accountId?: string;
      label: string;
      password: string;
      username: string;
    };
    SaveMcpServerDto: {
      auth?: components['schemas']['McpAuthDto'];
      enabled?: boolean;
      name?: string;
      url?: string;
    };
    SelectActionDto: {
      actionId: string;
      idempotencyKey: string;
      /** Format: uuid */
      messageId: string;
    };
    SendMessageDto: {
      /** @default [] */
      attachmentIds: string[];
      destinationId?: string;
      idempotencyKey: string;
      metadata?: components['schemas']['MessageMetadataDto'];
      /** Format: uuid */
      replyToMessageId?: string;
      /** Format: uuid */
      taskId?: string;
      text: string;
    };
    SubmitCodeDto: {
      code: string;
    };
    TaskDetailsEnvelopeResponseDto: {
      task: components['schemas']['TaskDetailsResponseDto'];
    };
    TaskDetailsResponseDto: {
      archived: boolean;
      /** Format: date-time */
      createdAt: string;
      description: string;
      goal: string;
      /** Format: uuid */
      id: string;
      /** Format: date-time */
      lastActivityAt: string;
      /** @enum {string} */
      status: 'in-progress' | 'needs-input' | 'completed';
      title: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    TaskEventResponseDto: {
      /** @enum {string} */
      event: 'task.added' | 'task.updated';
      task: components['schemas']['TaskResponseDto'];
    };
    TaskPageResponseDto: {
      after: string | null;
      tasks: components['schemas']['TaskResponseDto'][];
    };
    TaskResponseDto: {
      archived: boolean;
      /** Format: date-time */
      createdAt: string;
      goal: string;
      /** Format: uuid */
      id: string;
      /** Format: date-time */
      lastActivityAt: string;
      /** @enum {string} */
      status: 'in-progress' | 'needs-input' | 'completed';
      title: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    UpdateInstanceSettingsDto: {
      accentColor?: string;
      /** Format: uuid */
      agentAvatarAttachmentId?: string | null;
      agentName?: string;
    };
    UpdatePreferenceDto: {
      appliesWhen?: string | null;
      expectedVersion: number;
      reason: string;
      sourceMessageIds?: string[];
      statement?: string;
      /** @enum {string} */
      status?: 'active' | 'retired';
      topic?: string;
    };
    WebPushConfigDto: {
      available: boolean;
      publicKey: string | null;
    };
    WebPushKeysDto: {
      auth: string;
      p256dh: string;
    };
    WebPushRegistrationDto: {
      /** Format: uuid */
      id: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  selectMessageAction: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SelectActionDto'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MessageAcceptedResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getChatHistory: {
    parameters: {
      query?: {
        limit?: number;
        taskId?: string;
        before?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HistoryPageResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  sendChatMessage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SendMessageDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MessageAcceptedResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  uploadFile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /** Format: binary */
          file: string;
        };
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            attachment: components['schemas']['AttachmentResponseDto'];
          };
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getFileContent: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/octet-stream': string;
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  downloadFile: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/octet-stream': string;
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  publishFrontendUpdate: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['FrontendUpdateRequestDto'];
      };
    };
    responses: {
      /** @description Frontend update marker published. */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  getHealth: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @enum {string} */
            status: 'ok';
          };
        };
      };
    };
  };
  getInstanceSettings: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InstanceSettingsResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  updateInstanceSettings: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateInstanceSettingsDto'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InstanceSettingsResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getLoginInspectionImage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'image/png': string;
        };
      };
    };
  };
  cancelLoginRequest: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LoginFinishedDto'];
        };
      };
    };
  };
  submitLoginCode: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SubmitCodeDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LoginFinishedDto'];
        };
      };
    };
  };
  saveLoginRequest: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveLoginDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LoginFinishedDto'];
        };
      };
    };
  };
  getLoginSnapshot: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        taskId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LoginSnapshotDto'];
        };
      };
    };
  };
  applyMcpServers: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['McpSnapshotResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  completeMcpOauth: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/plain': string;
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getMcpServers: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['McpSnapshotResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  createMcpServer: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveMcpServerDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  removeMcpServer: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Server removed. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  updateMcpServer: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveMcpServerDto'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  startMcpLogin: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthorizationUrlResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  forgetMcpLogin: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Saved login removed. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getWebPushConfig: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebPushConfigDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  registerWebPush: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterWebPushDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebPushRegistrationDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  disableWebPush: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getPreferences: {
    parameters: {
      query?: {
        limit?: number;
        queries?: string[];
        topic?: string;
        status?: 'active' | 'retired';
        after?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PreferencePageResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  createPreference: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreatePreferenceDto'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PreferenceResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getPreference: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PreferenceResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  updatePreference: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdatePreferenceDto'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PreferenceResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getPreferenceHistory: {
    parameters: {
      query?: {
        limit?: number;
        after?: string;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PreferenceRevisionPageResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  streamEvents: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Named SSE events carrying one Pal event envelope. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/event-stream':
            | components['schemas']['LoginUpdatedEventDto']
            | components['schemas']['MessageEventResponseDto']
            | components['schemas']['TaskEventResponseDto']
            | components['schemas']['AgentActivityEventResponseDto']
            | components['schemas']['FrontendUpdatedEventResponseDto']
            | components['schemas']['HeartbeatEventResponseDto']
            | components['schemas']['InstanceSettingsUpdatedEventResponseDto'];
        };
      };
    };
  };
  getTasks: {
    parameters: {
      query?: {
        limit?: number;
        archived?: boolean;
        after?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TaskPageResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  setTaskArchived: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ArchiveTaskDto'];
      };
    };
    responses: {
      /** @description Archive state updated. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
  getTaskDetails: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TaskDetailsEnvelopeResponseDto'];
        };
      };
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApplicationErrorResponseDto'];
        };
      };
    };
  };
}
