// The Map tool's Axes card: Add x / y ticks, the scale of each axis, and a tick table per axis (value, position
// in % across the plot area, remove). Rows are keyed by tick id so a row keeps its input and focus while ticks
// come and go. Handlers look the tick up in the live project by id. Read in render, write in handlers
// (docs/react.md §10).
import { useLayoutEffect, useRef } from 'react';
import type { AxisScale, AxisTick, Panel, WorkspaceContext } from '../../../types/index.ts';
import { BoundInput, BoundSelect, Btn, CardHead, Field, Hint, SplitActions } from '../../../ui/index.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { type AxisKey, axisEdgePoint, axisFn, axisT } from '../field.ts';
import { flushAxisTickFocus } from './axis-tick-focus.ts';
import { useMapTool } from './map-context.ts';

function TickRow({ w, axis, tick: k, panel }: { w: WorkspaceContext; axis: AxisKey; tick: AxisTick; panel: Panel }) {
  const pushed = useRef(false);
  const live = () => w.activePanel().map[axis].ticks.find((x) => x.id === k.id);
  const pushOnce = () => {
    if (!pushed.current) w.pushHistory();
    pushed.current = true;
  };
  const reset = () => {
    pushed.current = false;
  };
  const t = panel.grid.corners ? axisT(panel, axis, k) : Number.NaN;
  return (
    <tr data-id={k.id} className={Number.isFinite(k.value) ? undefined : 'invalid'}>
      <td>
        <BoundInput
          kind="number"
          step="any"
          placeholder="value"
          aria-label={`${axis.toUpperCase()} axis tick value`}
          value={Number.isFinite(k.value) ? k.value : ''}
          onFocus={reset}
          onInput={(text) => {
            const tick = live();
            if (!tick) return;
            pushOnce();
            tick.value = text === '' ? Number.NaN : Number(text);
            w.changed({ light: true });
          }}
          onCommit={() => w.changed()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            // Escape after typing a value ends tick mode too; otherwise the next click on the image (meant
            // to leave the mode) adds another tick.
            if (e.key === 'Escape') {
              e.stopPropagation();
              e.currentTarget.blur();
              w.setMode(null);
            }
          }}
        />
      </td>
      <td className="pos">
        <BoundInput
          kind="number"
          step="any"
          min={-50}
          max={150}
          className="num"
          aria-label={`Position in % across the plot area (${axis} axis)`}
          title={`Position across the plot area: 0% at the ${axis === 'x' ? 'left' : 'top'}, 100% at the ${axis === 'x' ? 'right' : 'bottom'}`}
          value={Number.isFinite(t) ? Math.round(t * 1000) / 10 : ''}
          onFocus={reset}
          onCommit={(text) => {
            const p = w.activePanel();
            const tick = live();
            const v = Number(text);
            if (!tick || !p.grid.corners || text === '' || !Number.isFinite(v)) return w.changed();
            pushOnce();
            Object.assign(tick, axisEdgePoint(p, axis, v / 100));
            w.changed();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        %
      </td>
      <td>
        <Btn
          variant="subtle"
          className="icon"
          title="Remove tick"
          aria-label="Remove tick"
          onClick={() => w.commit((p) => (p.map[axis].ticks = p.map[axis].ticks.filter((x) => x.id !== k.id)))}
        >
          ×
        </Btn>
      </td>
    </tr>
  );
}

function AxisBlock({ w, panel, axis, problem }: { w: WorkspaceContext; panel: Panel; axis: AxisKey; problem: string }) {
  const ticks = panel.map[axis].ticks;
  const X = axis.toUpperCase();
  return (
    <div className="axis-block">
      <Field label={`${X} scale`}>
        <BoundSelect
          id={`axis-${axis}-scale`}
          value={panel.map[axis].scale}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'log10', label: 'Log10' },
          ]}
          onChange={(v) =>
            w.commit((p) => {
              p.map[axis].scale = v as AxisScale;
            })
          }
        />
      </Field>
      <table className="ticks" hidden={ticks.length === 0}>
        <thead>
          <tr>
            <th>{X} value</th>
            <th>Position</th>
            <th />
          </tr>
        </thead>
        <tbody id={`axis-${axis}-ticks`}>
          {ticks.map((k) => (
            <TickRow key={k.id} w={w} axis={axis} tick={k} panel={panel} />
          ))}
        </tbody>
      </table>
      <Hint id={`axis-${axis}-problem`}>{problem}</Hint>
    </div>
  );
}

export function AxesCard() {
  const { w } = useWorkspace({ section: 'sec-axes' });
  const mctx = useMapTool();
  const panel = w.activePanel();
  const mode = w.app.mode?.type;
  useLayoutEffect(flushAxisTickFocus);
  const axes = (['x', 'y'] as const).map((key) => ({ key, ...axisFn(panel, key) }));
  const calibrated = axes.filter((a) => a.fn).map((a) => a.key);
  return (
    <>
      <CardHead
        title={
          <span title="Click labelled ticks on each axis and type their values. Without them, coordinates are pixels from the plot's top-left corner.">
            Axes
          </span>
        }
        tag="optional"
        badge={{
          id: 'axes-state',
          text: calibrated.length ? `${calibrated.join(', ')} calibrated` : 'pixels',
          ok: calibrated.length === 2,
        }}
      />
      <SplitActions>
        {(['x', 'y'] as const).map((key) => (
          <Btn
            key={key}
            id={`axis-${key}-add`}
            icon="plus"
            hotkey={`${key}tick`}
            title="Shortcut: {key}"
            pressed={mode === `${key}tick`}
            disabled={!panel.grid.corners}
            onClick={() => mctx.toggleMode(`${key}tick`)}
          >
            Add {key} ticks
          </Btn>
        ))}
      </SplitActions>
      {axes.map((a) => (
        <AxisBlock key={a.key} w={w} panel={panel} axis={a.key} problem={a.problem || ''} />
      ))}
    </>
  );
}
