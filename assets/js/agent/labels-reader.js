(function (CM) {
  'use strict';
  const { LABELS_PROMPT, DEFAULT_LABELS_MODEL, labelsUserText, labelsTool, parseLabelsAnswer, loadOpenRouterSdk, makeOpenRouterClient } = CM;

  // "Read labels with AI" in the Grid card (heatmap): sends the current view,
  // with the grid outline drawn on it, to a vision LLM and fills in the active
  // panel's row and column labels in one undoable step. Uses the Agent's key
  // and base URL; the model is the Model field next to the button (agent.labels).

  const MAX_SIDE = 1568; // longest side sent; larger images are downscaled by the providers anyway

  function setupLabelReader(ws, settingsUi) {
    const { $, viewer } = ws;
    const button = $('grid-read-labels');
    const hint = $('grid-read-labels-hint');
    if (!button) return;
    const agent = () => settingsUi.get().agent;

    // The view canvas as a JPEG, and the grid's box in that image's pixels.
    function viewImage(corners) {
      // Draw now: a pending requestDraw (paused in hidden tabs) may not have run yet.
      viewer.draw();
      const src = viewer.canvas;
      const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(src.width * k));
      out.height = Math.max(1, Math.round(src.height * k));
      out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
      const f = (window.devicePixelRatio || 1) * k;
      const pts = corners.map((c) => viewer.toScreen(c)).map((p) => ({ x: p.x * f, y: p.y * f }));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      return { dataUrl: out.toDataURL('image/jpeg', 0.9), box };
    }

    function setHint(text, isError = false) {
      hint.textContent = text;
      hint.classList.toggle('error', isError);
    }

    function setBusy(on) {
      button.dataset.busy = on ? '1' : '';
      button.textContent = on ? 'Reading…' : 'Read labels with AI';
      button.disabled = on || !ws.activePanel()?.grid.corners;
    }

    button.addEventListener('click', async () => {
      const panel = ws.activePanel();
      if (!panel?.grid.corners) return;
      const { key, base, labels } = agent();
      if (!key && !base) {
        setHint('Set an OpenRouter key or proxy URL in Settings → Agent first.', true);
        settingsUi.open('agent');
        return;
      }
      const panelId = panel.id;
      const { rows, cols } = panel.grid;
      const model = labels || DEFAULT_LABELS_MODEL;
      const { dataUrl, box } = viewImage(panel.grid.corners);
      setBusy(true);
      setHint(`Asking ${model}…`);
      try {
        const client = makeOpenRouterClient(await loadOpenRouterSdk(), { key, base });
        const res = await client.chat.send({
          chatRequest: {
            model,
            messages: [
              { role: 'system', content: LABELS_PROMPT },
              { role: 'user', content: [{ type: 'text', text: labelsUserText({ rows, cols, box }) }, { type: 'image_url', imageUrl: { url: dataUrl } }] },
            ],
            tools: [labelsTool()],
            toolChoice: { type: 'function', function: { name: 'set_labels' } },
            maxTokens: 1024,
            temperature: 0,
          },
        });
        const out = parseLabelsAnswer(res.choices?.[0]?.message, { rows, cols });
        // The user may have switched panels while waiting; never write into another one.
        if (ws.activePanel()?.id !== panelId) {
          setHint('Labels not applied: the panel changed while reading.', true);
          return;
        }
        if (!out.rowLabels.length && !out.colLabels.length) {
          setHint(`No labels found.${out.note ? ` ${out.note}` : ''}`, true);
          return;
        }
        ws.commit((p) => {
          if (out.rowLabels.length) p.grid.rowLabels = out.rowLabels;
          if (out.colLabels.length) p.grid.colLabels = out.colLabels;
        });
        const cost = res.usage?.cost ? ` ($${res.usage.cost.toFixed(4)})` : '';
        const parts = [`Read ${out.rowLabels.length} row and ${out.colLabels.length} column labels${cost}. Check them; Undo reverts.`];
        if (out.warnings.length) parts.push(`Note: ${out.warnings.join('; ')}.`);
        if (out.note) parts.push(out.note);
        setHint(parts.join(' '), out.warnings.length > 0);
      } catch (err) {
        setHint(`Could not read labels: ${err?.message || err}`, true);
      } finally {
        setBusy(false);
      }
    });
  }

  Object.assign(CM, { setupLabelReader });
})((globalThis.Colormeris ??= {}));
