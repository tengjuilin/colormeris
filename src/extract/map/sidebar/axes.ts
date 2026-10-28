// Map tool, Axes card: tick rows for the x and y axes, rendered and bound here.

import type { AxisScale, AxisTick, DomEl, Panel } from '../../../types/index.ts';
import type { AxisKey } from '../field.ts';
import { axisEdgePoint, axisFn, axisT } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';

export function setupMapAxes(mctx: MapToolContext) {
  const { ws } = mctx;
  const { $ } = ws;

  const tickKeys = { x: '', y: '' };
  function renderAxes(panel: Panel) {
    const states: string[] = [];
    for (const key of ['x', 'y'] as const) {
      const axis = panel.map[key];
      ws.setValue($(`axis-${key}-scale`), axis.scale);
      $(`axis-${key}-add`).disabled = !panel.grid.corners;
      renderAxisTicks(panel, key);
      const { fn, problem } = axisFn(panel, key);
      $(`axis-${key}-problem`).textContent = problem || '';
      if (fn) states.push(key);
    }
    ws.setBadge($('axes-state'), states.length ? `${states.join(', ')} calibrated` : 'pixels', states.length === 2);
  }

  function renderAxisTicks(panel: Panel, key: AxisKey) {
    const ticks = panel.map[key].ticks;
    const tbody = $(`axis-${key}-ticks`);
    tbody.closest('table')!.hidden = ticks.length === 0;
    const ids = `${panel.id}|${ticks.map((k) => k.id).join(',')}`;
    if (ids !== tickKeys[key]) {
      tickKeys[key] = ids;
      tbody.replaceChildren(...ticks.map((k) => tickRow(key, k)));
    }
    for (const k of ticks) {
      const tr = tbody.querySelector(`tr[data-id="${k.id}"]`);
      if (!tr) continue;
      ws.setValue(tr.querySelector('input') as DomEl, Number.isFinite(k.value) ? k.value : '');
      tr.classList.toggle('invalid', !Number.isFinite(k.value));
      const t = panel.grid.corners ? axisT(panel, key, k) : NaN;
      ws.setValue(tr.querySelector('.pos input') as DomEl, Number.isFinite(t) ? Math.round(t * 1000) / 10 : '');
    }
  }

  function tickRow(key: AxisKey, k: AxisTick) {
    const tr = document.createElement('tr');
    tr.dataset.id = k.id;
    const input = Object.assign(document.createElement('input'), { type: 'number', step: 'any', placeholder: 'value' });
    input.setAttribute('aria-label', `${key.toUpperCase()} axis tick value`);
    input.addEventListener('focus', () => ws.pushHistory());
    input.addEventListener('input', () => {
      const tick = ws.activePanel().map[key].ticks.find((x) => x.id === k.id);
      if (tick) tick.value = input.value === '' ? NaN : Number(input.value);
      ws.changed({ light: true });
    });
    input.addEventListener('change', () => ws.changed());
    // Escape after typing a value ends tick mode too; otherwise the next
    // click on the image (meant to leave the mode) adds another tick.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        e.stopPropagation();
        input.blur();
        ws.setMode(null);
      }
    });
    // Position as % across the plot area, editable as on the colorbar, for
    // ticks whose mark is hard to click (e.g. on the plot's own edge).
    const pos = Object.assign(document.createElement('td'), { className: 'pos' });
    const at = Object.assign(document.createElement('input'), {
      type: 'number',
      step: 'any',
      min: '-50',
      max: '150',
      className: 'num',
      title: `Position across the plot area: 0% at the ${key === 'x' ? 'left' : 'top'}, 100% at the ${key === 'x' ? 'right' : 'bottom'}`,
    });
    at.setAttribute('aria-label', `Position in % across the plot area (${key} axis)`);
    at.addEventListener('focus', () => ws.pushHistory());
    at.addEventListener('change', () => {
      const panel = ws.activePanel();
      const tick = panel.map[key].ticks.find((x) => x.id === k.id);
      const v = Number(at.value);
      if (!tick || !panel.grid.corners || at.value === '' || !Number.isFinite(v)) return ws.changed();
      Object.assign(tick, axisEdgePoint(panel, key, v / 100));
      ws.changed();
    });
    at.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') at.blur();
    });
    pos.append(at, '%');
    const del = Object.assign(document.createElement('button'), {
      className: 'btn subtle icon',
      textContent: '×',
      title: 'Remove tick',
    });
    del.setAttribute('aria-label', 'Remove tick');
    del.addEventListener('click', () =>
      ws.commit((p) => (p.map[key].ticks = p.map[key].ticks.filter((x) => x.id !== k.id))),
    );
    const tdIn = document.createElement('td');
    tdIn.append(input);
    const tdDel = document.createElement('td');
    tdDel.append(del);
    tr.append(tdIn, pos, tdDel);
    return tr;
  }

  function focusAxisTick(key: AxisKey, id: string) {
    requestAnimationFrame(() =>
      $(`axis-${key}-ticks`).querySelector<HTMLInputElement>(`tr[data-id="${id}"] input`)?.focus(),
    );
  }

  function bind() {
    for (const key of ['x', 'y'] as const) {
      $(`axis-${key}-add`).addEventListener('click', () => mctx.toggleMode(`${key}tick`));
      $(`axis-${key}-scale`).addEventListener('change', (e) =>
        ws.commit((p) => (p.map[key].scale = (e.target as HTMLSelectElement).value as AxisScale)),
      );
    }
  }

  return { renderAxes, focusAxisTick, bind };
}
