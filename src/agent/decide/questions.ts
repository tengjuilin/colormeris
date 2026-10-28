// The typed questions asked of the decision model (Jev), one heatmap at a time.

import type { DecisionQuestion } from '../../types/index.ts';

// ---------------------------------------------------------------- questions

// Each request is about one heatmap; descriptions come from the LLM.
export const questions: Record<string, (description?: string) => Record<string, DecisionQuestion>> = {
  // On the whole page: roughly where the heatmap is.
  find: (description) => ({
    present: {
      type: 'noul',
      instructions: `Is there a heatmap (a grid of colored cells) on this page matching: ${description}?`,
    },
    cells: { type: 'box', instructions: `the grid of colored cells of the heatmap described as: ${description}` },
  }),
  // On a crop around it: the cells alone.
  cells: () => ({
    cells: {
      type: 'box',
      instructions:
        'the rectangle of colored heatmap cells in the middle of the image (only the colored cells: not the row labels, column labels, title or colorbar)',
    },
  }),
  side: () => ({
    side: {
      type: 'choice',
      instructions:
        'Where is the colorbar (the strip of graded color with numbers that shows the color scale) of the heatmap in the middle of the image?',
      criteria: {
        right: 'to the right of the cells',
        left: 'to the left of the cells',
        above: 'above the cells',
        below: 'below the cells',
        none: 'there is no colorbar',
      },
    },
  }),
  // On the strip of page beside the cells, with the cells left out.
  bar: () => ({
    bar: {
      type: 'box',
      instructions:
        'the colorbar: the long narrow strip of graded color, from one end to the other (only the colored strip, not its tick labels or title)',
    },
  }),
};

export const decisionQuestions = questions;
