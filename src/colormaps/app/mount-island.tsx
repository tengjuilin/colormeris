import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSafely } from '../../ui/flush.ts';

// Mounts a React component into an element the old viewer.ts built (a tab's
// <section>), until the whole page is React. viewer.ts keeps owning the
// element's `hidden` attribute; React owns its children. The first render is
// flushed at once, as the imperative tabs built their DOM before returning.
// `update` merges new props and renders again, at once when it can.

export interface Island<P> {
  update: (next: Partial<P>) => void;
  unmount: () => void;
}

export function mountIsland<P extends object>(host: HTMLElement, Component: ComponentType<P>, initial: P): Island<P> {
  const root = createRoot(host);
  let props = initial;
  const draw = () =>
    root.render(
      <StrictMode>
        <Component {...props} />
      </StrictMode>,
    );
  if (!flushSafely(draw)) draw();
  return {
    update(next) {
      props = { ...props, ...next };
      // Synchronous when called from plain code (a click handler), as the imperative tabs were;
      // flushSafely refuses inside React's own flush, and a plain render then queues.
      if (!flushSafely(draw)) draw();
    },
    unmount: () => root.unmount(),
  };
}
