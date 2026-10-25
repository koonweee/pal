export const dynamicRoutePattern =
  /^\/(?:api|stream|desktop|chat|tasks|files|instance-settings|preferences|mcp|notifications)(?:\/|$)|^\/(?:manifest\.webmanifest|apple-touch-icon(?:-precomposed)?\.png)$/;

export function isDynamicPath(pathname: string) {
  return dynamicRoutePattern.test(pathname);
}
