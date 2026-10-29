// Buttons of the sidebar UI standard: Btn (.btn with variant, icon, pressed state and hotkey cap),
// MainStep (a card's block-wide main action) and IconBtn (icon-only button for the card head).
import type { ComponentProps } from 'react';
import { hotkeyTitle } from '../extract/settings/settings.ts';
import { useSettings } from './settings-context.tsx';

export type BtnIcon =
  | 'place'
  | 'plus'
  | 'zoom'
  | 'trash'
  | 'download'
  | 'copy'
  | 'detect'
  | 'type'
  | 'ai'
  | 'ruler'
  | 'line'
  | 'layers'
  | 'play'
  | 'pause'
  | 'stop'
  | 'reset'
  | 'settings';

export interface BtnProps extends ComponentProps<'button'> {
  variant?: 'default' | 'primary' | 'danger' | 'subtle';
  /** `data-icon`, drawn by CSS. */
  icon?: BtnIcon;
  /** Hotkey action id; `title` is then the template, e.g. "Shortcut: {key}". */
  hotkey?: string;
  /** Do not draw the first key as a key cap. */
  noCap?: boolean;
  /** Toggle state: `.active` and `aria-pressed`. Leave undefined for a plain button. */
  pressed?: boolean;
  block?: boolean;
}

export function Btn({
  variant = 'default',
  icon,
  hotkey,
  noCap,
  pressed,
  block,
  type = 'button',
  className,
  title,
  children,
  ...rest
}: BtnProps) {
  const { settings, label } = useSettings();
  const tip = hotkey ? hotkeyTitle(title ?? '', settings.hotkeys[hotkey] ?? [], label) : null;
  const classes = ['btn', variant !== 'default' && variant, block && 'block', pressed && 'active', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      title={tip ? tip.title : title}
      aria-pressed={pressed}
      data-icon={icon}
      data-hotkey={hotkey}
      data-react={hotkey ? '' : undefined}
      data-title={hotkey ? title : undefined}
      data-key={tip?.key}
      data-no-cap={noCap ? '' : undefined}
    >
      {children}
    </button>
  );
}

/** A card's main step: a block-wide button on its own row. Pass `variant="primary"` where the standard asks for it. */
export function MainStep(props: BtnProps) {
  return <Btn {...props} block />;
}

/** Icon-only button for `.head-actions`; `label` is both the tooltip (template when `hotkey` is set) and the accessible name. */
export function IconBtn({
  icon,
  label,
  className,
  ...rest
}: Omit<BtnProps, 'icon' | 'title' | 'aria-label' | 'children' | 'block'> & {
  icon: BtnIcon;
  label: string;
}) {
  return (
    <Btn
      {...rest}
      icon={icon}
      title={label}
      aria-label={label}
      className={['icon-only', className].filter(Boolean).join(' ')}
    />
  );
}
