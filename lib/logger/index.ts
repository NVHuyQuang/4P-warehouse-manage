/**
 * lib/logger/index.ts
 * Structured JSON Logger for Pizza 4P's India Inventory Control Tool.
 *
 * Requirements:
 * - Single-line JSON formatted for CloudWatch / stdout.
 * - Automatic redaction of sensitive credentials, tokens, and PII.
 * - Zero commercial or confidential figures (quantities only).
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message?: string;
  event?: string;
  error?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Sensitive key pattern matching credentials, tokens, cookies, secrets, and PII.
 */
const SENSITIVE_KEY_REGEX =
  /(password|token|secret|authorization|cookie|jwt|credit_?card|api_?key|bearer|ssn|cvv|pin|private_?key)/i;

/**
 * Bearer token pattern for inline redaction within strings.
 */
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi;

/**
 * JWT token pattern (header.payload.signature) for inline redaction.
 */
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;

/**
 * Recursively sanitizes data by replacing values of sensitive keys with '[REDACTED]'.
 * Also scrubs bearer tokens and JWT patterns from string values.
 */
export function sanitizeLogData<T = unknown>(data: T, seen = new WeakSet<object>()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // If the entire string is a Bearer authorization token
    if (/^Bearer\s+\S+$/i.test(data.trim())) {
      return '[REDACTED]' as unknown as T;
    }
    // Replace inline bearer tokens and JWT strings
    let sanitized = data.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(JWT_REGEX, '[REDACTED]');
    return sanitized as unknown as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  // Handle Error instances cleanly
  if (data instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: data.name,
      message: sanitizeLogData(data.message, seen),
      stack: data.stack ? sanitizeLogData(data.stack, seen) : undefined,
    };
    for (const [k, v] of Object.entries(data)) {
      if (k === 'name' || k === 'message' || k === 'stack') continue;
      errorObj[k] = SENSITIVE_KEY_REGEX.test(k) ? '[REDACTED]' : sanitizeLogData(v, seen);
    }
    return errorObj as unknown as T;
  }

  // Prevent cyclical object traversal
  if (seen.has(data as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeLogData(value, seen);
    }
  }

  return result as unknown as T;
}

/**
 * Formats a log entry into a structured object with timestamp and level.
 */
export function formatLogEntry(options: {
  level: LogLevel;
  message?: string;
  event?: string;
  error?: unknown;
  meta?: Record<string, unknown>;
}): LogEntry {
  const { level, message, event, error, meta } = options;

  let errorData: Record<string, unknown> | undefined;
  if (error instanceof Error) {
    errorData = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  } else if (error !== undefined && error !== null) {
    errorData = typeof error === 'object'
      ? (error as Record<string, unknown>)
      : { message: String(error) };
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    ...(message !== undefined ? { message } : {}),
    ...(event !== undefined ? { event } : {}),
    ...(errorData !== undefined ? { error: errorData } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };

  return entry;
}

/**
 * Serializes a log entry to a single-line JSON string formatted for CloudWatch / stdout.
 */
export function serializeLogEntry(entry: LogEntry): string {
  const sanitized = sanitizeLogData(entry);
  return JSON.stringify(sanitized);
}

export interface StructuredLogger {
  info(msg: string, meta?: Record<string, unknown>): string;
  warn(msg: string, meta?: Record<string, unknown>): string;
  error(msg: string, err?: unknown, meta?: Record<string, unknown>): string;
  security(event: string, meta?: Record<string, unknown>): string;
}

/**
 * Structured JSON Logger singleton.
 */
export const logger: StructuredLogger = {
  info(msg: string, meta?: Record<string, unknown>): string {
    const entry = formatLogEntry({ level: 'INFO', message: msg, meta });
    const serialized = serializeLogEntry(entry);
    console.info(serialized);
    return serialized;
  },

  warn(msg: string, meta?: Record<string, unknown>): string {
    const entry = formatLogEntry({ level: 'WARN', message: msg, meta });
    const serialized = serializeLogEntry(entry);
    console.warn(serialized);
    return serialized;
  },

  error(msg: string, err?: unknown, meta?: Record<string, unknown>): string {
    const entry = formatLogEntry({ level: 'ERROR', message: msg, error: err, meta });
    const serialized = serializeLogEntry(entry);
    console.error(serialized);
    return serialized;
  },

  security(event: string, meta?: Record<string, unknown>): string {
    const entry = formatLogEntry({ level: 'SECURITY', event, message: event, meta });
    const serialized = serializeLogEntry(entry);
    console.info(serialized);
    return serialized;
  },
};

export default logger;
