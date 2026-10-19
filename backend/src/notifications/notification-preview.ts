/** Shared notification copy for browser push and APNs. */
export function notificationPreview(text: string, reaction?: string) {
  const plain = text
    .replace(/```[\s\S]*?```/g, 'Code')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, 'Image')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}[#>*+-]+\s*/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!reaction) return plain;
  if (!plain) return `reacted ${reaction}`;
  const characters = Array.from(plain);
  const preview = characters.slice(0, 200).join('');
  return `reacted ${reaction} to “${preview}${characters.length > 200 ? '…' : ''}”`;
}
