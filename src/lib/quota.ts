import { GeminiQuota } from '../services/GeminiQuota';

export type QuotaSnapshot = {
  ok: true;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
};

export type QuotaError = {
  ok: false;
  error: string;
};

export function getQuotaSnapshot(): QuotaSnapshot {
  const quota = new GeminiQuota();
  const limit = quota.getLimit();
  const remaining = quota.getRemaining();
  const used = Math.max(0, limit - remaining);

  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));

  return {
    ok: true,
    limit,
    used,
    remaining,
    resetsAt: reset.toISOString(),
  };
}

export function quotaUnauthorized(): QuotaError {
  return { ok: false, error: 'Unauthorized' };
}
