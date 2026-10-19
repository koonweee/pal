export const dynamicRoutePattern =
  /^\/(?:api|stream|desktop|chat|tasks|files|instance-settings|preferences|mcp|notifications)(?:\/|$)/;

export function isDynamicPath(pathname: string) {
  return dynamicRoutePattern.test(pathname);
}
