import { createAgentApi } from '../agent/api.ts';
import { setupAgentPanel } from '../agent/ui/agent-card.ts';
import { setupLabelReader } from '../agent/ui/labels-reader.ts';
import { setupHeatmapTool } from '../extract/heatmap/heatmap-tool.ts';
import { setupMapTool } from '../extract/map/map-tool.ts';
import { setupRoiTool } from '../extract/roi/roi-tool.ts';
import { setupSettings } from '../extract/settings/settings-dialog.ts';
import { createWorkspace } from '../extract/workspace/workspace.ts';
import * as m_core_color from '../core/color.ts';
import * as m_core_cvd from '../core/cvd.ts';
import * as m_core_grid from '../core/grid.ts';
import * as m_core_colorbar from '../core/colorbar.ts';
import * as m_core_locate from '../core/locate.ts';
import * as m_core_colormapMatch from '../core/colormap-match.ts';
import * as m_core_colormapLibrary from '../core/colormap-library.ts';
import * as m_project_project from '../extract/project/project.ts';
import * as m_project_projectFiles from '../extract/project/project-files.ts';
import * as m_settings_settings from '../extract/settings/settings.ts';
import * as m_heatmap_sampling from '../extract/heatmap/sampling.ts';
import * as m_roi_geometry from '../extract/roi/geometry.ts';
import * as m_roi_quantify from '../extract/roi/quantify.ts';
import * as m_map_field from '../extract/map/field.ts';
import * as m_agent_schema from '../agent/schema.ts';
import * as m_agent_llm from '../agent/llm.ts';
import * as m_agent_decide from '../agent/decide.ts';
import * as m_agent_labels from '../agent/labels.ts';

// One page, three tools sharing one workspace: the loaded file, pages and
// project (with every tool's panels) persist when switching tools. The tool
// follows the URL hash (#heatmap, #roi or #map) so links and reloads keep it.

// If anything here fails (a script that did not load, a stale cached file),
// say so on the page. Otherwise the example buttons work but no tool exists.
function showStartupError(err: unknown) {
  console.error(err);
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;padding:10px 14px;background:#b3261e;color:#fff;font:14px system-ui,sans-serif';
  el.textContent = `Colormeris could not start (${(err as Error)?.message || err}). Try a hard refresh (Ctrl+Shift+R). If it persists, report the first error in the browser console.`;
  document.body.prepend(el);
}

// Browser debugging: `Colormeris.someFn` in the console reaches the pure
// modules, as it did when every script registered on globalThis.Colormeris.
if (import.meta.env.DEV) {
  globalThis.Colormeris = Object.freeze(Object.assign({}, m_core_color, m_core_cvd, m_core_grid, m_core_colorbar, m_core_locate, m_core_colormapMatch, m_core_colormapLibrary, m_project_project, m_project_projectFiles, m_settings_settings, m_heatmap_sampling, m_roi_geometry, m_roi_quantify, m_map_field, m_agent_schema, m_agent_llm, m_agent_decide, m_agent_labels));
}

try {
  const ws = createWorkspace();
  // Settings dialog (settings-dialog.ts): loads the stored settings into ws.settings.
  const settings = setupSettings(ws);
  setupHeatmapTool(ws);
  setupRoiTool(ws);
  setupMapTool(ws);

  const toolFromHash = () => (({ '#roi': 'roi', '#map': 'map' }) as const)[location.hash as '#roi' | '#map'] || 'heatmap';
  ws.setTool(toolFromHash());
  window.addEventListener('hashchange', () => ws.setTool(toolFromHash()));
  ws.render();

  // Typed API for software agents (agent/api.ts).
  window.colormeris = createAgentApi(ws);
  // LLM agent for heatmaps (agent/ui/agent-card.ts, agent/runner.ts).
  setupAgentPanel(ws, window.colormeris, settings);
  // Grid card: read row and column labels with a vision LLM (agent/ui/labels-reader.ts).
  setupLabelReader(ws, settings);
} catch (err) {
  showStartupError(err);
}
