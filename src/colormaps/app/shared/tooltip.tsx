import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { getTooltip, type Tooltip } from '../../tooltip-element.ts';

// The colormap tooltip for React components. There is one .cmap-tip on the
// page (tooltip-element.ts, also used by the plots); the provider
// hands out its handle, hides it when `tab` changes (it must not hang over a
// tab the pointer has left) and drops the pending "Copied" timer on unmount.

export type TooltipApi = Tooltip;

const NOOP: TooltipApi = { showTip() {}, hideTip() {}, flashCopied() {}, cancelCopied() {} };
const TooltipContext = createContext<TooltipApi>(NOOP);

/** The tooltip handle; a no-op outside a TooltipProvider. */
export function useTooltip(): TooltipApi {
  return useContext(TooltipContext);
}

export function TooltipProvider({ tab, children }: { tab?: string; children: ReactNode }) {
  const api = getTooltip();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` is the trigger, not an input
  useEffect(() => {
    api.hideTip();
  }, [api, tab]);
  useEffect(() => () => api.cancelCopied(), [api]);
  return <TooltipContext.Provider value={api}>{children}</TooltipContext.Provider>;
}
