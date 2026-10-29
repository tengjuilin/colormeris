import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColormapsApp } from '../colormaps/app/colormaps-app.tsx';

// The colormap viewer's entry (colormaps.html): React renders the whole page
// into #cmap-root (no JSX here, so the page's script name stays .ts).

export function showStartupError(err: unknown) {
  console.error(err);
  const e = document.createElement('div');
  e.setAttribute('role', 'alert');
  e.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99;padding:10px 14px;background:#b3261e;color:#fff;font:14px system-ui,sans-serif';
  e.textContent = `The colormap viewer could not start (${(err as Error)?.message || err}). Try a hard refresh (Ctrl+Shift+R). If it persists, report the first error in the browser console.`;
  document.body.prepend(e);
}

// Scripts are deferred, so the DOM is parsed when this runs. React reports an
// error thrown while rendering to the banner. The app is imported statically:
// a dynamic import would catch import-time errors too, but delays the first
// rows by ~37 ms (the old viewer didn't catch those either).
const root = typeof document !== 'undefined' && document.getElementById('cmap-root');
if (root) {
  try {
    createRoot(root, { onUncaughtError: showStartupError }).render(
      createElement(StrictMode, null, createElement(ColormapsApp)),
    );
  } catch (err) {
    showStartupError(err);
  }
}
