// Pure parts of agent decision mode, split by concern in decide/. This barrel keeps the old import path.

export { panelBrief } from './decide/brief.ts';
export { snapCells } from './decide/cells.ts';
export type { PrintedPair } from './decide/check.ts';
export { checkSummary, printedCheck } from './decide/check.ts';
export { cellLabels, chooseColorbar } from './decide/choose-colorbar.ts';
export { barLine, besideBox, boxToPage, boxToSpan, growBox, tFromTopLeft } from './decide/geometry.ts';
export { gridNeighbours, planCounts, planGrid, regridOthers } from './decide/grid-plan.ts';
export { DECISION_SYSTEM_PROMPT, DEFAULT_DECISION_MODEL } from './decide/prompt.ts';
export { decisionQuestions } from './decide/questions.ts';
export { besideCheck, flankInk, nearCheck, sideOf } from './decide/strip-side.ts';
export { pageColorbars, stripCandidate, tickBoxesText } from './decide/strips.ts';
export { scaleForBins, scaleForTicks, tickMisfit } from './decide/ticks.ts';
export {
  cleanDecisionArgs,
  DECISION_LLM_ACTIONS,
  DECISION_TOOLS,
  decisionLlmTools,
  validateDecisionTool,
} from './decide/tools.ts';
export type { CountDetection, CountFit, CountPlan, Neighbours, PlacedPanel, StripInfo } from './decide/types.ts';
