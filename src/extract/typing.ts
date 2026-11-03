// Whether a key event belongs to a form field rather than to the app's shortcuts. One rule for the hotkeys,
// the tools' Delete / Enter / Backspace keys and pasting an image, and a wider one for the viewer's Space pan.
const FIELD_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;
// Inputs that take no text: shortcuts still work while one has the focus.
const NO_TEXT_TYPES = new Set(['checkbox', 'range']);

/** The target takes typed text (a text, number or select field, or editable content). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return FIELD_TAGS.test(target.tagName) && !NO_TEXT_TYPES.has((target as HTMLInputElement).type);
}

/** The target is any form field, checkboxes included (Space toggles them, so the viewer must not pan). */
export function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || FIELD_TAGS.test(target.tagName));
}
