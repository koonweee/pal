import { ApplicationError } from '../../application/contracts/errors.js';

// These services cover the required iPhone and Chrome clients without accepting
// arbitrary outbound URLs from registration requests.
export function validateSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  try {
    const url = new URL(input.endpoint);
    const allowed =
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'web.push.apple.com' ||
      url.hostname.endsWith('.push.apple.com');
    if (
      !allowed ||
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      input.endpoint.length > 4096
    )
      throw new Error();
    const key = Buffer.from(input.keys.p256dh, 'base64url');
    const auth = Buffer.from(input.keys.auth, 'base64url');
    if (
      !/^[A-Za-z0-9_-]+={0,2}$/.test(input.keys.p256dh) ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(input.keys.auth) ||
      key.length !== 65 ||
      key[0] !== 4 ||
      auth.length !== 16
    )
      throw new Error();
  } catch {
    throw new ApplicationError(
      'invalid_input',
      'Invalid Web Push subscription',
    );
  }
}
