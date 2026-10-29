// The coordinate units select, shared by the Profiles card (X axis, id profile-x) and the Results card
// (Coordinates, id map-units): options that are not available are disabled, the length option is named by the
// scale bar's unit, and it shows `value`, what is reported (which may be a fallback from the setting).
import type { MapUnits, Panel } from '../../../types/index.ts';
import { BoundSelect } from '../../../ui/index.ts';
import { lengthPerPixel } from '../field.ts';

export function UnitsSelect({
  id,
  panel,
  hasAxis,
  value,
  onChange,
}: {
  id: string;
  panel: Panel;
  hasAxis: boolean;
  value: string;
  onChange: (units: MapUnits) => void;
}) {
  return (
    <BoundSelect id={id} value={value} onChange={(v) => onChange(v as MapUnits)}>
      <option value="axis" disabled={!hasAxis}>
        Axis
      </option>
      <option value="px">px</option>
      <option value="length" disabled={lengthPerPixel(panel.scale) === null}>
        {panel.scale?.unit ?? 'Scale bar'}
      </option>
    </BoundSelect>
  );
}
