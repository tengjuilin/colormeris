// Map tool, coordinates (pure): axis ticks on the plot area's edges, axis values, the units positions are
// reported in (map.units: axis, scale-bar length or pixels) and the bin-centre coordinates of a field. None of
// this reads pixels, so a change to the axes, the units or the scale bar never extracts the field again.
import { makeValueFn, tickProblem } from '../../../core/colorbar.ts';
import { bilinear, gridPixelSize, invertBilinear } from '../../../core/grid.ts';
import type { MapField, MapUnits, Panel, Point, ScaleBar } from '../../../types/index.ts';

/** The two axes of a map's plot area. */
export type AxisKey = 'x' | 'y';

/** The coordinate part of a field (extractField): bin centres along each axis and how they are named. */
export type FieldCoords = Pick<MapField, 'xs' | 'ys' | 'xAxis' | 'yAxis' | 'xName' | 'yName' | 'axisProblems'>;

// Position of a page point along an axis of the plot area: u (x, left → right)
// or v (y, top → bottom).
export function axisT(panel: Panel, key: AxisKey, p: Point) {
  const { u, v } = invertBilinear(panel.grid.corners!, p);
  return key === 'x' ? u : v;
}

// Axis ticks sit on the plot area's edges: x ticks on the bottom edge, y
// ticks on the left edge, where only their position along the axis matters.
// They may lie a little beyond the corners, as axes often run past the image.
const AXIS_T_MIN = -0.5;
const AXIS_T_MAX = 1.5;

// Page point of axis position t on the edge of `key`'s axis.
export function axisEdgePoint(panel: Panel, key: AxisKey, t: number) {
  const c = panel.grid.corners!;
  const s = Math.min(AXIS_T_MAX, Math.max(AXIS_T_MIN, t));
  return key === 'x' ? bilinear(c, s, 1) : bilinear(c, 0, s);
}

// A page point moved onto the edge of `key`'s axis, keeping its position
// along the axis. Without a plot area the point stays as it is.
export function onAxisEdge(panel: Panel, key: AxisKey, p: Point) {
  return panel.grid.corners ? axisEdgePoint(panel, key, axisT(panel, key, p)) : p;
}

// {fn: axis position → axis value, or null, problem: why there is none}.
// An axis is optional, so a problem is a hint rather than an error.
export function axisFn(panel: Panel, key: AxisKey) {
  const axis = panel.map[key];
  if (!panel.grid.corners) return { fn: null, problem: null as string | null };
  if (!axis.ticks.length) return { fn: null, problem: null as string | null };
  const ticks = axis.ticks.map((k) => ({ ...k, t: axisT(panel, key, k) }));
  const problem = tickProblem(ticks, axis.scale);
  if (problem)
    return { fn: null, problem: `${key.toUpperCase()} axis: ${problem.replace('along the bar', 'along the axis')}` };
  return { fn: makeValueFn(ticks, axis.scale), problem: null };
}

// Axis coordinates of a page point: {x, y}, with null for an uncalibrated
// axis (pixel offsets from the plot's top-left corner are then in px, py).
export function axisCoords(panel: Panel, p: Point) {
  const { u, v } = invertBilinear(panel.grid.corners!, p);
  const { width, height } = gridPixelSize(panel.grid.corners!);
  const x = axisFn(panel, 'x').fn;
  const y = axisFn(panel, 'y').fn;
  return { x: x ? x(u) : null, y: y ? y(v) : null, px: u * width, py: v * height, u, v };
}

// Real length per page pixel from a scale bar ({p1, p2, length, unit}), or
// null without one.
export function lengthPerPixel(scale: ScaleBar | null) {
  if (!scale?.p1 || !scale?.p2 || !(scale.length > 0)) return null;
  const px = Math.hypot(scale.p2.x - scale.p1.x, scale.p2.y - scale.p1.y);
  return px > 0 ? scale.length / px : null;
}

// How map.units ('axis' | 'px' | 'length') reports positions along `key`'s
// axis: 'axis' (tick values), 'length' (scale-bar units from the plot's
// top-left corner) or 'px'. A choice that is not available falls back to
// the axis, then the length, then pixels.
export function coordKind(panel: Panel, key: AxisKey, choice: MapUnits = panel.map.units): 'axis' | 'length' | 'px' {
  if (choice === 'px') return 'px';
  const hasAxis = !!(panel.grid.corners && axisFn(panel, key).fn);
  const scaled = lengthPerPixel(panel.scale) !== null;
  if (choice === 'length' && scaled) return 'length';
  return hasAxis ? 'axis' : scaled ? 'length' : 'px';
}

// {kind, name, at: position u or v across the plot (0..1) → coordinate} for
// `key`'s axis; name is the CSV header ('x', 'x_px', 'x_µm').
export function mapCoord(panel: Panel, key: AxisKey, choice?: MapUnits) {
  const kind = coordKind(panel, key, choice);
  const { width, height } = gridPixelSize(panel.grid.corners!);
  const side = key === 'x' ? width : height;
  if (kind === 'axis') return { kind, name: key, at: axisFn(panel, key).fn };
  const k = kind === 'length' ? (lengthPerPixel(panel.scale) as number) : 1;
  return { kind, name: `${key}_${kind === 'length' ? panel.scale!.unit : 'px'}`, at: (t: number) => t * side * k };
}

// Coordinates of the bin centres of a rows × cols field over the panel's plot
// area: axis values, scale-bar lengths or pixel offsets (mapCoord).
export function fieldCoords(panel: Panel, rows: number, cols: number): FieldCoords {
  const x = axisFn(panel, 'x');
  const y = axisFn(panel, 'y');
  const xc = mapCoord(panel, 'x');
  const yc = mapCoord(panel, 'y');
  return {
    xs: Array.from({ length: cols }, (_, c) => xc.at!((c + 0.5) / cols)),
    ys: Array.from({ length: rows }, (_, r) => yc.at!((r + 0.5) / rows)),
    xAxis: xc.kind === 'axis',
    yAxis: yc.kind === 'axis',
    xName: xc.name,
    yName: yc.name,
    axisProblems: [x.problem, y.problem].filter(Boolean) as string[],
  };
}
