// Pure parts of agent decision mode, split by concern in decide/. This barrel keeps the old import path and
// exports what decision-tools.ts, runner.ts, the docs script and the tests use:
//   brief.ts           panelBrief (a short panel for tool results)
//   cells.ts           snapCells (the decision model's boxes → cell pixels)
//   check.ts           checkSummary, printedCheck
//   choose-colorbar.ts chooseColorbar
//   geometry.ts        boxToPage, growBox, besideBox, barLine, tFromTopLeft, boxToSpan; area, overlaps, iou, union, cornersBox
//   grid-plan.ts       planGrid, planCounts, gridNeighbours, regridOthers
//   prompt.ts          DECISION_SYSTEM_PROMPT, DEFAULT_DECISION_MODEL
//   questions.ts       decisionQuestions (asked of the decision model)
//   strip-side.ts      besideCheck, nearCheck, sideOf, flankInk
//   strips.ts          pageColorbars, stripCandidate, tickBoxesText
//   ticks.ts           tickMisfit, scaleForBins, scaleForTicks, scaleNote
//   tools.ts           DECISION_TOOLS, DECISION_LLM_ACTIONS, decisionLlmTools, cleanDecisionArgs, validateDecisionTool
//   views.ts           VIEW (image sizes, margins, thresholds), regions, texts about boxes and candidates
//   types.ts           shared types

export { panelBrief } from './decide/brief.ts';
export { snapCells } from './decide/cells.ts';
export { checkSummary, printedCheck } from './decide/check.ts';
export { chooseColorbar } from './decide/choose-colorbar.ts';
export {
  area,
  barLine,
  besideBox,
  boxToPage,
  boxToSpan,
  cornersBox,
  growBox,
  iou,
  overlaps,
  tFromTopLeft,
  union,
} from './decide/geometry.ts';
export { gridNeighbours, planCounts, planGrid, regridOthers } from './decide/grid-plan.ts';
export { DECISION_SYSTEM_PROMPT, DEFAULT_DECISION_MODEL } from './decide/prompt.ts';
export { decisionQuestions } from './decide/questions.ts';
export { besideCheck, flankInk } from './decide/strip-side.ts';
export { pageColorbars, stripCandidate, tickBoxesText } from './decide/strips.ts';
export { scaleForBins, scaleForTicks, scaleNote, tickMisfit } from './decide/ticks.ts';
export {
  cleanDecisionArgs,
  DECISION_LLM_ACTIONS,
  DECISION_TOOLS,
  decisionLlmTools,
  validateDecisionTool,
} from './decide/tools.ts';
export {
  boxText,
  CANDIDATE_COLOR,
  candidateLines,
  clipBox,
  likelySides,
  orientation,
  regions,
  sideGap,
  VIEW,
  where,
} from './decide/views.ts';
