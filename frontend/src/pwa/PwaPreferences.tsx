import { NotificationPreferences } from './NotificationPreferences';
import { Radio, Stack } from '@mantine/core';
import {
  setUpdateMode,
  useUpdateMode,
  type UpdateMode,
} from './update-preference';

export function PwaPreferences() {
  const mode = useUpdateMode();
  return (
    <>
      <NotificationPreferences />
      <section className="pwa-preferences">
        <h3>Application updates</h3>
        <Radio.Group
          label="Update behavior"
          value={mode}
          onChange={(value) => setUpdateMode(value as UpdateMode)}
        >
          <Stack gap="xs" mt="xs">
            <Radio value="ask" label="Ask before updating" />
            <Radio
              value="automatic-when-safe"
              label="Update automatically when safe"
            />
          </Stack>
        </Radio.Group>
        <small>
          Automatic updates wait while a draft, upload, send, settings edit, or
          desktop session is active.
        </small>
      </section>
    </>
  );
}
