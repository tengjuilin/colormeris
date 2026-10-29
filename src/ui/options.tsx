// details.options: the disclosure for rarely changed settings, with an optional note in the summary.
// Uncontrolled, so the open state survives re-renders.
import type { ReactNode } from 'react';

export function Options({
  summary,
  note,
  hidden,
  id,
  open,
  onToggle,
  children,
}: {
  summary: ReactNode;
  /** Short status text after the summary (`.summary-note`). */
  note?: ReactNode;
  hidden?: boolean;
  id?: string;
  /** Control the open state; leave out to let the browser keep it. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className="options"
      hidden={hidden}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary>
        {summary}
        {note !== undefined ? (
          <>
            {' '}
            <span className="summary-note">{note}</span>
          </>
        ) : null}
      </summary>
      <div className="options-body">{children}</div>
    </details>
  );
}
