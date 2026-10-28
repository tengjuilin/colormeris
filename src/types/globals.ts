// Globals the classic scripts read or set. They stay during the 1:1
// conversion (each use is marked `// TODO(vite)`) and go once the vendored
// libraries come from npm imports.

import type JSZipType from 'jszip';
import type { ChatClient, ColormerisApi } from './agent.ts';

/** The OpenRouter SDK module (npm @openrouter/sdk), loaded lazily by agent/openrouter-client.ts; tests and mocks may set globalThis.OpenRouterSDK. */
export interface OpenRouterSdk {
  OpenRouter: new (opts: { apiKey: string; appTitle?: string; httpReferer?: string; serverURL?: string }) => ChatClient;
}

/** The classic-script embed of pdf.js used from file:// (scripts/embed-pdfjs.mjs). */
export interface PdfjsSource {
  lib: string;
  worker: string;
}

declare global {
  interface Window {
    /** The typed agent API (extract/main.ts). */
    colormeris?: ColormerisApi;
    /** Vendored JSZip, loaded by a script tag in extract.html. */
    JSZip?: typeof JSZipType;
  }
  // `var` is how a global property is declared for globalThis.
  /** Dev only (pages/extract.ts): the exports of the pure modules, for console debugging. */
  var Colormeris: Readonly<Record<string, unknown>> | undefined;
  var OpenRouterSDK: OpenRouterSdk | undefined;
  var ColormerisPdfjsSource: PdfjsSource | undefined;
  var pdfjsWorker: unknown;
}
