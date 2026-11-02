import React from 'react';

export interface TicketProps extends React.HTMLAttributes<HTMLDivElement> {
  no: React.ReactNode;
  right?: React.ReactNode;
  pad?: boolean;
  children: React.ReactNode;
}

export function Ticket({
  no,
  right,
  pad = true,
  children,
  className = '',
  ...props
}: TicketProps) {
  return (
    <div className={`tk ${className}`.trim()} {...props}>
      <div className="perf" />
      <div className="tk-head">
        <span className="no">{no}</span>
        <span className="fill" />
        {right && <span>{right}</span>}
      </div>
      {pad ? <div className="tk-body">{children}</div> : children}
      <div className="perf perf-b" />
    </div>
  );
}
