(function (CM) {
  'use strict';

  // Reading a heatmap's row and column labels with a vision LLM (pure: prompt,
  // forced tool and answer parsing). The UI (agent/labels-reader.js) sends one
  // image of the current view with the grid outline drawn on it.

  const DEFAULT_LABELS_MODEL = 'openai/gpt-6.1-sol';

  const LABELS_PROMPT = `You read the row and column labels of one heatmap in a scientific figure.
The image shows the current view of the figure. The heatmap's grid of cells is outlined on it.
Return the labels through the set_labels tool:
- rowLabels: the label of each row, top to bottom.
- colLabels: the label of each column, left to right.
Copy each label exactly as printed (same case, digits, symbols, units); write subscripts and superscripts as plain text. One string per row or column; do not number them or add text.
Read only the labels of the outlined grid, not of other panels, the colorbar or the axis titles. Rotated labels are read in their own direction.
If a side has no labels or they are unreadable, return an empty list for it and say why in note.`;

  // Expected counts and the grid's place in the image, so the model reads the right labels.
  function labelsUserText({ rows, cols, box }) {
    const where = box ? ` The grid spans image pixels x ${Math.round(box.x0)}–${Math.round(box.x1)}, y ${Math.round(box.y0)}–${Math.round(box.y1)}.` : '';
    return `This grid has ${rows} rows and ${cols} columns, so expect ${rows} row labels and ${cols} column labels.${where}`;
  }

  function labelsTool() {
    const list = (description) => ({ type: 'array', items: { type: 'string' }, description });
    return {
      type: 'function',
      function: {
        name: 'set_labels',
        description: 'Set the row and column labels of the outlined heatmap.',
        parameters: {
          type: 'object',
          properties: {
            rowLabels: list('Row labels, top to bottom.'),
            colLabels: list('Column labels, left to right.'),
            note: { type: 'string', description: 'Anything unclear, e.g. unreadable or missing labels.' },
          },
          required: ['rowLabels', 'colLabels'],
        },
      },
    };
  }

  const cleanList = (v) => (Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : []);

  // The forced tool call → labels and warnings. Throws when there is no usable call.
  function parseLabelsAnswer(message, { rows, cols } = {}) {
    const call = (message?.toolCalls || message?.tool_calls || []).find((c) => c.function?.name === 'set_labels');
    if (!call) throw new Error('The model did not return labels.');
    let args = call.function.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        throw new Error('The model returned labels that are not valid JSON.');
      }
    }
    const rowLabels = cleanList(args?.rowLabels);
    const colLabels = cleanList(args?.colLabels);
    const warnings = [];
    if (rows && rowLabels.length && rowLabels.length !== rows) warnings.push(`${rowLabels.length} row labels for ${rows} rows`);
    if (cols && colLabels.length && colLabels.length !== cols) warnings.push(`${colLabels.length} column labels for ${cols} columns`);
    if (!rowLabels.length) warnings.push('no row labels');
    if (!colLabels.length) warnings.push('no column labels');
    const note = typeof args?.note === 'string' ? args.note.trim() : '';
    return { rowLabels, colLabels, warnings, note };
  }

  Object.assign(CM, { DEFAULT_LABELS_MODEL, LABELS_PROMPT, labelsUserText, labelsTool, parseLabelsAnswer });
})((globalThis.Colormeris ??= {}));
