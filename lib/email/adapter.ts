/**
 * Email Adapter Interface
 *
 * Provides transactional email dispatch abstractions for:
 * - User activation invitations
 * - Password reset requests
 * - Physical inventory quantity variance alerts
 *
 * Compliance:
 * - Physical quantities only. Strictly operational metrics only.
 * - India DPDP Act compliance: secure tokenized links only; passwords never transmitted or logged.
 */

export interface EmailAdapter {
  /**
   * Dispatches an account invitation email with a secure activation token.
   */
  sendInvitationEmail(
    to: string,
    activationToken: string,
    role: string,
    storeId: string
  ): Promise<boolean>;

  /**
   * Dispatches a password reset email with a secure reset token.
   */
  sendPasswordResetEmail(
    to: string,
    resetToken: string
  ): Promise<boolean>;

  /**
   * Dispatches an alert when physical count variance exceeds tolerance thresholds.
   */
  sendVarianceAlertEmail(
    to: string,
    storeId: string,
    balanceDate: string,
    summary: string
  ): Promise<boolean>;
}

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
}
