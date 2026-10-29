import { type RefObject, useEffect } from 'react';
import { anchorPopover } from '../../common.ts';

// Places a native popover under its button (common.ts anchorPopover) while the
// component is mounted. The cleanup removes what it added, so StrictMode's
// second mount does not stack listeners.
export function useAnchorPopover(btn: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!btn.current || !pop.current) return;
    return anchorPopover(btn.current, pop.current);
  }, [btn, pop]);
}
