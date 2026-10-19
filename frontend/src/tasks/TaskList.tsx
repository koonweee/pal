import { NavLink } from '@mantine/core';
import type { Task } from '../api/client';

export function TaskList({
  disabled,
  onSelect,
  selectedTaskId,
  tasks,
}: {
  disabled: boolean;
  onSelect(id: string): void;
  selectedTaskId?: string;
  tasks: Task[];
}) {
  return (
    <>
      {tasks.map((task) => (
        <NavLink
          component="button"
          key={task.id}
          type="button"
          className="task-link"
          data-task-id={task.id}
          active={task.id === selectedTaskId}
          aria-current={task.id === selectedTaskId ? 'page' : undefined}
          data-autofocus={task.id === selectedTaskId || undefined}
          disabled={disabled}
          label={<strong>{task.title}</strong>}
          description={task.status}
          onClick={() => onSelect(task.id)}
        />
      ))}
    </>
  );
}
