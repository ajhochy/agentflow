import { logger } from './logger.js';

export type RetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: (error: unknown) => boolean;
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: isRetryableError,
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limits, timeouts, server errors
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('timeout') || msg.includes('timed out')) return true;
    if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !opts.retryableErrors(error)) {
        throw error;
      }

      const delay = Math.min(opts.initialDelayMs * Math.pow(2, attempt), opts.maxDelayMs);
      logger.warn(
        `[${label}] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${(error as Error).message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
