(function (CM) {
  'use strict';
  const {
    AGENT_SYSTEM_PROMPT, LLM_ACTIONS, RUNNER_TOOLS, validateRunnerTool, llmTools,
    createRetryGuard, progressNote, finishCheck, pruneImages, toolResultText,
    bilinear, outerCorners, cellSamplePolygon, colorAtT, rgbToHex, ticksWithT, renderPdfPage,
  } = CM;

  // Runs the extraction agent: an LLM (any OpenRouter chat model with vision
  // and tools) drives the page through the typed agent API and looks at it
  // through rendered page images with pixel rulers. `client` is an OpenRouter
  // SDK client (or anything with chat.send).

  const MAX_VIEW = 1024; // longest side of images sent to the LLM
  // Prompt caching (openrouter.ai/docs/guides/best-practices/prompt-caching):
  // a top-level cache_control makes Anthropic models cache everything up to
  // the last block and move the breakpoint forward each step, and the other
  // providers cache the shared prefix on their own. The system prompt, the
  // tools and the old messages are identical from step to step. The 1-hour
  // lifetime costs more per write than the 5-minute one but a run can pause
  // for longer than 5 minutes (a slow model, a stalled tab).
  const CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' };
  // Rulers sit outside the picture on the right and bottom, so image pixel
  // (0, 0) is exactly the top-left corner of the region shown. (With rulers on
  // the left and top, models that measure from the image corner were off by
  // the ruler width divided by the zoom.)
  const RULER = { right: 50, bottom: 24 };

  function createAgentRunner(ws, api) {
    const { app } = ws;

    // ------------------------------------------------------------ images

    // Round step (1, 2 or 5 × 10^k) so ruler labels are ~`px` screen pixels apart.
    function niceStep(scale, px = 70) {
      const raw = px / scale;
      const p = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
    }

    // Page (or region) image with rulers in page pixels and optional overlay.
    function renderView({ region, overlay = 'none', maxSide = MAX_VIEW } = {}) {
      const page = app.pages.get(ws.currentPage());
      if (!page) throw new Error('No page is shown.');
      const src = page.canvas;
      let { x0, y0, x1, y1 } = region || { x0: 0, y0: 0, x1: src.width, y1: src.height };
      [x0, x1] = [Math.max(0, Math.min(x0, x1)), Math.min(src.width, Math.max(x0, x1))];
      [y0, y1] = [Math.max(0, Math.min(y0, y1)), Math.min(src.height, Math.max(y0, y1))];
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 4 || h < 4) throw new Error('Region is too small or outside the page.');
      const scale = Math.min(6, maxSide / Math.max(w, h));
      const W = Math.round(w * scale);
      const H = Math.round(h * scale);
      const out = document.createElement('canvas');
      out.width = W + RULER.right;
      out.height = H + RULER.bottom;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(src, x0, y0, w, h, 0, 0, W, H);
      const toView = (p) => ({ x: (p.x - x0) * scale, y: (p.y - y0) * scale });

      if (overlay !== 'none') drawPanels(ctx, toView, scale, overlay);

      // Rulers (bottom and right) with faint guide lines across the picture.
      const step = niceStep(scale);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#000';
      ctx.strokeStyle = 'rgba(0, 170, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const vx = Math.round(toView({ x, y: 0 }).x) + 0.5;
        ctx.beginPath();
        ctx.moveTo(vx, 0);
        ctx.lineTo(vx, H + 5);
        ctx.stroke();
        ctx.fillText(String(Math.round(x)), Math.min(Math.max(vx, 12), W - 12), H + 8);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const vy = Math.round(toView({ x: 0, y }).y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, vy);
        ctx.lineTo(W + 5, vy);
        ctx.stroke();
        ctx.fillText(String(Math.round(y)), W + 8, Math.min(Math.max(vy, 7), H - 7));
      }
      ws.zoomToPoints([{ x: x0, y: y0 }, { x: x1, y: y1 }]);
      const r = (v) => Math.round(v * 100) / 100;
      return {
        dataUrl: out.toDataURL('image/jpeg', 0.9),
        note: `Page ${ws.currentPage()}, region x ${r(x0)}–${r(x1)}, y ${r(y0)}–${r(y1)}, drawn at ${r(scale)}× (${W} × ${H} image pixels plus rulers). Image pixel (0, 0) is page point (${r(x0)}, ${r(y0)}): page x = ${r(x0)} + image x / ${r(scale)}, page y = ${r(y0)} + image y / ${r(scale)}. The rulers on the bottom and right edges show the same page pixels.`,
        region: { x0, y0, scale },
      };
    }

    function drawPanels(ctx, toView, scale, overlay) {
      const line = (a, b, color, width = 1.5) => {
        const p = toView(a);
        const q = toView(b);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      for (const panel of ws.pagePanels()) {
        const g = panel.grid;
        if (g.corners && overlay === 'reconstruction') {
          const res = ws.resultFor(panel);
          if (res.cells) {
            for (let r = 0; r < g.rows; r++) {
              for (let c = 0; c < g.cols; c++) {
                if (res.cells[r][c].empty) continue;
                const poly = cellSamplePolygon(g, r, c, res.cells[r][c].radius).map(toView);
                ctx.beginPath();
                poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                ctx.closePath();
                ctx.fillStyle = rgbToHex(colorAtT(res.samples, res.cells[r][c].t));
                ctx.fill();
                if (res.cells[r][c].flagged) {
                  ctx.strokeStyle = '#ff3b30';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
              }
            }
          }
        }
        if (g.corners && overlay === 'calibration') {
          // Same grid as the workspace draws: through the dot centers for a dot plot.
          const dots = g.anchor === 'centers';
          const frame = dots ? g.corners : outerCorners(g);
          const nu = dots ? g.cols - 1 : g.cols;
          const nv = dots ? g.rows - 1 : g.rows;
          for (let c = 0; c <= nu; c++) line(bilinear(frame, c / nu, 0), bilinear(frame, c / nu, 1), '#e22bd0', c % nu ? 1 : 2);
          for (let r = 0; r <= nv; r++) line(bilinear(frame, 0, r / nv), bilinear(frame, 1, r / nv), '#e22bd0', r % nv ? 1 : 2);
        }
        const cb = panel.colorbar;
        if (cb.start && cb.end && overlay === 'calibration') {
          line(cb.start, cb.end, '#f29900', 2);
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          for (const k of ticksWithT(cb)) {
            const p = toView(k);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#f29900';
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillText(`${k.value}`, p.x + 7, p.y);
          }
        }
      }
    }

    async function renderOverview(from, to) {
      if (!app.pdfDoc) throw new Error('The file has one page; use view_page.');
      const n = app.pdfDoc.numPages;
      from = Math.max(1, from);
      to = Math.min(n, to, from + 11);
      if (to < from) throw new Error(`Pages run from 1 to ${n}.`);
      const thumbs = [];
      for (let p = from; p <= to; p++) {
        const page = await app.pdfDoc.getPage(p);
        const vw = page.getViewport({ scale: 1 }).width;
        thumbs.push({ p, canvas: (await renderPdfPage(app.pdfDoc, p, 320 / vw)).canvas });
      }
      const cols = Math.min(4, thumbs.length);
      const cw = 330;
      const ch = Math.max(...thumbs.map((t) => t.canvas.height)) + 26;
      const out = document.createElement('canvas');
      out.width = cols * cw;
      out.height = Math.ceil(thumbs.length / cols) * ch;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ddd';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.font = 'bold 16px sans-serif';
      thumbs.forEach((t, i) => {
        const x = (i % cols) * cw + 5;
        const y = Math.floor(i / cols) * ch;
        ctx.fillStyle = '#000';
        ctx.fillText(`Page ${t.p}`, x, y + 18);
        ctx.drawImage(t.canvas, x, y + 24);
      });
      return { dataUrl: out.toDataURL('image/jpeg', 0.85), note: `Pages ${from}–${to} of ${n}.` };
    }

    // ------------------------------------------------------------ run

    // settings: {client, llmModel, pages: [n], maxSteps, signal,
    // onEvent(type, data), focus}. `focus` ({panelId, note}) asks the agent to
    // fix one rejected panel.
    async function run(settings) {
      const { client, llmModel, pages, maxSteps = 60, signal, onEvent = () => {}, focus } = settings;
      // One id for the whole run keeps the requests on the provider that
      // holds the cache (sticky routing).
      const sessionId = `colormeris-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const usage = { llmCost: 0, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, steps: 0 };
      const emit = (type, data) => onEvent(type, { ...data, usage: { ...usage } });
      // What the model has looked at and built, so it cannot stop after the
      // first heatmap (see finishCheck).
      const viewedPages = new Set();
      const finishState = { checked: false, refusals: 0 };
      const runPanels = () =>
        app.project.panels
          .filter((p) => p.tool === 'heatmap' && pages.includes(p.page))
          .map((p) => ({ id: p.id, name: p.name, page: p.page, ready: !ws.resultFor(p).error, started: !!(p.grid.corners || p.colorbar.start || p.grid.rowLabels.length || p.grid.colLabels.length) }));
      const progress = () => progressNote({ pages, viewedPages, panels: runPanels(), currentPage: ws.currentPage() });

      async function callTool(name, args) {
        if (LLM_ACTIONS.includes(name)) {
          if (name === 'go_to_page' && !pages.includes(args.page)) return { ok: false, error: `Page ${args.page} is not part of this run (pages ${pages.join(', ')}).` };
          const r = await api.run(name, args);
          // Keep results small: the active panel instead of the full state.
          if (r.state) {
            const { state, ...rest } = r;
            return { ...rest, activePanel: state.panels.find((p) => p.id === state.activePanelId), page: state.source?.page };
          }
          return r;
        }
        if (!RUNNER_TOOLS[name]) return { ok: false, error: `Unknown tool "${name}".` };
        const errs = validateRunnerTool(name, args);
        if (errs.length) return { ok: false, error: errs.join('; ') };
        if (name === 'view_page') {
          const image = renderView(args);
          viewedPages.add(ws.currentPage());
          return { ok: true, image };
        }
        if (name === 'view_pages_overview') return { ok: true, image: await renderOverview(args.from, args.to) };
        if (name === 'finish' && !focus) {
          const why = finishCheck({ pages, viewedPages, panels: runPanels(), ...finishState });
          if (why) {
            finishState.refusals++;
            if (why.checklist) finishState.checked = true;
            emit('assistant', { text: `(finish refused) ${why.message}` });
            return { ok: true, finished: false, result: why.message };
          }
        }
        return { ok: true, result: null };
      }

      const s = app.project.source;
      const first = await api.run('go_to_page', { page: pages[0] });
      const panelsNow = (await api.run('get_state')).result.panels;
      const target = focus && panelsNow.find((p) => p.id === focus.panelId);
      const focusText = target
        ? `\n\nThis is a redo. Panel "${target.name}" (id ${target.id}) was rejected${focus.note ? ` with the note: "${focus.note}"` : ''}. Its current calibration: ${JSON.stringify({ grid: target.grid, colorbar: target.colorbar })}. Do not add panels. select_panel it, find what is wrong (grid corners, grid size, colorbar ends, ticks or scale), fix it, check with overlays, then finish.`
        : '';
      if (!first.ok) throw new Error(first.error);
      const opening = pages.length > 1 && app.pdfDoc ? await renderOverview(pages[0], pages[Math.min(pages.length, 12) - 1]) : renderView();
      if (!(pages.length > 1 && app.pdfDoc)) viewedPages.add(ws.currentPage());
      const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `File: ${s.fileName} (${s.pageCount} page${s.pageCount === 1 ? '' : 's'}). Process page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}. Page images are ${s.width} × ${s.height} px. Existing panels: ${JSON.stringify(panelsNow.map((p) => ({ id: p.id, name: p.name, page: p.page, ready: p.ready, review: p.review?.status })))}.${focusText}\n${opening.note}`,
            },
            { type: 'image_url', imageUrl: { url: opening.dataUrl } },
          ],
        },
      ];
      const tools = llmTools();
      let nudges = 0;
      const guard = createRetryGuard();
      let summary = null;

      while (usage.steps < maxSteps && summary === null) {
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        usage.steps++;
        emit('thinking', { step: usage.steps });
        const res = await client.chat.send({ chatRequest: { model: llmModel, messages: pruneImages(messages), tools, toolChoice: 'auto', maxTokens: 4096, cacheControl: CACHE_CONTROL, sessionId } }, { signal });
        const msg = res.choices?.[0]?.message;
        if (!msg) throw new Error('The model returned no message.');
        usage.llmCost += res.usage?.cost || 0;
        usage.promptTokens += res.usage?.promptTokens || 0;
        usage.cachedTokens += res.usage?.promptTokensDetails?.cachedTokens || 0;
        usage.cacheWriteTokens += res.usage?.promptTokensDetails?.cacheWriteTokens || 0;
        usage.completionTokens += res.usage?.completionTokens || 0;
        messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.toolCalls?.length ? { toolCalls: msg.toolCalls } : {}) });
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text.trim()) emit('assistant', { text });
        if (!msg.toolCalls?.length) {
          if (++nudges > 2) break;
          messages.push({ role: 'user', content: `Continue with the tools. ${progress()} Call finish only when every heatmap on every page has its own calibrated panel.` });
          continue;
        }
        nudges = 0;
        const images = [];
        for (const call of msg.toolCalls) {
          let args;
          let result;
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            result = { ok: false, error: 'Arguments are not valid JSON.' };
          }
          const name = call.function.name;
          // Retries are counted per tool and panel (the one named, else the active one).
          const panelKey = args?.panelId || ws.activePanel()?.id;
          if (!result) {
            emit('tool', { name, args });
            result = guard.before(name, panelKey);
            if (!result) {
              try {
                result = await callTool(name, args);
              } catch (err) {
                if (signal?.aborted) throw err;
                result = { ok: false, error: err.message };
              }
            }
          }
          result = guard.after(name, panelKey, result);
          if (call.function.name === 'finish' && result.ok && result.finished !== false) summary = args.summary;
          if (result.image) {
            images.push(result.image);
            result = { ok: true, result: `${result.image.note} The image follows.` };
          }
          if (!result.ok) emit('tool-error', { name: call.function.name, error: result.error });
          messages.push({ role: 'tool', toolCallId: call.id, content: toolResultText(result) });
        }
        if (images.length) {
          messages.push({ role: 'user', content: images.flatMap((im) => [{ type: 'text', text: im.note }, { type: 'image_url', imageUrl: { url: im.dataUrl } }]) });
        }
        if (guard.stop) {
          emit('tool-error', { name: 'run', error: `Stopped: ${guard.stop}` });
          summary = `Stopped because ${guard.stop}.`;
        }
      }

      const out = { summary: summary ?? (usage.steps >= maxSteps ? `Stopped after ${maxSteps} steps.` : 'The model stopped without a summary.'), usage };
      emit('done', out);
      return out;
    }

    return { run, renderView, renderOverview };
  }

  Object.assign(CM, { createAgentRunner });
})((globalThis.Colormeris ??= {}));
