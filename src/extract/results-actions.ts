// What every Results card's buttons do with a table: download it as a CSV named after the project and panel,
// or copy it as tab-separated text for a spreadsheet, with a toast either way the clipboard answers.
import type { Panel, Workspace } from '../types/index.ts';

/** Downloads `csv` as `<project>_<panel><suffix>.csv`. */
export function downloadCsv(ws: Pick<Workspace, 'download' | 'csvName'>, panel: Panel, csv: string, suffix = '') {
  ws.download(new Blob([csv], { type: 'text/csv' }), ws.csvName(panel, suffix));
}

/** Copies a tab-separated table to the clipboard and says whether it worked. */
export async function copyTable(ws: Pick<Workspace, 'toast'>, tsv: string) {
  try {
    await navigator.clipboard.writeText(tsv);
    ws.toast('Table copied — paste into a spreadsheet.');
  } catch {
    ws.toast('Clipboard is not available here.', true);
  }
}
