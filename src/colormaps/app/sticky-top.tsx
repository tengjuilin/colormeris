import { forwardRef, type ReactNode } from 'react';

// The sticky bar: tabs, Browse controls and column names share it, so they
// stay readable while scrolling instead of one floating header per section.
// The scroll anchor measures it, hence the ref.
export const StickyTop = forwardRef<HTMLDivElement, { children: ReactNode }>(function StickyTop({ children }, ref) {
  return (
    <div className="cmap-top" ref={ref}>
      {children}
    </div>
  );
});
