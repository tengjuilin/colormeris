// Copy pdf.js's data folders (CJK cmaps, standard fonts, wasm decoders, ICC
// profiles) from node_modules into public/pdfjs/, where pdf-loader.ts asks
// for them. Runs before `npm run dev` and `npm run build`; public/pdfjs is
// git-ignored, so the folders always match the installed pdfjs-dist.
import { cpSync, rmSync } from 'node:fs';

const from = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const to = new URL('../public/pdfjs/', import.meta.url);
rmSync(to, { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(new URL(`${dir}/`, from), new URL(`${dir}/`, to), { recursive: true });
