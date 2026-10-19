export interface InstanceSettings {
  agentName: string;
  agentAvatarAttachmentId: string | null;
  accentColor: string;
  version: number;
}

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  agentName: 'pal',
  agentAvatarAttachmentId: null,
  accentColor: '#0066d6',
  version: 0,
};
export type UpdateInstanceSettings = Partial<Omit<InstanceSettings, 'version'>>;
