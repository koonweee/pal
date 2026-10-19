import { ActionIcon, Tooltip, type ActionIconProps } from '@mantine/core';
import {
  forwardRef,
  type AriaAttributes,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from 'react';

interface IconActionProps extends Omit<ActionIconProps, 'aria-label'> {
  label: string;
  tooltipLabel?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: AriaAttributes['aria-haspopup'];
  'aria-pressed'?: AriaAttributes['aria-pressed'];
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onMouseEnter?: MouseEventHandler<HTMLButtonElement>;
  onMouseLeave?: MouseEventHandler<HTMLButtonElement>;
  onMouseDownCapture?: MouseEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
  onPointerDownCapture?: PointerEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
}

export const IconAction = forwardRef<HTMLButtonElement, IconActionProps>(
  function IconAction({ label, tooltipLabel, children, ...props }, ref) {
    const className = props.className
      ? `pal-icon-action ${props.className}`
      : 'pal-icon-action';
    const action = (
      <ActionIcon ref={ref} aria-label={label} {...props} className={className}>
        {children}
      </ActionIcon>
    );
    return tooltipLabel === null ? (
      action
    ) : (
      <Tooltip label={tooltipLabel ?? label}>{action}</Tooltip>
    );
  },
);
