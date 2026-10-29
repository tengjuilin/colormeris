// Selectable items: Chip (button.chip with optional status dot and meta text) and ChipList (ul.chip-list,
// one li per child).
import { Children, type ComponentProps, isValidElement, type ReactNode } from 'react';

export function Chip({
  pressed,
  onClick,
  title,
  dot,
  meta,
  icon,
  className,
  children,
  ...rest
}: Omit<ComponentProps<'button'>, 'type'> & {
  /** Selected (aria-pressed); leave undefined for chips that only navigate. */
  pressed?: boolean;
  /** Status dot: `pending` is gray, `done` green, `rejected` red. */
  dot?: 'pending' | 'done' | 'rejected';
  meta?: ReactNode;
  /** Element before the label (a shape swatch). */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      type="button"
      className={className ? `chip ${className}` : 'chip'}
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
    >
      {dot ? <span className={dot === 'pending' ? 'status-dot' : `status-dot ${dot}`} /> : null}
      {icon}
      <span className="chip-label">{children}</span>
      {meta !== undefined && meta !== null ? <span className="chip-meta">{meta}</span> : null}
    </button>
  );
}

export function ChipList({ children, id, ...rest }: { children?: ReactNode; id?: string; 'aria-label'?: string }) {
  return (
    <ul id={id} aria-label={rest['aria-label']} className="chip-list">
      {Children.toArray(children).map((child) => (
        <li key={isValidElement(child) ? child.key : String(child)}>{child}</li>
      ))}
    </ul>
  );
}
