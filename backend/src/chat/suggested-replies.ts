import { ApplicationError } from '../application/contracts/errors.js';

export const maxSuggestedReplies = 3;
export const maxSuggestedReplyLength = 80;

export function parseSuggestedReplies(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maxSuggestedReplies ||
    value.some(
      (reply) =>
        typeof reply !== 'string' ||
        !reply.trim() ||
        reply.trim().length > maxSuggestedReplyLength ||
        /[\r\n]/.test(reply),
    )
  )
    throw new ApplicationError(
      'invalid_input',
      'Use up to three nonempty, single-line suggested replies of at most 80 characters.',
    );
  const replies = (value as string[]).map((reply) => reply.trim());
  if (new Set(replies).size !== replies.length)
    throw new ApplicationError(
      'invalid_input',
      'Suggested replies must be unique.',
    );
  return replies;
}
