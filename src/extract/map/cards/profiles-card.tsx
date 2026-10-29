// The Map tool's Profiles card: Draw profile, the profile chips (keyed by profile id; Shift- or Cmd-click
// selects several, `selectedId` + `overlay`), the edited profile's fields, the plot and the sweep, and the
// profile CSV. The plot canvas and the sweep animation stay imperative (profile-plot.ts, sweep.ts): the plot is
// drawn in a layout effect after each render, and a sweep frame redraws it and the "line at" text through refs
// without rendering the card. Read in render, write in handlers (docs/react.md, "The card pattern").
import { useLayoutEffect, useRef } from 'react';
import type { MapResult, Profile, ProfileSample } from '../../../types/index.ts';
import {
  Actions,
  BoundInput,
  BoundSelect,
  Btn,
  CardHead,
  Check,
  Chip,
  ChipList,
  Field,
  Fields,
  IconBtn,
  MainStep,
  Notice,
} from '../../../ui/index.ts';
import { profileCsv, profilesCsv, safeFileName } from '../../project/project-files.ts';
import { useBoundNumber, useBoundText } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../../workspace/store.ts';
import { lengthPerPixel, profileAxisKey, profileDivisor, profileEndForLength, profileLength } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';
import { useMapTool } from './map-context.ts';
import { profileView, sweepAtText } from './profile-view.ts';
import { UnitsSelect } from './units-select.tsx';

/** The canvas of the plot: handed to profile-plot.ts, which draws it and traces the pointer. */
function PlotCanvas({ mctx }: { mctx: MapToolContext }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A layout effect, so the canvas is attached before the card's own layout effect draws on it.
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const detach = mctx.plot.attach(canvas);
    // The plot follows the card's width.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => mctx.plot.redraw()) : null;
    ro?.observe(canvas);
    return () => {
      ro?.disconnect();
      detach();
    };
  }, [mctx]);
  return (
    <canvas id="profile-plot" className="profile-plot" aria-label="Values along the selected profiles" ref={ref} />
  );
}

function downloadCsv(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const panel = ws.activePanel();
  const results = (ws.resultFor(panel) as MapResult).profiles || {};
  const mode = state.profileNorm;
  // The normalized column follows the plot; a profile that cannot be normalized leaves it empty.
  const normOf = (samples: ProfileSample[]) =>
    mode === 'raw'
      ? null
      : { mode, divisor: (profileDivisor(samples, mode) as { divisor?: number }).divisor ?? Number.NaN };
  const entries = mctx
    .selectedProfiles()
    .filter((l) => Array.isArray(results[l.id]))
    .map((l) => ({
      name: l.name,
      samples: results[l.id] as ProfileSample[],
      norm: normOf(results[l.id] as ProfileSample[]),
    }));
  if (!entries.length) return;
  const unit = lengthPerPixel(panel.scale) !== null ? panel.scale!.unit : null;
  const [csv, suffix] =
    entries.length === 1
      ? [profileCsv(entries[0].samples, entries[0].norm, unit), `_profile_${safeFileName(entries[0].name)}`]
      : [profilesCsv(entries, unit), '_profiles'];
  ws.download(new Blob([csv], { type: 'text/csv' }), ws.csvName(panel, suffix));
}

export function ProfilesCard() {
  const { ws, w } = useWorkspace({ section: 'sec-profiles' });
  const mctx = useMapTool();
  const { state } = mctx;
  const panel = w.activePanel();
  const profiles = panel.map.profiles;
  const n = profiles.length;
  const shown = mctx.selectedProfiles();
  // A render queued before a tool switch can see another tool's panel: it shows nothing of its own then.
  const isMap = panel.tool === 'map';
  const sel: Profile | null = isMap ? mctx.selectedProfile() : null;
  const sweeping = !!state.sweep;

  const name = useBoundText((_p, v) => {
    const l = mctx.selectedProfile();
    if (l) l.name = v;
  });
  const width = useBoundNumber((_p, v) => {
    const l = mctx.selectedProfile();
    if (l) l.halfWidth = Math.min(50, Math.max(0, Math.round(v)));
  });
  const length = useBoundNumber((p, v) => {
    const l = mctx.selectedProfile();
    const b = l && profileEndForLength(p, l, v);
    if (b) l.b = b;
  });

  // What the card and the plot show for the selection (nothing without an edited profile).
  const view = sel ? profileView(mctx, panel, shown) : null;
  const len = sel ? profileLength(panel, sel) : null;
  const unit = len && (len.kind === 'length' ? panel.scale!.unit : len.kind);

  const at = useRef<HTMLParagraphElement>(null);
  // Draws after every render, as renderProfiles did. The sweep keeps `ui` current for its frames.
  useLayoutEffect(() => {
    mctx.ui.sweepAt = at.current;
    mctx.ui.viewSignature = view ? view.signature : null;
    if (at.current) at.current.textContent = sel ? sweepAtText(panel, sel) : '';
    if (view) mctx.plot.drawProfiles(panel, view.series);
  });

  function overlayAll() {
    const all = ws.activePanel().map.profiles;
    state.selectedId ??= all[0]?.id ?? null;
    for (const l of all) if (l.id !== state.selectedId) state.overlay.add(l.id);
    ws.changed();
  }

  function changeNorm(norm: string) {
    state.profileNorm = norm;
    // The fixed value axis was measured in the old scale.
    if (state.sweep) {
      const p = ws.activePanel();
      const l = mctx.selectedProfile();
      const image = ws.app.pages.get(p.page)?.imageData;
      state.sweep.yRange =
        l && image
          ? mctx.sweep.sweepValueRange(image, p, { ...l, a: state.sweep.a0, b: state.sweep.b0 }, state.sweep)
          : null;
    }
    ws.changed({ light: true });
  }

  const deleteLabel =
    shown.length > 1
      ? `Delete the ${shown.length} selected profiles (Delete or Backspace; ⌫ on a Mac)`
      : 'Delete (Delete or Backspace; ⌫ on a Mac)';
  const csvLabel =
    view && view.series.length > 1 ? `Download ${view.series.length} profiles CSV` : 'Download profile CSV';

  return (
    <>
      <CardHead
        title="Profiles"
        badge={{ id: 'profile-state', text: n ? `${n} profile${n === 1 ? '' : 's'}` : 'none', ok: n > 0 }}
        actions={
          <IconBtn
            id="profile-delete"
            variant="danger"
            icon="trash"
            label={deleteLabel}
            hidden={!sel}
            onClick={() => mctx.deleteSelected()}
          />
        }
      />
      <MainStep
        id="profile-add"
        icon="line"
        hotkey="profile"
        title="Draw a line to read values along it. Shortcut: {key}"
        pressed={w.app.mode?.type === 'profile'}
        onClick={() => mctx.toggleMode('profile')}
      >
        Draw profile
      </MainStep>
      <Actions>
        <Btn
          id="profile-all"
          variant="subtle"
          icon="layers"
          title="Overlay all profiles in the plot; Shift-click chips or lines to pick some"
          hidden={n < 2 || shown.length === n}
          onClick={overlayAll}
        >
          Overlay all
        </Btn>
      </Actions>
      <ChipList id="profile-list">
        {profiles.map((l) => (
          <Chip
            key={l.id}
            pressed={mctx.isSelected(l.id)}
            title="Shift- or Cmd-click to overlay several profiles in the plot"
            icon={<span className="swatch" style={{ background: mctx.profileColor(panel, l) }} />}
            onClick={(e) => mctx.selectProfile(l.id, { add: e.shiftKey || e.metaKey || e.ctrlKey })}
          >
            {l.name}
          </Chip>
        ))}
      </ChipList>
      <div id="profile-edit" hidden={!sel}>
        <Fields>
          <Field label="Name">
            <BoundInput
              key={sel?.id}
              id="profile-name"
              kind="text"
              spellCheck={false}
              value={sel?.name ?? ''}
              {...name}
            />
          </Field>
          <Field
            id="profile-length-field"
            label={<span id="profile-length-label">{`Length (${unit ?? 'px'})`}</span>}
            title={
              len
                ? `${len.kind === 'x' || len.kind === 'y' ? `Span of ${len.kind} values along the profile.` : `Length of the profile in ${len.kind === 'px' ? 'pixels' : unit}.`} Typing a length moves its end; the start and direction stay.`
                : undefined
            }
          >
            <BoundInput
              key={sel?.id}
              id="profile-length"
              kind="number"
              min={0}
              step="any"
              className="num"
              value={len ? Number(len.length.toPrecision(6)) : ''}
              {...length}
            />
          </Field>
          <Field label="Width (± px)" title="Values are averaged over this many pixels on each side of the line">
            <BoundInput
              key={sel?.id}
              id="profile-width"
              kind="number"
              min={0}
              max={50}
              step={1}
              className="num"
              value={sel?.halfWidth ?? ''}
              {...width}
            />
          </Field>
        </Fields>
      </div>
      <div id="profile-view" hidden={!sel}>
        <Notice id="profile-problem">{view?.problem ?? ''}</Notice>
        <Fields>
          <Field
            label="X axis"
            title="What the plot's horizontal axis shows: axis values (with axis ticks), or the distance from the profile's start in pixels or in scale-bar units. Shared with the Results card's Coordinates."
          >
            {/* Shows what is plotted, which may be a fallback from the setting. */}
            <UnitsSelect
              id="profile-x"
              panel={panel}
              hasAxis={shown.some((l) => profileAxisKey(panel, l))}
              value={len ? (len.kind === 'x' || len.kind === 'y' ? 'axis' : len.kind) : panel.map.units}
              onChange={(units) =>
                ws.commit((p) => {
                  p.map.units = units;
                })
              }
            />
          </Field>
          <Field
            label="Scale"
            title="Divide each profile by its own maximum or mean to compare shapes rather than signal levels"
          >
            <BoundSelect
              id="profile-norm"
              value={state.profileNorm}
              options={[
                { value: 'raw', label: 'Values' },
                { value: 'max', label: '÷ each max' },
                { value: 'mean', label: '÷ each mean' },
              ]}
              onChange={changeNorm}
            />
          </Field>
          <Field label="Speed (px/s)" title="How fast the profile moves when swept, in page pixels per second">
            <BoundInput
              id="profile-sweep-speed"
              kind="number"
              min={1}
              max={500}
              step="any"
              className="num"
              value={state.sweepSpeed}
              onInput={(text) => {
                const v = Number(text);
                if (text.trim() !== '' && Number.isFinite(v)) state.sweepSpeed = v;
              }}
            />
          </Field>
        </Fields>
        <Check
          id="profile-sweep-runoff"
          label="Run off the edge"
          title="Keep going until no part of the line is inside the plot area, then turn. Off: turn as soon as the line touches an edge."
          checked={state.sweepRunOff}
          onChange={(on) => {
            state.sweepRunOff = on;
            // Switching edges mid-sweep: the new range around where it started.
            mctx.sweep.retarget();
            notify({ light: true });
          }}
        />
        <MainStep
          id="profile-sweep"
          variant="primary"
          icon={sweeping ? 'pause' : 'play'}
          hotkey="sweepProfile"
          title="Move the profile across the plot area, perpendicular to itself, and back (Shortcut: {key})"
          pressed={sweeping}
          disabled={!sweeping && !panel.grid.corners}
          onClick={() => mctx.sweep.toggleSweep()}
        >
          {sweeping ? 'Pause' : 'Sweep'}
        </MainStep>
        <p
          id="profile-sweep-at"
          className="profile-at"
          title="Where the profile's midpoint is, across the direction it sweeps (units as in Coordinates)"
          ref={at}
        />
        <PlotCanvas mctx={mctx} />
        <MainStep id="profile-csv" icon="download" disabled={!view?.series.length} onClick={() => downloadCsv(mctx)}>
          {csvLabel}
        </MainStep>
      </div>
    </>
  );
}
