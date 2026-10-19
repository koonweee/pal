/** Validates opaque destination IDs carried by native agent metadata. */
export function validDestinationIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (id) => typeof id === 'string' && /^[a-z][a-z0-9:_-]{0,99}$/.test(id),
    ) &&
    new Set(value).size === value.length
  );
}
