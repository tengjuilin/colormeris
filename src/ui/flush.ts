// flushSync that refuses to nest: React warns and misbehaves when flushSync is called while it is already
// flushing (or rendering). Returns false when it did not run `fn`, so the caller can defer or fall back.
import { flushSync } from 'react-dom';

let flushing = false;

export function flushSafely(fn: () => void): boolean {
  if (flushing) return false;
  flushing = true;
  try {
    flushSync(fn);
  } finally {
    flushing = false;
  }
  return true;
}
