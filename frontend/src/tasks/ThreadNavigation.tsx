import {
  Alert,
  Button,
  Checkbox,
  NavLink,
  Paper,
  ScrollArea,
} from '@mantine/core';
import type { ChatController } from '../chat/use-chat';
import { TaskList } from './TaskList';

export function ThreadNavigation({
  chat,
  onSelect,
}: {
  chat: ChatController;
  onSelect(): void;
}) {
  return (
    <ScrollArea className="task-nav-scroll" type="auto" scrollbarSize={6}>
      <nav id="thread-nav" className="task-nav" aria-label="Chats">
        <NavLink
          component="button"
          id="main-chat"
          className="task-link"
          type="button"
          active={!chat.selectedTaskId}
          aria-current={!chat.selectedTaskId ? 'page' : undefined}
          data-autofocus={!chat.selectedTaskId || undefined}
          disabled={chat.submitting}
          label="Main"
          onClick={() => {
            chat.selectChat();
            onSelect();
          }}
        />
        {chat.selectedTask && (
          <Paper
            component="section"
            className="selected-task"
            aria-label="Selected task"
            withBorder
            radius="md"
            p="md"
          >
            <strong>{chat.selectedTask.title}</strong>
            <span id="task-status">{chat.selectedTask.status}</span>
            <p>{chat.selectedTask.goal}</p>
            {chat.selectedDetails?.description && (
              <p id="task-description">{chat.selectedDetails.description}</p>
            )}
            <Button
              id="archive-task"
              type="button"
              variant="transparent"
              size="compact-sm"
              disabled={!chat.connected || chat.taskSyncing}
              onClick={() => void chat.toggleArchive()}
            >
              {chat.selectedTask.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </Paper>
        )}
        <div className="task-nav-heading">
          <h2>Tasks</h2>
          <Checkbox
            id="archived-tasks"
            label="Archived"
            checked={chat.taskArchived}
            onChange={(event) => chat.setTaskArchived(event.target.checked)}
          />
        </div>
        {chat.taskError && (
          <Alert id="tasks-error" role="alert" color="red">
            {chat.taskError}
          </Alert>
        )}
        <div id="task-list">
          <TaskList
            tasks={chat.tasks}
            selectedTaskId={chat.selectedTaskId}
            disabled={chat.submitting}
            onSelect={(id) => {
              chat.selectChat(id);
              onSelect();
            }}
          />
        </div>
        {!chat.tasks.length && <p id="task-list-empty">No tasks yet.</p>}
        {chat.taskAfter !== null && (
          <Button
            id="more-tasks"
            type="button"
            variant="transparent"
            size="compact-sm"
            disabled={
              chat.taskSyncing || chat.taskLoadingMore || !chat.connected
            }
            onClick={() => void chat.loadMoreTasks()}
          >
            {chat.taskLoadingMore ? 'Loading…' : 'Load more tasks'}
          </Button>
        )}
      </nav>
    </ScrollArea>
  );
}
