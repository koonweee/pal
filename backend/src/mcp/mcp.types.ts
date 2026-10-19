export type McpAuth =
  | { type: 'none' }
  | { type: 'headers'; headers: Record<string, string> }
  | {
      type: 'oauth';
      clientId?: string;
      clientSecret?: string;
      clientMetadataUrl?: string;
      scope: string;
    };

export interface McpStatus {
  state: 'disabled' | 'not-applied' | 'connected' | 'needs-auth' | 'error';
  toolCount: number;
  error?: string;
}

export interface McpAuthInput {
  type: 'none' | 'headers' | 'oauth';
  headers?: Record<string, string> | null;
  clientId?: string;
  clientSecret?: string | null;
  clientMetadataUrl?: string;
  scope?: string;
}

export interface SaveMcpServerInput {
  name?: string;
  url?: string;
  enabled?: boolean;
  auth?: McpAuthInput;
}
