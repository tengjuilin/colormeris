import { setupColormapViewer, showStartupError } from '../colormaps/viewer.ts';

// Scripts are deferred, so the DOM is parsed when this runs.
const root = typeof document !== 'undefined' && document.getElementById('cmap-root');
if (root) {
  try {
    setupColormapViewer(root);
  } catch (err) {
    showStartupError(err);
  }
}
