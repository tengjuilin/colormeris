// The Scale card, shared by the ROI and Map tools (both list 'sec-scale' in their sections). It acts on the
// active panel's scale bar whatever the tool; measuring and drawing are plain functions in scale-bar.ts.
// Read in render, write in handlers (docs/react.md, "The card pattern").
import { useLayoutEffect, useRef } from 'react';
import type { ScaleUnit } from '../types/index.ts';
import { BoundInput, BoundSelect, CardHead, Fields, Hint, IconBtn, InputPair, MainStep } from '../ui/index.ts';
import { useBoundNumber } from './react/use-bound.ts';
import { useWorkspace } from './react/use-workspace.ts';
import { scaleDefaults, scaleFocus } from './scale-bar.ts';

const UNITS: ScaleUnit[] = ['cm', 'mm', 'µm', 'nm'];

export function ScaleCard() {
  const { ws, w } = useWorkspace({ section: 'sec-scale' });
  const panel = w.activePanel();
  const sc = panel.scale;
  const length = sc?.length ?? scaleDefaults.length;
  const unit = sc?.unit ?? scaleDefaults.unit;
  const px = sc ? Math.hypot(sc.p2.x - sc.p1.x, sc.p2.y - sc.p1.y) : 0;

  // What the next measurement takes: the last length and unit shown (kept after the bar is removed).
  useLayoutEffect(() => {
    if (!sc) return;
    scaleDefaults.length = sc.length;
    scaleDefaults.unit = sc.unit;
  });

  // Set by scaleBarClick before the commit; focus the length once the render shows the new bar.
  const lengthEl = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!scaleFocus.pending) return;
    scaleFocus.pending = false;
    lengthEl.current?.focus();
    lengthEl.current?.select();
  });

  const lengthProps = useBoundNumber(
    (p, v) => {
      scaleDefaults.length = v;
      if (p.scale) p.scale.length = v;
    },
    { accept: (v) => v > 0 },
  );

  return (
    <>
      <CardHead
        title="Scale"
        tag="optional"
        badge={{ id: 'scale-state', text: sc ? `${sc.length} ${sc.unit}` : 'pixels', ok: !!sc }}
        actions={
          <IconBtn
            id="scale-clear"
            variant="danger"
            icon="trash"
            label="Remove the scale bar"
            disabled={!sc}
            onClick={() => ws.commit((p) => (p.scale = null))}
          />
        }
      />
      <MainStep
        id="scale-place"
        icon="ruler"
        title="Click both ends of a scale bar (or any known distance), then type its length"
        pressed={w.app.mode?.type === 'scale'}
        onClick={() => w.setMode(w.app.mode?.type === 'scale' ? null : 'scale')}
      >
        Measure scale bar
      </MainStep>
      <Fields>
        <div className="field">
          <label htmlFor="scale-length">Length</label>
          <InputPair>
            <BoundInput
              key={panel.id}
              ref={lengthEl}
              id="scale-length"
              kind="number"
              min={0}
              step="any"
              value={length}
              {...lengthProps}
            />
            <BoundSelect
              id="scale-unit"
              aria-label="Unit"
              value={unit}
              options={UNITS.map((u) => ({ value: u, label: u }))}
              onChange={(v) => {
                scaleDefaults.unit = v as ScaleUnit;
                if (w.activePanel().scale) ws.commit((p) => (p.scale!.unit = v as ScaleUnit));
                else ws.changed();
              }}
            />
          </InputPair>
        </div>
      </Fields>
      <Hint id="scale-info">{sc ? `${px.toFixed(1)} px = ${sc.length} ${sc.unit}` : ''}</Hint>
    </>
  );
}
