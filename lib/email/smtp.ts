/**
 * Lightweight SMTP Email Adapter
 *
 * Formats standard RFC-compliant MIME messages and connects to SMTP servers
 * using Node.js built-in net/tls sockets.
 * Configured via environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE.
 *
 * Compliance:
 * - Physical inventory quantities only. Zero commercial metrics.
 * - Token-based links only; passwords are never sent or logged.
 */

import net from 'node:net';
import tls from 'node:tls';
import type { EmailAdapter } from './adapter';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
  timeoutMs?: number;
}

export function formatMimeMessage(options: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const dateStr = new Date().toUTCString();
  const domain = options.from.includes('@') ? options.from.split('@')[1] : 'localhost';
  const msgId =
    options.messageId ||
    `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;

  const headers: string[] = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    `Date: ${dateStr}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
  ];

  if (options.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      options.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      options.html,
      '',
      `--${boundary}--`,
      '',
    ];
    return parts.join('\r\n');
  }

  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: 7bit');
  const parts = [headers.join('\r\n'), '', options.text, ''];
  return parts.join('\r\n');
}

export async function sendRawSmtp(
  config: SmtpConfig,
  envelope: { from: string; to: string },
  mimeContent: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect({
          host: config.host,
          port: config.port,
          timeout: config.timeoutMs ?? 10000,
        })
      : net.connect({
          host: config.host,
          port: config.port,
          timeout: config.timeoutMs ?? 10000,
        });

    let buffer = '';
    let step = 0;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setEncoding('utf8');

    socket.on('timeout', () => {
      cleanup();
      reject(new Error('SMTP connection timed out'));
    });

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      const lastLine = lines[lines.length - 2] || lines[lines.length - 1];
      const match = /^(\d{3})(?: (.*))?$/.exec(lastLine.trim());
      if (!match) return;

      const code = parseInt(match[1], 10);
      buffer = '';

      try {
        switch (step) {
          case 0:
            if (code !== 220) throw new Error(`SMTP banner failed: ${lastLine}`);
            step = 1;
            socket.write(`EHLO localhost\r\n`);
            break;
          case 1:
            if (code !== 250) throw new Error(`EHLO failed: ${lastLine}`);
            if (config.user && config.pass) {
              step = 2;
              socket.write(`AUTH LOGIN\r\n`);
            } else {
              step = 5;
              socket.write(`MAIL FROM:<${envelope.from}>\r\n`);
            }
            break;
          case 2:
            if (code !== 334) throw new Error(`AUTH challenge failed: ${lastLine}`);
            step = 3;
            socket.write(`${Buffer.from(config.user || '').toString('base64')}\r\n`);
            break;
          case 3:
            if (code !== 334) throw new Error(`AUTH user challenge failed: ${lastLine}`);
            step = 4;
            socket.write(`${Buffer.from(config.pass || '').toString('base64')}\r\n`);
            break;
          case 4:
            if (code !== 235) throw new Error(`AUTH verification failed: ${lastLine}`);
            step = 5;
            socket.write(`MAIL FROM:<${envelope.from}>\r\n`);
            break;
          case 5:
            if (code !== 250) throw new Error(`MAIL FROM failed: ${lastLine}`);
            step = 6;
            socket.write(`RCPT TO:<${envelope.to}>\r\n`);
            break;
          case 6:
            if (code !== 250) throw new Error(`RCPT TO failed: ${lastLine}`);
            step = 7;
            socket.write(`DATA\r\n`);
            break;
          case 7:
            if (code !== 354) throw new Error(`DATA failed: ${lastLine}`);
            step = 8;
            socket.write(`${mimeContent}\r\n.\r\n`);
            break;
          case 8:
            if (code !== 250) throw new Error(`Message data failed: ${lastLine}`);
            step = 9;
            socket.write(`QUIT\r\n`);
            break;
          case 9:
            cleanup();
            resolve(true);
            break;
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

export class SmtpEmailAdapter implements EmailAdapter {
  private config: SmtpConfig;
  private customSender?: (
    config: SmtpConfig,
    envelope: { from: string; to: string },
    mime: string
  ) => Promise<boolean>;

  constructor(
    customConfig?: Partial<SmtpConfig>,
    customSender?: (
      config: SmtpConfig,
      envelope: { from: string; to: string },
      mime: string
    ) => Promise<boolean>
  ) {
    this.config = {
      host: customConfig?.host || process.env.SMTP_HOST || 'localhost',
      port:
        customConfig?.port ??
        (process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587),
      user: customConfig?.user || process.env.SMTP_USER,
      pass: customConfig?.pass || process.env.SMTP_PASS,
      from:
        customConfig?.from ||
        process.env.SMTP_FROM ||
        'no-reply@example.test',
      secure:
        customConfig?.secure ??
        (process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465'),
      timeoutMs: customConfig?.timeoutMs ?? 10000,
    };
    this.customSender = customSender;
  }

  async sendMail(options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    const from = this.config.from;
    const mime = formatMimeMessage({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    try {
      if (this.customSender) {
        return await this.customSender(this.config, { from, to: options.to }, mime);
      }
      return await sendRawSmtp(this.config, { from, to: options.to }, mime);
    } catch {
      return false;
    }
  }

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

    return this.sendMail({ to, subject, text });
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

    return this.sendMail({ to, subject, text });
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

    return this.sendMail({ to, subject, text });
  }
}
