/** Private sidecar protocol. Values never enter model-facing Android tools. */
export interface NativeIdentity {
  packageName: string;
}
export interface NativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NativeInput {
  ref: string;
  type: string;
  password: boolean;
  inputType: number;
  label: string;
  identifier: string;
  maxLength: number;
  rect: NativeRect;
}
export interface NativeSnapshot {
  status: 'ready';
  session: string;
  identity: NativeIdentity;
  inputs: NativeInput[];
  image: string;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}
export interface NativeStatus {
  status: 'valid' | 'filled' | 'stopped' | 'error';
  code?: string;
}
