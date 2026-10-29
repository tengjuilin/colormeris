import { type CSSProperties, useLayoutEffect, useRef } from 'react';

// Hosts an SVG (or any element) built imperatively by a plots.ts builder
// (linePlot, figure, ...). The builder runs in a layout effect and its result
// replaces the host's children. Give `build` a stable identity (useCallback /
// useMemo on its inputs): it runs again whenever the identity changes. The host
// is display: contents, so it adds no box.

const CONTENTS: CSSProperties = { display: 'contents' };

export interface SvgFigureProps {
  build: () => Element | null;
  className?: string;
}

export function SvgFigure({ build, className }: SvgFigureProps) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    const made = build();
    if (made) h.replaceChildren(made);
    else h.replaceChildren();
    return () => h.replaceChildren();
  }, [build]);
  return <div ref={host} className={className} style={className ? undefined : CONTENTS} />;
}
