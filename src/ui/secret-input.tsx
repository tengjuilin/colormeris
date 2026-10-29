// A password field for secrets (the OpenRouter key). It is uncontrolled on purpose: React writes a controlled
// input's `value` as an HTML attribute, which would put the secret into the DOM and its serialized HTML. Here
// the value is only ever set as the element's property, from `read()` after each render while the field is not
// focused. Typing reports the trimmed text (`onInput`); the native change event commits (`onCommit`).
import { type ComponentProps, useEffect, useLayoutEffect, useRef } from 'react';

export function SecretInput({
  read,
  onInput,
  onCommit,
  ...rest
}: Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'type' | 'onChange' | 'onInput' | 'onBlur'> & {
  /** The stored secret; read on every render and on blur. */
  read: () => string;
  onInput?: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  const el = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  const sync = () => {
    const node = el.current;
    if (node && document.activeElement !== node && node.value !== read()) node.value = read();
  };
  useLayoutEffect(() => {
    commit.current = onCommit;
    sync();
  });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const fire = () => commit.current?.(node.value);
    node.addEventListener('change', fire);
    return () => node.removeEventListener('change', fire);
  }, []);
  return (
    <input
      {...rest}
      ref={el}
      type="password"
      autoComplete="off"
      onInput={(e) => onInput?.((e.target as HTMLInputElement).value.trim())}
      onBlur={sync}
    />
  );
}
