import type { Metadata } from 'next';
import React from 'react';
import '@/styles/globals.css';
import { Shell } from '@/components/ui/shell';

export const metadata: Metadata = {
  title: "Pizza 4P's Inventory Control Tool — Desktop",
  description: 'Internal inventory control and stock ledger system for Pizza 4P’s India',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
