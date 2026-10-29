// Fields bound to a model value: BoundInput (text, number or textarea) and BoundSelect.
// BoundInput shows its own draft while focused and ignores model updates (so "", "1." and the caret survive
// typing); on blur it shows the model again. `onInput` fires on every keystroke, `onCommit` on the native
// change event (React's onChange is `input`) and then the draft is resynced to the model, so a clamped
// value shows even while the field keeps the focus.
import { type ComponentProps, type ReactNode, type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Kind = 'number' | 'text' | 'textarea';
type El = HTMLInputElement & HTMLTextAreaElement;

/** The number typed in a field, or null for "", "1e" or anything else that is not a finite number. */
export function parseNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

export function BoundInput({
  value,
  kind = 'text',
  onFocus,
  onInput,
  onCommit,
  ref,
  ...rest
}: Omit<ComponentProps<'input'>, 'value' | 'type' | 'onChange' | 'onInput' | 'onFocus' | 'onBlur' | 'ref'> & {
  value: string | number;
  kind?: Kind;
  /** Textarea height. */
  rows?: number;
  ref?: Ref<El>;
  onFocus?: () => void;
  onInput?: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const el = useRef<El | null>(null);
  const commit = useRef(onCommit);
  const model = useRef(value);
  useLayoutEffect(() => {
    commit.current = onCommit;
    model.current = value;
  });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const fire = () => {
      commit.current?.(node.value);
      setDraft((d) => (d === null ? null : String(model.current)));
    };
    node.addEventListener('change', fire);
    return () => node.removeEventListener('change', fire);
  }, []);

  const setRef = (node: El | null) => {
    el.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  const shared = {
    ref: setRef,
    value: draft ?? String(value),
    onFocus: () => {
      setDraft(String(value));
      onFocus?.();
    },
    onBlur: () => setDraft(null),
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      onInput?.(e.target.value);
    },
  };
  if (kind === 'textarea') return <textarea {...(rest as ComponentProps<'textarea'>)} {...shared} />;
  return <input {...rest} type={kind} {...shared} />;
}

/** A controlled select. Give options as `options` or as <option> children. */
export function BoundSelect({
  value,
  options,
  onChange,
  children,
  ...rest
}: Omit<ComponentProps<'select'>, 'value' | 'onChange'> & {
  value: string | number;
  options?: { value: string | number; label: string; title?: string }[];
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <select {...rest} value={String(value)} onChange={(e) => onChange(e.target.value)}>
      {options?.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}
