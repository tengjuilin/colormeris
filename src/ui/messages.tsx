// Hint (live status text) and Notice (a problem). Both render nothing when they have no content, like the
// CSS that collapses empty .hint and .notice elements. With an `id` they stay in the DOM, empty, so lookups
// by id keep working and `:empty` collapses them.
import { Children, type ReactNode } from 'react';

const isEmpty = (children: ReactNode) => Children.toArray(children).every((c) => c === '');

interface MessageProps {
  children?: ReactNode;
  id?: string;
  className?: string;
}

function message(base: string, { children, id, className }: MessageProps) {
  const empty = isEmpty(children);
  if (empty && !id) return null;
  return (
    <p id={id} className={className ? `${base} ${className}` : base}>
      {empty ? null : children}
    </p>
  );
}

export const Hint = (props: MessageProps) => message('hint', props);
export const Notice = (props: MessageProps) => message('notice', props);
