// The tools the LLM may call in decision mode: schemas, argument cleaning and validation, and the SDK tool list.

import { SCALES } from '../../core/colorbar.ts';
import type { ActionArgs, ActionSpec, JsonSchema, LlmTool } from '../../types/index.ts';
import { RUNNER_TOOLS } from '../llm.ts';
import { AGENT_ACTIONS, validate } from '../schema.ts';

const SCALE_NAMES = SCALES;

// Agent actions the LLM may call in this mode. The app counts rows and
// columns; the LLM may only correct a count with correct_grid_size (with a
// reason), not set a grid itself: locate_heatmap places grids.
export const DECISION_LLM_ACTIONS = [
  'go_to_page',
  'select_panel',
  'rename_panel',
  'remove_panel',
  'set_labels',
  'set_colorbar',
  'add_tick',
  'remove_tick',
  'set_colorbar_scale',
  'undo',
];

const panelId: JsonSchema = { type: 'string', description: 'Panel to act on. Defaults to the active panel.' };
const roughBox = (description: string): JsonSchema => ({
  type: 'object',
  properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } },
  required: ['x0', 'y0', 'x1', 'y1'],
  description,
});
const DECISION_QUESTION: JsonSchema = {
  type: 'object',
  properties: {
    type: { enum: ['noul', 'choice', 'score', 'box'] },
    instructions: { type: 'string', description: 'The question, or for box a description of the one target to find.' },
    criteria: {
      description:
        'noul: {true, false} descriptions; choice: {option: description}; score: ordered list of levels; box: none.',
    },
  },
  required: ['type', 'instructions'],
};

// Tools handled by agent/decision-tools.js (plus view_page, view_pages_overview and finish).
export const DECISION_TOOLS: Record<string, ActionSpec> = {
  locate_heatmap: {
    description:
      "Find one heatmap with the decision model and calibrate a panel for it: the grid on its cells (rows and columns counted by the app) and its colorbar. Uses a new panel unless panelId is given or the active panel is still empty. Returns the placement and an image with numbered tick-label boxes, or lettered colorbar candidates when it cannot tell which colorbar is this heatmap's.",
    args: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, description: 'Figure label, e.g. "Fig 2f". Becomes the panel name.' },
        description: {
          type: 'string',
          minLength: 3,
          description: 'What singles this heatmap out on the page: panel letter, title, position, first row label.',
        },
        panelId: { type: 'string', description: 'Re-locate this panel instead of using a new one.' },
        box: roughBox(
          "Only when a first locate found the wrong heatmap: the cells' rough extent in page pixels, read from the page image's rulers. The decision model is not asked; each edge moves at most a few px onto the cells' edge.",
        ),
      },
      required: ['name', 'description'],
    },
  },
  set_ticks: {
    description:
      "Set the colorbar ticks (replaces the panel's ticks), then check the extraction; returns the check and an image of the ticks. Give each tick by its numbered tick-label box (mark), or, when the boxes are missing or wrong, by its place along the colored strip (t). Ticks snap to tick marks. Unless you give a scale, the app picks one that fits: for a binned colorbar, and piecewise for evenly stepped labels at uneven places along a smooth bar.",
    args: {
      type: 'object',
      properties: {
        panelId,
        ticks: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              mark: { type: 'integer', minimum: 1, description: 'Number of the blue box.' },
              t: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description:
                  'Instead of mark: where the label sits along the strip, 0 at its top end (vertical bar) or left end (horizontal bar), 1 at the other end.',
              },
              value: {
                type: 'number',
                description: 'The printed label as a number, with any ×10^n multiplier applied.',
              },
            },
            required: ['value'],
          },
        },
        scale: {
          enum: SCALE_NAMES,
          description:
            'Leave out unless the labels grow by constant factors (log10). piecewise: uneven tick values interpolated between neighbours.',
        },
      },
      required: ['ticks'],
    },
  },
  use_colorbar: {
    description:
      'Give a panel its colorbar: one of the lettered candidates from locate_heatmap (candidate), the colorbar of another panel with its ticks and scale (fromPanel: blocks sharing one colorbar), or a strip at a rough box in page pixels (box) when none was found. Returns numbered tick-label boxes for set_ticks (except with fromPanel, which checks the panel).',
    args: {
      type: 'object',
      properties: {
        panelId,
        candidate: {
          type: 'string',
          minLength: 1,
          maxLength: 2,
          description: 'Letter of a colorbar candidate, e.g. "B".',
        },
        fromPanel: { type: 'string', description: 'Id of a panel whose colorbar this heatmap shares.' },
        box: roughBox("The colored strip's rough extent in page pixels, from the page rulers."),
      },
    },
  },
  correct_grid_size: {
    description:
      "Correct the app's row and column count of a panel when the image shows it is wrong: magenta lines that merge or split cells, or a strip without cell borders. Count cell edges in the image; count labels only where there are no edges (one label can cover several replicate cells). With box (the cells' rough extent from the page rulers) the grid's outer edges also move onto the cells (at most a few px each); without it the corners stay. Then checks the extraction.",
    args: {
      type: 'object',
      properties: {
        panelId,
        rows: { type: 'integer', minimum: 1, maximum: 500 },
        cols: { type: 'integer', minimum: 1, maximum: 500 },
        reason: {
          type: 'string',
          minLength: 3,
          description: 'What in the image shows the count, e.g. "3 replicate cells under each column label".',
        },
        box: roughBox("Only when the outer grid lines miss the cells: the cells' rough extent in page pixels."),
      },
      required: ['rows', 'cols', 'reason'],
    },
  },
  check_printed: {
    description:
      'Cross-check a calibrated panel against numbers printed in its cells: give 3–5 cells spread over the heatmap (with the lowest and highest printed numbers) and the numbers as printed. The app compares them with the values it extracted from the colors and says whether they agree; a disagreement that grows with the value or shifts all of them points at wrong tick values or colorbar ends. The colors stay the values.',
    args: {
      type: 'object',
      properties: {
        panelId,
        cells: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              row: { type: 'integer', minimum: 1, description: 'Row number, 1 at the top.' },
              col: { type: 'integer', minimum: 1, description: 'Column number, 1 at the left.' },
              value: { type: 'number', description: 'The number printed in that cell.' },
            },
            required: ['row', 'col', 'value'],
          },
        },
      },
      required: ['cells'],
    },
  },
  check_panel: {
    description:
      "Check a panel again: whether it is ready, whether its tick values fit the scale, and how many cells are far from the colorbar's colors, off it or past its ends.",
    args: { type: 'object', properties: { panelId } },
  },
  ask: {
    description:
      'Ask the decision model your own questions about one region of the current page (no rulers in its image). Box answers come back in page pixels. Use it rarely, for one heatmap at a time.',
    args: {
      type: 'object',
      properties: {
        region: roughBox('Area in page pixels. Omit for the whole page.'),
        overlay: { enum: ['none', 'calibration', 'reconstruction'] },
        questions: { type: 'object', description: 'Up to 6 questions by id: {id: {type, instructions, criteria}}.' },
      },
      required: ['questions'],
    },
  },
};

// Models send null for optional arguments they do not use ({mark: 2, t:
// null}); those mean "not given" (as normalizeArgs does for the agent API).
export function cleanDecisionArgs(name: string, args: ActionArgs | null): ActionArgs | null {
  const drop = (o: ActionArgs): ActionArgs => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const out = args && typeof args === 'object' ? drop(args) : args;
  if (name === 'set_ticks' && Array.isArray(out?.ticks))
    out.ticks = out.ticks.map((k: unknown) => (k && typeof k === 'object' ? drop(k as ActionArgs) : k));
  return out;
}

export function validateDecisionTool(name: string, args: ActionArgs) {
  const errs = validate(DECISION_TOOLS[name].args, args);
  if (name === 'ask' && !errs.length) {
    const qs = Object.entries(args.questions as Record<string, Record<string, unknown>>);
    if (!qs.length || qs.length > 6) errs.push('args.questions: give 1 to 6 questions');
    for (const [id, q] of qs) {
      errs.push(...validate(DECISION_QUESTION, q, `args.questions.${id}`));
      if (q.type === 'score' && !Array.isArray(q.criteria))
        errs.push(`args.questions.${id}.criteria: a score needs a list of levels`);
      if (q.type === 'choice' && (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)))
        errs.push(`args.questions.${id}.criteria: a choice needs {option: description}`);
    }
  }
  if (name === 'set_ticks' && !errs.length) {
    (args.ticks as { mark?: unknown; t?: unknown }[]).forEach((k, i) => {
      if ((k.mark === undefined) === (k.t === undefined)) errs.push(`args.ticks[${i}]: give exactly one of mark or t`);
    });
  }
  if (
    name === 'use_colorbar' &&
    !errs.length &&
    ['candidate', 'fromPanel', 'box'].filter((k) => args[k] !== undefined).length !== 1
  ) {
    errs.push('args: give exactly one of candidate, fromPanel or box');
  }
  return errs;
}

// Tool definitions in the SDK's chat format.
export function decisionLlmTools() {
  const fn = (name: string, description: string, parameters: JsonSchema): LlmTool => ({
    type: 'function',
    function: { name, description, parameters },
  });
  return [
    ...Object.entries(DECISION_TOOLS).map(([n, t]) => fn(n, t.description, t.args)),
    ...DECISION_LLM_ACTIONS.map((n) => fn(n, AGENT_ACTIONS[n].description, AGENT_ACTIONS[n].args)),
    ...['view_page', 'view_pages_overview', 'finish'].map((n) =>
      fn(n, RUNNER_TOOLS[n].description, RUNNER_TOOLS[n].args),
    ),
  ];
}
