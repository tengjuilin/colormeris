// A labelled checkbox (label.check).
import type { ComponentProps, ReactNode } from 'react';

export function Check({
  label,
  checked,
  onChange,
  title,
  small,
  className,
  ...rest
}: Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked' | 'title' | 'className'> & {
  label: ReactNode;
  /** Extra classes for the label. */
  className?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  small?: boolean;
}) {
  return (
    <label className={['check', small && 'small', className].filter(Boolean).join(' ')} title={title}>
      <input {...rest} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
