import { AGENT_HOME } from '../execution/paths.js';
import { resolve } from 'node:path';
import { createPrivateKey, createECDH } from 'node:crypto';
export function validateEnvironment(env: Record<string, unknown>) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl !== 'string')
    throw new Error('DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535');
  if (typeof env.PAL_UPLOAD_DIR !== 'string' || !env.PAL_UPLOAD_DIR.trim())
    throw new Error('PAL_UPLOAD_DIR is required');
  const host = env.HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || !host.trim())
    throw new Error('HOST must be a nonempty hostname or address');
  const workingDirectory =
    env.PAL_AGENT_WORKING_DIR ?? AGENT_HOME + '/workspace';
  if (typeof workingDirectory !== 'string' || !workingDirectory.trim())
    throw new Error('PAL_AGENT_WORKING_DIR must be a nonempty path');
  const desktopEnabled = env.PAL_DESKTOP_ENABLED ?? 'false';
  if (desktopEnabled !== 'true' && desktopEnabled !== 'false')
    throw new Error('PAL_DESKTOP_ENABLED must be true or false');
  const releaseId = env.PAL_RELEASE_ID ?? 'development';
  if (typeof releaseId !== 'string' || !releaseId.trim())
    throw new Error('PAL_RELEASE_ID must be a nonempty string');
  const viewerUrl = env.PAL_DESKTOP_VIEWER_URL;
  const catalogWarnPercent = Number(env.PAL_MCP_CATALOG_WARN_PERCENT ?? 10);
  if (
    !Number.isFinite(catalogWarnPercent) ||
    catalogWarnPercent <= 0 ||
    catalogWarnPercent > 100
  )
    throw new Error(
      'PAL_MCP_CATALOG_WARN_PERCENT must be greater than 0 and at most 100',
    );
  const contextWindowTokens =
    env.PAL_AGENT_CONTEXT_WINDOW_TOKENS === undefined ||
    env.PAL_AGENT_CONTEXT_WINDOW_TOKENS === ''
      ? undefined
      : Number(env.PAL_AGENT_CONTEXT_WINDOW_TOKENS);
  if (
    contextWindowTokens !== undefined &&
    (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens <= 0)
  )
    throw new Error(
      'PAL_AGENT_CONTEXT_WINDOW_TOKENS must be a positive integer',
    );
  if (
    env.PAL_PUBLIC_URL !== undefined &&
    typeof env.PAL_PUBLIC_URL !== 'string'
  )
    throw new Error('PAL_PUBLIC_URL must be an HTTP(S) origin');
  const publicUrl = new URL(env.PAL_PUBLIC_URL ?? 'http://localhost:8080/');
  if (
    !['http:', 'https:'].includes(publicUrl.protocol) ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== '/' ||
    publicUrl.search ||
    publicUrl.hash
  )
    throw new Error('PAL_PUBLIC_URL must be an HTTP(S) origin');
  const telegramToken = env.PAL_TELEGRAM_BOT_TOKEN;
  const telegramOwner = env.PAL_TELEGRAM_OWNER_ID;
  if (!!telegramToken !== !!telegramOwner)
    throw new Error(
      'PAL_TELEGRAM_BOT_TOKEN and PAL_TELEGRAM_OWNER_ID must be configured together',
    );
  if (
    telegramToken !== undefined &&
    (typeof telegramToken !== 'string' ||
      !/^\d+:[A-Za-z0-9_-]+$/.test(telegramToken))
  )
    throw new Error('PAL_TELEGRAM_BOT_TOKEN is invalid');
  if (
    telegramOwner !== undefined &&
    (typeof telegramOwner !== 'string' || !/^-?\d+$/.test(telegramOwner))
  )
    throw new Error('PAL_TELEGRAM_OWNER_ID must be an integer string');
  const apnsKeys = [
    'PAL_APNS_TEAM_ID',
    'PAL_APNS_KEY_ID',
    'PAL_APNS_PRIVATE_KEY',
    'PAL_APNS_TOPIC',
    'PAL_APNS_ENVIRONMENT',
  ] as const;
  const apnsValues = apnsKeys.map((key) => env[key]);
  const apnsConfigured = apnsValues.some(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (
    apnsConfigured &&
    apnsValues.some((value) => typeof value !== 'string' || !value.length)
  )
    throw new Error('PAL_APNS_* values must be configured together');
  if (apnsConfigured) {
    if (
      !/^[A-Z0-9]{10}$/.test(String(env.PAL_APNS_TEAM_ID)) ||
      !/^[A-Z0-9]{10}$/.test(String(env.PAL_APNS_KEY_ID))
    )
      throw new Error(
        'PAL_APNS_TEAM_ID and PAL_APNS_KEY_ID must contain ten uppercase letters or digits',
      );
    if (!/^[A-Za-z0-9.-]+$/.test(String(env.PAL_APNS_TOPIC)))
      throw new Error('PAL_APNS_TOPIC must be a bundle identifier');
    if (
      !['development', 'production'].includes(String(env.PAL_APNS_ENVIRONMENT))
    )
      throw new Error('PAL_APNS_ENVIRONMENT must be development or production');
    try {
      if (
        createPrivateKey(String(env.PAL_APNS_PRIVATE_KEY)).asymmetricKeyDetails
          ?.namedCurve !== 'prime256v1'
      )
        throw new Error();
    } catch {
      throw new Error(
        'PAL_APNS_PRIVATE_KEY must be an unencrypted P-256 PEM private key',
      );
    }
  }
  const webPushValues = [
    'PAL_WEB_PUSH_PUBLIC_KEY',
    'PAL_WEB_PUSH_PRIVATE_KEY',
    'PAL_WEB_PUSH_SUBJECT',
  ].map((key) => env[key]);
  const webPushConfigured = webPushValues.some(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (webPushConfigured) {
    if (
      webPushValues.some((value) => typeof value !== 'string' || !value.length)
    )
      throw new Error('PAL_WEB_PUSH_* values must be configured together');
    try {
      const key = createECDH('prime256v1');
      key.setPrivateKey(
        Buffer.from(String(env.PAL_WEB_PUSH_PRIVATE_KEY), 'base64url'),
      );
      if (
        key.getPublicKey().toString('base64url') !==
        String(env.PAL_WEB_PUSH_PUBLIC_KEY)
      )
        throw new Error();
      const subject = new URL(String(env.PAL_WEB_PUSH_SUBJECT));
      if (!['https:', 'mailto:'].includes(subject.protocol)) throw new Error();
    } catch {
      throw new Error(
        'PAL_WEB_PUSH_* requires matching P-256 keys and a mailto: or HTTPS subject',
      );
    }
  }
  if (viewerUrl !== undefined && viewerUrl !== '') {
    if (
      typeof viewerUrl !== 'string' ||
      !['http:', 'https:'].includes(new URL(viewerUrl).protocol)
    )
      throw new Error('PAL_DESKTOP_VIEWER_URL must be an HTTP(S) URL');
  }
  const browserEndpoint = new URL(
    typeof env.PAL_BROWSER_ENDPOINT === 'string'
      ? env.PAL_BROWSER_ENDPOINT
      : 'http://web:8081',
  );
  if (
    !['http:', 'https:'].includes(browserEndpoint.protocol) ||
    browserEndpoint.username ||
    browserEndpoint.password ||
    browserEndpoint.search ||
    browserEndpoint.hash ||
    browserEndpoint.pathname !== '/'
  )
    throw new Error('PAL_BROWSER_ENDPOINT must be an HTTP(S) origin');
  return {
    ...env,
    PAL_DESKTOP_ENABLED: desktopEnabled === 'true',
    PAL_RELEASE_ID: releaseId.trim(),
    PAL_BROWSER_ENDPOINT: browserEndpoint.origin,
    PAL_DESKTOP_VIEWER_URL:
      viewerUrl || new URL('/desktop/v2/vnc.html', publicUrl).href,
    DATABASE_URL: databaseUrl,
    PORT: port,
    HOST: host,
    PAL_PUBLIC_URL: publicUrl.toString(),
    PAL_MCP_CATALOG_WARN_PERCENT: catalogWarnPercent,
    PAL_AGENT_CONTEXT_WINDOW_TOKENS: contextWindowTokens,
    PAL_NOTIFICATION_DESTINATIONS: [
      ...(apnsConfigured ? ['ios'] : []),
      ...(webPushConfigured ? ['web'] : []),
    ],
    PAL_UPLOAD_DIR: resolve(env.PAL_UPLOAD_DIR),
    PAL_AGENT_WORKING_DIR: resolve(workingDirectory),
    PAL_AGENT_MODEL:
      typeof env.PAL_AGENT_MODEL === 'string' && env.PAL_AGENT_MODEL.trim()
        ? env.PAL_AGENT_MODEL.trim()
        : 'gpt-6.1-sol',
    PAL_AGENT_THINKING_EFFORT:
      typeof env.PAL_AGENT_THINKING_EFFORT === 'string' &&
      env.PAL_AGENT_THINKING_EFFORT.trim()
        ? env.PAL_AGENT_THINKING_EFFORT.trim()
        : 'medium',
    PAL_AGENT_AUTH_PATH: resolve(
      typeof env.PAL_AGENT_AUTH_PATH === 'string' &&
        env.PAL_AGENT_AUTH_PATH.trim()
        ? env.PAL_AGENT_AUTH_PATH
        : './data/agent/auth.json',
    ),
  };
}
