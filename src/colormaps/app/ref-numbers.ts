import { cmapData } from '../../core/colormap-library.ts';
import { buildRefNumbers } from '../references.ts';

// The footer's reference numbers (key -> number, in the order of first use in
// the default Browse list). The footer lists the references in this order and
// the detail view's copies carry the same numbers, so both import it from here.
export const REF_NUMBERS = buildRefNumbers(cmapData.maps);
