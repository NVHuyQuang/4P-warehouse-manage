import React from 'react';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: React.ReactNode;
  count?: number | string;
  active?: boolean;
}

export function Chip({
  label,
  count,
  active = false,
  className = '',
  ...props
}: ChipProps) {
  return (
    <button
      type="button"
      className={`chip ${active ? 'on' : ''} ${className}`.trim()}
      aria-pressed={active}
      {...props}
    >
      {label}
      {count != null && <span className="n">{count}</span>}
    </button>
  );
}

export interface ChipsProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Chips({ children, className = '', ...props }: ChipsProps) {
  return (
    <div className={`chips ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
