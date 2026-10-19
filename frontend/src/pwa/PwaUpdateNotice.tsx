import {
  Button,
  CloseButton,
  Group,
  Paper,
  Popover,
  Text,
} from '@mantine/core';
import { Info, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { AnimatedNumericText } from '../ui/AnimatedNumericText';
import { IconAction } from '../ui/IconAction';

export interface PwaUpdateNoticeProps {
  busy?: boolean;
  countdown?: number;
  deferred?: boolean;
  error?: string;
  required?: boolean;
  onActivate(): void;
  onDismiss(): void;
  onRetry(): void;
}

export function PwaUpdateNotice({
  busy = false,
  countdown,
  deferred = false,
  error,
  required = false,
  onActivate,
  onDismiss,
  onRetry,
}: PwaUpdateNoticeProps) {
  const label = busy
    ? 'Updating…'
    : error
      ? 'Update failed'
      : countdown !== undefined
        ? `Updating in ${countdown}s`
        : required
          ? 'Update required'
          : 'Update available';
  const details = error
    ? `Could not check for a Pal update. ${error}`
    : required
      ? 'Pal updated and must refresh before making more changes.'
      : deferred
        ? 'Finish or clear your draft, uploads, send, settings edit, or desktop session before updating.'
        : undefined;

  return (
    <div className="pal-pwa-lifecycle" role="presentation">
      <Paper
        id="pwa-update"
        className="pal-pwa-lifecycle-notice pal-raised-glass"
        role="status"
        radius="lg"
      >
        <Group align="center" gap="xs" wrap="nowrap">
          <RefreshCw
            className="pal-pwa-lifecycle-icon"
            size={18}
            aria-hidden="true"
          />
          <Text className="pal-pwa-lifecycle-copy" size="sm" fw={600}>
            <AnimatedNumericText text={label} />
          </Text>
          {details ? <UpdateDetails details={details} /> : null}
          <Button
            type="button"
            onClick={error ? onRetry : onActivate}
            disabled={busy}
            size="compact-sm"
            variant="light"
          >
            Update
          </Button>
          {!required && !error ? (
            <CloseButton
              aria-label="Dismiss update notice"
              onClick={onDismiss}
              disabled={busy}
              size="sm"
            />
          ) : null}
        </Group>
      </Paper>
    </div>
  );
}

function UpdateDetails({ details }: { details: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover onChange={setOpened} opened={opened} position="bottom" withArrow>
      <Popover.Target>
        <IconAction
          label="Update details"
          tooltipLabel={null}
          aria-expanded={opened}
          className="pal-pwa-lifecycle-info"
          onBlur={() => setOpened(false)}
          onClick={() => setOpened(true)}
          onFocus={() => setOpened(true)}
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          size="sm"
          variant="subtle"
        >
          <Info aria-hidden="true" size={15} />
        </IconAction>
      </Popover.Target>
      <Popover.Dropdown maw={320} role="tooltip">
        <Text size="xs">{details}</Text>
      </Popover.Dropdown>
    </Popover>
  );
}
