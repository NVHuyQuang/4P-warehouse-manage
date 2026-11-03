/**
 * In-Memory Dev Email Catcher
 *
 * Captures outgoing emails in memory for development, staging, and automated testing.
 * Exposes inspection and reset helpers: getSentMails(), clearSentMails().
 *
 * Privacy & Security:
 * - Never stores passwords (tokens only).
 * - Physical inventory quantities only.
 */

import type { EmailAdapter, EmailMessage } from './adapter';

export interface SentMail extends EmailMessage {
  type: 'invitation' | 'password_reset' | 'variance_alert';
  sentAt: Date;
  metadata?: {
    activationToken?: string;
    resetToken?: string;
    role?: string;
    storeId?: string;
    balanceDate?: string;
    summary?: string;
    activationLink?: string;
    resetLink?: string;
  };
}

let sentMails: SentMail[] = [];

/**
 * Returns a shallow copy of all captured messages.
 */
export function getSentMails(): SentMail[] {
  return [...sentMails];
}

/**
 * Clears all captured messages in memory.
 */
export function clearSentMails(): void {
  sentMails = [];
}

export class DevCatcherEmailAdapter implements EmailAdapter {
  async sendInvitationEmail(
    to: string,
    activationToken: string,
    role: string,
    storeId: string
  ): Promise<boolean> {
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const activationLink = `${origin}/activate?token=${activationToken}`;
    const subject = 'Warehouse Inventory Tool - Staff Account Invitation';
    const text = [
      'Welcome to Warehouse Inventory Tool.',
      `You have been invited with role: ${role}`,
      `Assigned Store: ${storeId}`,
      '',
      'To activate your account, click the link below:',
      activationLink,
      '',
      'This activation link will expire in 48 hours.',
      'Never share this link with anyone.',
    ].join('\n');

    sentMails.push({
      to,
      from: 'no-reply@example.test',
      subject,
      text,
      type: 'invitation',
      sentAt: new Date(),
      metadata: {
        activationToken,
        role,
        storeId,
        activationLink,
      },
    });

    return true;
  }

  async sendPasswordResetEmail(
    to: string,
    resetToken: string
  ): Promise<boolean> {
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const resetLink = `${origin}/reset-password?token=${resetToken}`;
    const subject = 'Warehouse Inventory Tool - Password Reset Request';
    const text = [
      'A password reset request was initiated for your account.',
      '',
      'To reset your password, visit the link below:',
      resetLink,
      '',
      'This link will expire in 1 hour.',
      'If you did not request this, please contact your system administrator.',
    ].join('\n');

    sentMails.push({
      to,
      from: 'no-reply@example.test',
      subject,
      text,
      type: 'password_reset',
      sentAt: new Date(),
      metadata: {
        resetToken,
        resetLink,
      },
    });

    return true;
  }

  async sendVarianceAlertEmail(
    to: string,
    storeId: string,
    balanceDate: string,
    summary: string
  ): Promise<boolean> {
    const subject = `Quantity Variance Alert: Store ${storeId} (${balanceDate})`;
    const text = [
      `A stock balance quantity variance has been flagged for store ${storeId} on ${balanceDate}.`,
      '',
      'Quantity Summary:',
      summary,
      '',
      'Please review the daily balance in the warehouse management tool.',
    ].join('\n');

    sentMails.push({
      to,
      from: 'alerts@example.test',
      subject,
      text,
      type: 'variance_alert',
      sentAt: new Date(),
      metadata: {
        storeId,
        balanceDate,
        summary,
      },
    });

    return true;
  }
}

export const devCatcherAdapter = new DevCatcherEmailAdapter();
