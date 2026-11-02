import React from 'react';

export type BadgeVariant = 'ok' | 'am' | 'er' | 're' | 'mu' | 'ur';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export function Badge({ variant = 'ok', children, className = '', ...props }: BadgeProps) {
  return (
    <span className={`b ${variant} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}

export interface StampProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function Stamp({ children, className = '', ...props }: StampProps) {
  return (
    <span className={`stamp ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
