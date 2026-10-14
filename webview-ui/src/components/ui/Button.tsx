import type { ButtonHTMLAttributes } from 'react';

const base = 'border-2 rounded cursor-pointer';

const sizes = {
  sm: 'py-1 px-8 text-sm',
  md: 'py-2 px-12',
  lg: 'py-3 px-14 text-lg',
  xl: 'py-6 px-24 text-xl',
  icon: 'p-0 w-16 h-16 flex items-center justify-center',
  icon_lg: 'p-0 w-40 h-40 flex items-center justify-center',
} as const;

const variants = {
  default: `${base} bg-btn-bg text-ink border-ink hover:bg-btn-hover`,
  active: `${base} bg-active-bg text-ink border-ink`,
  disabled: `${base} bg-btn-bg text-ink border-ink cursor-default opacity-[var(--btn-disabled-opacity)]`,
  accent: `${base} bg-confirm! text-white hover:bg-confirm-hover! border-ink`,
  ghost: `${base} bg-transparent text-text-muted border-transparent hover:text-text`,
  /** For a close button sitting directly on a .hud-titlebar (always white text,
   *  never the scoped ink text the other variants pick up inside .hud-window). */
  titlebar: `${base} bg-transparent text-white border-transparent hover:bg-white/20`,
} as const;

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'default',
  size = 'lg',
  className = '',
  ...props
}: ButtonProps) {
  return <button className={`${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
