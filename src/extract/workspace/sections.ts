// Which sidebar sections are shown (pure). The workspace sets each section's `hidden` from it (renderSidebarDom
// in workspace.ts) and useWorkspace freezes the cards of hidden sections with it, so the two cannot disagree.
import type { ToolHooks, ToolKind } from '../../types/index.ts';

/** Sections shown for every tool once a file is loaded. */
export const FIXED_SECTIONS = ['sec-panels', 'sec-grid', 'sec-colorbar'];

/** The Agent card sits in the slot of the tools it works for instead of their `sections` lists. */
export const AGENT_SECTION = 'sec-agent';
export const AGENT_TOOLS: readonly ToolKind[] = ['heatmap'];

type ToolSections = Pick<ToolHooks, 'kind' | 'sections'>;

/** Whether section `id` is shown with `tool` active; nothing is shown before a file is loaded. */
export function sectionVisible(loaded: boolean, tool: ToolSections, id: string): boolean {
  if (!loaded) return false;
  if (id === AGENT_SECTION) return AGENT_TOOLS.includes(tool.kind);
  return FIXED_SECTIONS.includes(id) || !!tool.sections?.includes(id);
}

/** Every section any of the tools can show, each once. */
export function allSections(tools: Pick<ToolHooks, 'sections'>[]): string[] {
  return [...new Set([...FIXED_SECTIONS, AGENT_SECTION, ...tools.flatMap((t) => t.sections || [])])];
}
