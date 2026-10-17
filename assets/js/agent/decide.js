(function (CM) {
  'use strict';
  const { AGENT_ACTIONS, RUNNER_TOOLS, validate } = CM;

  // Pure parts of "agent decision" mode (agent/decision-tools.js runs them).
  // The LLM reads the page and writes short descriptions; a decision model
  // (Jev by default, through OpenRouter's Decisions API) answers typed
  // questions about one heatmap at a time: where its cells are (box), which
  // side its colorbar is on (choice) and where that colorbar is (box). Code
  // snaps the rough boxes to pixels (core/locate.js) and the app counts rows
  // and columns itself (core/grid.js fitCellCounts). Measured on example.pdf
  // page 5 (10 heatmaps): box edges come back with two decimals, so a
  // page-wide box is ~20 px off and a second box on a crop ~5 px; after
  // snapping, all 10 cell blocks and colorbars were exact. Jev could not box
  // small tick-label text or count cells reliably, so tick labels are found
  // by code and read by the LLM, and counts come from the pixels.

  const DEFAULT_DECISION_MODEL = 'typesafe/jev-1.14';

  const SYSTEM_PROMPT = `You are the extraction agent of Colormeris, a tool that turns colors in scientific figures back into numbers. Your job: find every gridded heatmap on the pages you are given and get one calibrated panel per heatmap. You work with a decision model that locates things in page images; the app snaps its boxes to pixels and counts rows and columns by itself. You read text and describe targets. Do not place coordinates yourself unless a tool says it failed.

For each page:
1. Look at the page image. List in your message EVERY heatmap (a grid of colored cells with a colorbar) with its figure label. Skip photos, line or scatter plots, and tables.
2. Call locate_heatmap once per heatmap, all in the same turn. name: the panel's label as printed (e.g. "Fig 2f" when the figure number is visible, else "f"); never the page number. description: what singles it out on the page: panel letter, title, position (e.g. "upper left, right of panel e"), and its first row label.
3. Each result has an image of that heatmap: magenta grid lines as placed, the orange colorbar line, and the colorbar's tick labels in blue boxes numbered 1, 2, 3… For every heatmap, in one turn:
   - set_ticks: the printed value of each numbered box that is a colorbar tick label, as {mark, value}. Skip boxes on anything else (a title, a ×10^n note: apply that multiplier to the values instead). Use scale "log10" when the labels grow by constant factors (1, 10, 100).
   - set_labels: row labels top to bottom and column labels left to right, exactly as printed. Labels may cover groups of cells; that is fine.
4. set_ticks returns the app's check. If it fails, find the cause from the image (a misread or misassigned tick value, the wrong heatmap, a colorbar missing or cut) and fix it once: set_ticks again, or locate_heatmap again with panelId and a better description. If the grid lines miss the cells, say so in finish; do not change the grid size.
5. When every heatmap of every page is done, call finish with one line per panel and anything a human should check. Keep your messages short.`;

  // Agent actions the LLM may call in this mode. No grid size: the app owns it.
  // set_grid is left out too: it counts again, and locate_heatmap places grids.
  const DECISION_LLM_ACTIONS = ['go_to_page', 'select_panel', 'rename_panel', 'remove_panel', 'set_labels', 'set_colorbar', 'add_tick', 'remove_tick', 'set_colorbar_scale', 'undo'];

  const panelId = { type: 'string', description: 'Panel to act on. Defaults to the active panel.' };
  const DECISION_QUESTION = {
    type: 'object',
    properties: {
      type: { enum: ['noul', 'choice', 'score', 'box'] },
      instructions: { type: 'string', description: 'The question, or for box a description of the one target to find.' },
      criteria: { description: 'noul: {true, false} descriptions; choice: {option: description}; score: ordered list of levels; box: none.' },
    },
    required: ['type', 'instructions'],
  };

  // Tools handled by agent/decision-tools.js (plus view_page, view_pages_overview and finish).
  const DECISION_TOOLS = {
    locate_heatmap: {
      description: 'Find one heatmap with the decision model and calibrate a panel for it: the grid on its cells (rows and columns counted by the app) and the colorbar on its strip. Uses a new panel unless panelId is given or the active panel is still empty. Returns the placement and an image with numbered tick-label boxes.',
      args: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, description: 'Figure label, e.g. "Fig 2f". Becomes the panel name.' },
          description: { type: 'string', minLength: 3, description: 'What singles this heatmap out on the page: panel letter, title, position, first row label.' },
          panelId: { type: 'string', description: 'Re-locate this panel instead of using a new one.' },
        },
        required: ['name', 'description'],
      },
    },
    set_ticks: {
      description: 'Set the colorbar ticks from the numbered tick-label boxes of locate_heatmap (replaces the panel\'s ticks), then check the extraction. Each tick snaps to its tick mark.',
      args: {
        type: 'object',
        properties: {
          panelId,
          ticks: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              properties: { mark: { type: 'integer', minimum: 1, description: 'Number of the blue box.' }, value: { type: 'number', description: 'The printed label as a number, with any ×10^n multiplier applied.' } },
              required: ['mark', 'value'],
            },
          },
          scale: { enum: ['linear', 'log10'] },
        },
        required: ['ticks'],
      },
    },
    check_panel: {
      description: 'Check a panel again: whether it is ready, whether its tick values lie on a straight line along the bar, and how many cells are far from the colorbar\'s colors.',
      args: { type: 'object', properties: { panelId } },
    },
    ask: {
      description: 'Ask the decision model your own questions about one region of the current page (no rulers in its image). Box answers come back in page pixels. Use it rarely, for one heatmap at a time.',
      args: {
        type: 'object',
        properties: {
          region: { type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, required: ['x0', 'y0', 'x1', 'y1'], description: 'Area in page pixels. Omit for the whole page.' },
          overlay: { enum: ['none', 'calibration', 'reconstruction'] },
          questions: { type: 'object', description: 'Up to 6 questions by id: {id: {type, instructions, criteria}}.' },
        },
        required: ['questions'],
      },
    },
  };

  function validateDecisionTool(name, args) {
    const errs = validate(DECISION_TOOLS[name].args, args);
    if (name === 'ask' && !errs.length) {
      const qs = Object.entries(args.questions);
      if (!qs.length || qs.length > 6) errs.push('args.questions: give 1 to 6 questions');
      for (const [id, q] of qs) {
        errs.push(...validate(DECISION_QUESTION, q, `args.questions.${id}`));
        if (q.type === 'score' && !Array.isArray(q.criteria)) errs.push(`args.questions.${id}.criteria: a score needs a list of levels`);
        if (q.type === 'choice' && (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria))) errs.push(`args.questions.${id}.criteria: a choice needs {option: description}`);
      }
    }
    return errs;
  }

  // Tool definitions in the SDK's chat format.
  function decisionLlmTools() {
    const fn = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
    return [
      ...Object.entries(DECISION_TOOLS).map(([n, t]) => fn(n, t.description, t.args)),
      ...DECISION_LLM_ACTIONS.map((n) => fn(n, AGENT_ACTIONS[n].description, AGENT_ACTIONS[n].args)),
      ...['view_page', 'view_pages_overview', 'finish'].map((n) => fn(n, RUNNER_TOOLS[n].description, RUNNER_TOOLS[n].args)),
    ];
  }

  // ---------------------------------------------------------------- questions

  // Each request is about one heatmap; descriptions come from the LLM.
  const questions = {
    // On the whole page: roughly where the heatmap is.
    find: (description) => ({
      present: { type: 'noul', instructions: `Is there a heatmap (a grid of colored cells) on this page matching: ${description}?` },
      cells: { type: 'box', instructions: `the grid of colored cells of the heatmap described as: ${description}` },
    }),
    // On a crop around it: the cells alone.
    cells: () => ({
      cells: { type: 'box', instructions: 'the rectangle of colored heatmap cells in the middle of the image (only the colored cells: not the row labels, column labels, title or colorbar)' },
    }),
    side: () => ({
      side: {
        type: 'choice',
        instructions: 'Where is the colorbar (the strip of graded color with numbers that shows the color scale) of the heatmap in the middle of the image?',
        criteria: { right: 'to the right of the cells', left: 'to the left of the cells', above: 'above the cells', below: 'below the cells', none: 'there is no colorbar' },
      },
    }),
    // On the strip of page beside the cells, with the cells left out.
    bar: () => ({
      bar: { type: 'box', instructions: 'the colorbar: the long narrow strip of graded color, from one end to the other (only the colored strip, not its tick labels or title)' },
    }),
  };

  // Whether a strip found on `side` of the cells can be their colorbar:
  // close to them (a neighbour's colorbar is further away), running along
  // them for at least half its length, a strip rather than a line, and with its tick labels (`labelSide`
  // from findTickLabels, if any) on its far side: a colorbar's labels face
  // away from its own heatmap. On example.pdf page 3, panel h's colorbar sits
  // 72 px left of panel i with its labels towards i.
  function besideCheck(cells, bar, side, labelSide = null) {
    if (labelSide && labelSide !== side) return false;
    const vertical = side === 'left' || side === 'right';
    const gap = side === 'right' ? bar.x0 - cells.x1 : side === 'left' ? cells.x0 - bar.x1 : side === 'below' ? bar.y0 - cells.y1 : cells.y0 - bar.y1;
    const reach = Math.max(40, 0.25 * (vertical ? cells.x1 - cells.x0 : cells.y1 - cells.y0));
    const [a0, a1, c0, c1] = vertical ? [bar.y0, bar.y1, cells.y0, cells.y1] : [bar.x0, bar.x1, cells.x0, cells.x1];
    const overlap = Math.min(a1, c1) - Math.max(a0, c0);
    // A strip at least 4 px thick and 30% as long as the cells (not a line or speck).
    const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
    return gap >= -2 && gap <= reach && overlap >= 0.5 * (a1 - a0) && thick >= 4 && a1 - a0 >= 0.3 * (c1 - c0);
  }

  // A box answer (fractions of the image) → page pixels. `frame` describes
  // the image: page point (x0, y0) at image pixel (0, 0), `scale` image
  // pixels per page pixel, `width` × `height` image pixels.
  function boxToPage(box, frame) {
    const f = (v) => Math.round(v * 10) / 10;
    return {
      x0: f(frame.x0 + (box.left * frame.width) / frame.scale),
      y0: f(frame.y0 + (box.top * frame.height) / frame.scale),
      x1: f(frame.x0 + (box.right * frame.width) / frame.scale),
      y1: f(frame.y0 + (box.bottom * frame.height) / frame.scale),
    };
  }

  // A box grown by `f` of its size plus `px` on every side, kept on the page.
  function growBox(b, f, px, width, height) {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    return { x0: Math.max(0, b.x0 - w * f - px), y0: Math.max(0, b.y0 - h * f - px), x1: Math.min(width, b.x1 + w * f + px), y1: Math.min(height, b.y1 + h * f + px) };
  }

  // The strip of page beside the cells where a colorbar on `side` must be,
  // leaving the cells out so the box question cannot pick them.
  function besideBox(cells, side, width, height) {
    const w = cells.x1 - cells.x0;
    const h = cells.y1 - cells.y0;
    const reachX = Math.max(80, 0.6 * w);
    const reachY = Math.max(80, 0.6 * h);
    const b =
      side === 'right' ? { x0: cells.x1 + 1, y0: cells.y0 - 0.25 * h, x1: cells.x1 + reachX, y1: cells.y1 + 0.25 * h }
      : side === 'left' ? { x0: cells.x0 - reachX, y0: cells.y0 - 0.25 * h, x1: cells.x0 - 1, y1: cells.y1 + 0.25 * h }
      : side === 'above' ? { x0: cells.x0 - 0.25 * w, y0: cells.y0 - reachY, x1: cells.x1 + 0.25 * w, y1: cells.y0 - 1 }
      : { x0: cells.x0 - 0.25 * w, y0: cells.y1 + 1, x1: cells.x1 + 0.25 * w, y1: cells.y1 + reachY };
    return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(width, b.x1), y1: Math.min(height, b.y1) };
  }

  // Colorbar line from the strip's box: along its long axis through the
  // middle, low end first (bottom of a vertical bar, left of a horizontal one).
  function barLine(bar) {
    const mx = (bar.x0 + bar.x1) / 2;
    const my = (bar.y0 + bar.y1) / 2;
    return bar.y1 - bar.y0 >= bar.x1 - bar.x0
      ? { start: { x: mx, y: bar.y1 - 1 }, end: { x: mx, y: bar.y0 } }
      : { start: { x: bar.x0, y: my }, end: { x: bar.x1 - 1, y: my } };
  }

  // Ticks [{t, value}] that do not lie on one straight line along the bar
  // (in log10 for a log bar): the worst one's index and its miss as a share
  // of the value range, or null with fewer than 3 ticks. A misread label
  // ("25" for "2.5") or a value given to the wrong box shows up here. (A
  // check of the reconstruction cannot see tick values: it repaints colors
  // by position along the bar. Jev also judged correct reconstructions as
  // wrong, 0.27–0.45 on example.pdf page 5, so it is not asked.)
  function tickMisfit(ticks, scale = 'linear') {
    if (ticks.length < 3) return null;
    const v = ticks.map((k) => (scale === 'log10' ? Math.log10(k.value) : k.value));
    if (v.some((x) => !Number.isFinite(x))) return null;
    const n = ticks.length;
    const mt = ticks.reduce((a, k) => a + k.t, 0) / n;
    const mv = v.reduce((a, x) => a + x, 0) / n;
    let stt = 0;
    let stv = 0;
    ticks.forEach((k, i) => {
      stt += (k.t - mt) ** 2;
      stv += (k.t - mt) * (v[i] - mv);
    });
    if (!stt) return null;
    const slope = stv / stt;
    const range = Math.max(...v) - Math.min(...v) || 1;
    let worst = { index: 0, miss: 0 };
    ticks.forEach((k, i) => {
      const miss = Math.abs(v[i] - (mv + slope * (k.t - mt))) / range;
      if (miss > worst.miss) worst = { index: i, miss };
    });
    return worst;
  }

  // The app's own check of a panel after set_ticks.
  function checkSummary({ problem, flagged = 0, cells = 0, misfit = null, mark = null }) {
    const parts = [];
    if (problem) parts.push(`Not ready: ${problem}`);
    const badTicks = misfit && misfit.miss > 0.03;
    if (badTicks) parts.push(`The tick values do not lie on a straight line along the bar; ${mark ? `box ${mark}` : 'one tick'} is ${Math.round(misfit.miss * 100)}% of the range off. Check that value, or the scale (log10).`);
    const many = flagged > cells * 0.2;
    if (cells) parts.push(`${flagged} of ${cells} cells are flagged as far from the colorbar's colors${many ? ' (many: the colorbar or grid may be wrong)' : ''}.`);
    const ok = !problem && !badTicks && !many;
    return { ok, text: `${ok ? 'Check passed.' : 'Check failed.'} ${parts.join(' ')}` };
  }

  Object.assign(CM, {
    DEFAULT_DECISION_MODEL,
    DECISION_SYSTEM_PROMPT: SYSTEM_PROMPT,
    DECISION_LLM_ACTIONS,
    DECISION_TOOLS,
    validateDecisionTool,
    decisionLlmTools,
    decisionQuestions: questions,
    besideCheck,
    boxToPage,
    growBox,
    besideBox,
    barLine,
    tickMisfit,
    checkSummary,
  });
})((globalThis.Colormeris ??= {}));
