type DateValue = string | Date;

function localDate(value: DateValue) {
  return value instanceof Date ? value : new Date(value);
}

export function conversationDateKey(value: DateValue) {
  const date = localDate(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => (index ? String(part).padStart(2, '0') : part))
    .join('-');
}

export function conversationDateLabel(value: DateValue, now = new Date()) {
  const date = localDate(value);
  if (conversationDateKey(date) === conversationDateKey(now)) return 'Today';

  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  if (conversationDateKey(date) === conversationDateKey(yesterday))
    return 'Yesterday';

  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
    date,
  );
  return `${month} ${date.getDate()}${date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`}`;
}
