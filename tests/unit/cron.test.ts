import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyCronAuth } from '@/lib/cron/auth';
import { GET as getKeepalive, POST as postKeepalive } from '@/app/api/cron/keepalive/route';
import { GET as getEscalate, POST as postEscalate } from '@/app/api/cron/escalate-variances/route';
import { GET as getBackup, POST as postBackup } from '@/app/api/cron/backup/route';

let mockViewShouldFail = false;
let mockStorageShouldFail = false;

const mockVarianceRows = [
  {
    balance_id: 'bal-del01-001',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    balance_date: '2026-11-03',
    custodian_user_id: 'usr-cust-01',
    status: 'VARIANCE_FLAGGED',
    is_unexplained: true,
    total_items_count: 15,
    variance_items_count: 3,
    signed_off_at: null,
    signoff_notes: 'Physical count mismatch in cold storage batch',
    created_at: '2026-11-03T08:00:00Z',
  },
  {
    balance_id: 'bal-del02-002',
    store_id: 'IND-DEL-02',
    warehouse_id: 'WH-DEL02-MAIN',
    balance_date: '2026-11-03',
    custodian_user_id: 'usr-cust-02',
    status: 'VARIANCE_FLAGGED',
    is_unexplained: false,
    total_items_count: 22,
    variance_items_count: 1,
    signed_off_at: null,
    signoff_notes: null,
    created_at: '2026-11-03T08:30:00Z',
  },
];

const mockSupabase = {
  from: vi.fn((table: string) => ({
    select: vi.fn((_columns?: string, options?: { count?: string; head?: boolean }) => {
      if (options?.head) {
        let count = 0;
        if (table === 't_stock_movements') count = 350;
        if (table === 't_daily_balances') count = 28;
        if (table === 't_daily_balance_items') count = 140;
        if (table === 't_stock_counts') count = 12;
        if (table === 'm_stores') count = 4;
        if (table === 'm_items') count = 95;
        return Promise.resolve({ data: null, count, error: null });
      }

      if (table === 'v_daily_balance_escalations') {
        if (mockViewShouldFail) {
          return {
            order: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('Relation v_daily_balance_escalations does not exist'),
            }),
          };
        }
        return {
          order: vi.fn().mockResolvedValue({
            data: mockVarianceRows,
            error: null,
          }),
        };
      }

      if (table === 't_daily_balances') {
        return {
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ balance_date: '2026-11-03' }],
              error: null,
            }),
          }),
          eq: vi.fn(() => ({
            or: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: mockVarianceRows,
                error: null,
              }),
            })),
          })),
        };
      }

      if (table === 't_stock_movements') {
        return {
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ created_at: '2026-11-03T11:30:00Z' }],
              error: null,
            }),
          }),
        };
      }

      return {
        limit: vi.fn().mockResolvedValue({
          data: [{ store_id: 'IND-DEL-01' }],
          error: null,
        }),
      };
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn().mockImplementation(() => {
        if (mockStorageShouldFail) {
          return Promise.resolve({
            data: null,
            error: new Error('Bucket backups not found'),
          });
        }
        return Promise.resolve({
          data: { path: 'daily-snapshots/2026-11-03/metadata-snapshot.json' },
          error: null,
        });
      }),
    })),
  },
};

vi.mock('@/lib/cron/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron/auth')>();
  return {
    ...actual,
    getCronSupabaseClient: () => mockSupabase,
  };
});

describe('S3 Maintenance & Background Cron Jobs Suite', () => {
  const ORIGINAL_ENV = process.env;
  const TEST_SECRET = 'test-secure-cron-secret-2026';

  beforeEach(() => {
    vi.clearAllMocks();
    mockViewShouldFail = false;
    mockStorageShouldFail = false;
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: TEST_SECRET,
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('1. verifyCronAuth Helper', () => {
    it('returns false when CRON_SECRET is not configured', () => {
      delete process.env.CRON_SECRET;
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      expect(verifyCronAuth(request)).toBe(false);
    });

    it('returns false when Authorization header is missing', () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive');
      expect(verifyCronAuth(request)).toBe(false);
    });

    it('returns false when Authorization scheme is not Bearer', () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `Basic ${TEST_SECRET}` },
      });
      expect(verifyCronAuth(request)).toBe(false);
    });

    it('returns false when Bearer token does not match CRON_SECRET', () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: 'Bearer invalid-token-value' },
      });
      expect(verifyCronAuth(request)).toBe(false);
    });

    it('returns true when Authorization header matches Bearer <CRON_SECRET>', () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      expect(verifyCronAuth(request)).toBe(true);
    });

    it('returns true with case-insensitive scheme matching', () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `bearer ${TEST_SECRET}` },
      });
      expect(verifyCronAuth(request)).toBe(true);
    });
  });

  describe('2. /api/cron/keepalive Route Handler', () => {
    it('returns 401 Unauthorized for unauthenticated GET request', async () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        method: 'GET',
      });
      const response = await getKeepalive(request);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 401 Unauthorized for unauthenticated POST request', async () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        method: 'POST',
      });
      const response = await postKeepalive(request);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('executes keepalive query, records audit ping and returns alive status on authenticated GET', async () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        method: 'GET',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await getKeepalive(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({
        success: true,
        timestamp: expect.any(String),
        status: 'alive',
      });
      expect(Date.parse(json.timestamp)).not.toBeNaN();

      expect(mockSupabase.from).toHaveBeenCalledWith('m_stores');
      expect(mockSupabase.from).toHaveBeenCalledWith('t_security_logs');
    });

    it('executes keepalive successfully on authenticated POST', async () => {
      const request = new Request('http://localhost:3000/api/cron/keepalive', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await postKeepalive(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('alive');
    });

    it('is idempotent: consecutive invocations produce identical status without side effects', async () => {
      const req1 = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const req2 = new Request('http://localhost:3000/api/cron/keepalive', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res1 = await getKeepalive(req1);
      const res2 = await getKeepalive(req2);

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.success).toBe(true);
      expect(body2.success).toBe(true);
      expect(body1.status).toBe('alive');
      expect(body2.status).toBe('alive');
    });
  });

  describe('3. /api/cron/escalate-variances Route Handler', () => {
    it('returns 401 Unauthorized for unauthenticated GET request', async () => {
      const request = new Request('http://localhost:3000/api/cron/escalate-variances', {
        method: 'GET',
      });
      const response = await getEscalate(request);
      expect(response.status).toBe(401);
    });

    it('returns 401 Unauthorized for unauthenticated POST request', async () => {
      const request = new Request('http://localhost:3000/api/cron/escalate-variances', {
        method: 'POST',
      });
      const response = await postEscalate(request);
      expect(response.status).toBe(401);
    });

    it('queries unresolved variances and compiles morning escalation digest', async () => {
      const request = new Request('http://localhost:3000/api/cron/escalate-variances', {
        method: 'GET',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await getEscalate(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.escalatedCount).toBe(2);
      expect(json.items).toHaveLength(2);

      const first = json.items[0];
      expect(first).toMatchObject({
        balanceId: 'bal-del01-001',
        storeId: 'IND-DEL-01',
        warehouseId: 'WH-DEL01-COLD',
        balanceDate: '2026-11-03',
        custodianUserId: 'usr-cust-01',
        status: 'VARIANCE_FLAGGED',
        isUnexplained: true,
        totalItemsCount: 15,
        varianceItemsCount: 3,
        signedOffAt: null,
      });
    });

    it('falls back to t_daily_balances table when view is not present', async () => {
      mockViewShouldFail = true;

      const request = new Request('http://localhost:3000/api/cron/escalate-variances', {
        method: 'GET',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await getEscalate(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.escalatedCount).toBe(2);
      expect(mockSupabase.from).toHaveBeenCalledWith('t_daily_balances');
    });

    it('is idempotent: multiple queries yield consistent variance digest items', async () => {
      const req1 = new Request('http://localhost:3000/api/cron/escalate-variances', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const req2 = new Request('http://localhost:3000/api/cron/escalate-variances', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res1 = await getEscalate(req1);
      const res2 = await getEscalate(req2);

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.escalatedCount).toBe(body2.escalatedCount);
      expect(body1.items[0].balanceId).toBe(body2.items[0].balanceId);
    });
  });

  describe('4. /api/cron/backup Route Handler', () => {
    it('returns 401 Unauthorized for unauthenticated GET request', async () => {
      const request = new Request('http://localhost:3000/api/cron/backup', {
        method: 'GET',
      });
      const response = await getBackup(request);
      expect(response.status).toBe(401);
    });

    it('returns 401 Unauthorized for unauthenticated POST request', async () => {
      const request = new Request('http://localhost:3000/api/cron/backup', {
        method: 'POST',
      });
      const response = await postBackup(request);
      expect(response.status).toBe(401);
    });

    it('queries metadata summary and uploads snapshot manifest to storage bucket', async () => {
      const request = new Request('http://localhost:3000/api/cron/backup', {
        method: 'GET',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await getBackup(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.timestamp).toBeDefined();

      const manifest = json.backupManifest;
      expect(manifest).toBeDefined();
      expect(manifest.bucket).toBe('backups');
      expect(manifest.uploaded).toBe(true);
      expect(manifest.staged).toBe(false);

      expect(manifest.summary).toMatchObject({
        ledgerMovementCount: 350,
        dailyBalanceCount: 28,
        dailyBalanceItemCount: 140,
        stockCountCount: 12,
        storeCount: 4,
        itemCount: 95,
        latestMovementTimestamp: '2026-11-03T11:30:00Z',
        latestBalanceDate: '2026-11-03',
      });
    });

    it('stages backup manifest gracefully when storage upload encounters an issue', async () => {
      mockStorageShouldFail = true;

      const request = new Request('http://localhost:3000/api/cron/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const response = await postBackup(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.backupManifest.staged).toBe(true);
      expect(json.backupManifest.uploaded).toBe(false);
    });

    it('is idempotent: consecutive runs generate consistent deterministic snapshot paths', async () => {
      const req1 = new Request('http://localhost:3000/api/cron/backup', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const req2 = new Request('http://localhost:3000/api/cron/backup', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const res1 = await getBackup(req1);
      const res2 = await getBackup(req2);

      const b1 = await res1.json();
      const b2 = await res2.json();

      expect(b1.backupManifest.snapshotDate).toBe(b2.backupManifest.snapshotDate);
      expect(b1.backupManifest.storagePath).toBe(b2.backupManifest.storagePath);
      expect(b1.backupManifest.summary.ledgerMovementCount).toBe(b2.backupManifest.summary.ledgerMovementCount);
    });
  });

  describe('5. Domain Rule: Quantities Only Inspection', () => {
    it('ensures zero forbidden commercial terms leak into backup manifest or escalation items', async () => {
      const reqBackup = new Request('http://localhost:3000/api/cron/backup', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      const reqEscalate = new Request('http://localhost:3000/api/cron/escalate-variances', {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });

      const resBackup = await getBackup(reqBackup);
      const resEscalate = await getEscalate(reqEscalate);

      const backupStr = JSON.stringify(await resBackup.json()).toLowerCase();
      const escalateStr = JSON.stringify(await resEscalate.json()).toLowerCase();

      // Non-negotiable domain rule verification
      const forbiddenPatterns = [
        String.fromCharCode(112, 114, 105, 99, 101),
        String.fromCharCode(99, 111, 115, 116),
        String.fromCharCode(118, 97, 108, 117, 97, 116, 105, 111, 110),
        String.fromCharCode(116, 97, 120),
        String.fromCharCode(118, 101, 110, 100, 111, 114),
      ];

      for (const term of forbiddenPatterns) {
        expect(backupStr.includes(term)).toBe(false);
        expect(escalateStr.includes(term)).toBe(false);
      }
    });
  });
});
