import { Button, Stack, Text } from '@mantine/core';
import { useWebPush } from './web-push';

export function NotificationPreferences() {
  const notifications = useWebPush();
  return (
    <section className="pwa-preferences">
      <h3>Notifications</h3>
      <Stack gap="xs" align="flex-start">
        {!notifications.supported ? (
          <Text size="sm">
            Notifications require a supported browser. On iPhone, add Pal to
            your Home Screen.
          </Text>
        ) : notifications.denied ? (
          <Text size="sm">
            Allow notifications in your browser or device settings.
          </Text>
        ) : !notifications.ready || !notifications.available ? (
          <Text size="sm">Notifications are unavailable.</Text>
        ) : (
          <Button
            variant="default"
            loading={notifications.busy}
            onClick={() =>
              void (notifications.enabled
                ? notifications.disable()
                : notifications.enable())
            }
          >
            {notifications.enabled
              ? 'Disable notifications'
              : 'Enable notifications'}
          </Button>
        )}
        {notifications.error && (
          <>
            <Text size="sm" role="alert">
              {notifications.error}
            </Text>
            <Button
              variant="default"
              loading={notifications.busy}
              onClick={() => void notifications.retry()}
            >
              Retry
            </Button>
          </>
        )}
      </Stack>
    </section>
  );
}
