BEGIN;
SELECT plan(44);

-- 1. Table Existence
SELECT has_table('m_users', 'Table m_users exists');
SELECT has_table('m_user_invitations', 'Table m_user_invitations exists');
SELECT has_table('m_user_permissions', 'Table m_user_permissions exists');
SELECT has_table('t_security_logs', 'Table t_security_logs exists');

-- 2. Schema Integrity & Invariants (No password_hash in application tables)
SELECT hasnt_column('m_users', 'password_hash', 'm_users must NOT contain password_hash');
SELECT has_column('m_users', 'user_id', 'm_users has user_id');
SELECT has_column('m_users', 'email', 'm_users has email');
SELECT has_column('m_users', 'full_name', 'm_users has full_name');
SELECT has_column('m_users', 'failed_login_count', 'm_users has failed_login_count');
SELECT has_column('m_users', 'lockout_until', 'm_users has lockout_until');
SELECT has_column('m_users', 'is_active', 'm_users has is_active');
SELECT col_is_pk('m_users', 'user_id', 'user_id is primary key of m_users');

-- 3. Row-Level Security Enabled
SELECT ok(rowsecurity, 'm_users has RLS enabled') FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_users';
SELECT ok(rowsecurity, 'm_user_invitations has RLS enabled') FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_user_invitations';
SELECT ok(rowsecurity, 'm_user_permissions has RLS enabled') FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_user_permissions';
SELECT ok(rowsecurity, 't_security_logs has RLS enabled') FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_security_logs';

-- 4. Seed Data Verification (10 Core Seed Users from synthetic-seed.ts)
SELECT is(
  (SELECT count(*)::integer FROM m_users WHERE email LIKE '%@example.test'),
  12,
  'All 10 core + 2 extended seed users exist in m_users'
);

SELECT results_eq(
  'SELECT role::text FROM m_user_permissions WHERE user_id = ''usr-sysadmin-01''',
  ARRAY['SYSTEM_ADMIN'],
  'usr-sysadmin-01 has SYSTEM_ADMIN role'
);

SELECT results_eq(
  'SELECT role::text, warehouse_id FROM m_user_permissions WHERE user_id = ''usr-admin-01''',
  'VALUES (''ADMIN''::text, ''WH-DEL01-DRY''::text)',
  'usr-admin-01 has ADMIN role scoped to WH-DEL01-DRY'
);

SELECT results_eq(
  'SELECT role::text, section_id::text FROM m_user_permissions WHERE user_id = ''usr-kitchen-01''',
  'VALUES (''KITCHEN_REQ''::text, ''KITCHEN''::text)',
  'usr-kitchen-01 has KITCHEN_REQ role scoped to KITCHEN section'
);

SELECT results_eq(
  'SELECT role::text, section_id::text FROM m_user_permissions WHERE user_id = ''usr-runner-01''',
  'VALUES (''RUNNER''::text, ''KITCHEN''::text)',
  'usr-runner-01 has RUNNER role scoped to KITCHEN section'
);

SELECT results_eq(
  'SELECT role::text, warehouse_id FROM m_user_permissions WHERE user_id = ''usr-custodian-01''',
  'VALUES (''CUSTODIAN''::text, ''WH-DEL01-COLD''::text)',
  'usr-custodian-01 has CUSTODIAN role scoped to WH-DEL01-COLD'
);

SELECT results_eq(
  'SELECT role::text FROM m_user_permissions WHERE user_id = ''usr-approver-01''',
  ARRAY['APPROVER'],
  'usr-approver-01 has APPROVER role'
);

-- 5. Immutability of t_security_logs (Append-Only Enforcement)
INSERT INTO t_security_logs (log_id, user_id, event_type, device_info)
VALUES ('sec-test-immutability', 'usr-sysadmin-01', 'LOGIN_SUCCESS', 'pgTAP verification runner');

SELECT throws_ok(
  'UPDATE t_security_logs SET device_info = ''tampered'' WHERE log_id = ''sec-test-immutability''',
  'P0001',
  'Security logs are append-only and cannot be updated or deleted.',
  'UPDATE on t_security_logs is blocked by append-only trigger'
);

SELECT throws_ok(
  'DELETE FROM t_security_logs WHERE log_id = ''sec-test-immutability''',
  'P0001',
  'Security logs are append-only and cannot be updated or deleted.',
  'DELETE on t_security_logs is blocked by append-only trigger'
);

-- 6. Rule 1.2.1: Only SYSTEM_ADMIN can create user invitations
SET LOCAL "app.current_user_id" = 'usr-kitchen-01';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  'SELECT create_user_invitation(''test-unauth@example.test'', ''ADMIN''::user_role, ''IND-DEL-01'')',
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Non-admin cannot create user invitation'
);

SET LOCAL "app.current_user_id" = 'usr-sysadmin-01';
SET LOCAL "app.current_role" = 'SYSTEM_ADMIN';

-- Create standard role invitation -> status should be PENDING
SELECT lives_ok(
  'SELECT create_user_invitation(''new-staff@example.test'', ''ADMIN''::user_role, ''IND-DEL-01'')',
  'SYSTEM_ADMIN successfully creates standard invitation'
);

SELECT is(
  (SELECT status::text FROM m_user_invitations WHERE email = 'new-staff@example.test'),
  'PENDING',
  'Standard role invitation status initializes to PENDING'
);

-- 7. Rule 1.2.2: Second Approval Rule for APPROVER
-- System Admin creates invitation for APPROVER -> status must be PENDING_SECOND_APPROVAL
SELECT lives_ok(
  'SELECT create_user_invitation(''new-fc@example.test'', ''APPROVER''::user_role, ''IND-DEL-01'')',
  'SYSTEM_ADMIN creates APPROVER invitation'
);

SELECT is(
  (SELECT status::text FROM m_user_invitations WHERE email = 'new-fc@example.test'),
  'PENDING_SECOND_APPROVAL',
  'APPROVER invitation requires 2nd approval: status initializes to PENDING_SECOND_APPROVAL'
);

-- Segregation of Duties: Creator cannot second-approve their own APPROVER invitation
SELECT throws_ok(
  'SELECT approve_approver_invitation(
     (SELECT invitation_id FROM m_user_invitations WHERE email = ''new-fc@example.test''),
     ''usr-sysadmin-01''
   )',
  'P0001',
  'Segregation of duties violation: Creator cannot second-approve the same APPROVER invitation',
  'Segregation of duties: Creator cannot second-approve the same APPROVER invitation'
);

-- Independent second approval by another approver
SET LOCAL "app.current_user_id" = 'usr-approver-01';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  'SELECT approve_approver_invitation(
     (SELECT invitation_id FROM m_user_invitations WHERE email = ''new-fc@example.test''),
     ''usr-approver-01''
   )',
  'Independent APPROVER grants second approval'
);

SELECT is(
  (SELECT status::text FROM m_user_invitations WHERE email = 'new-fc@example.test'),
  'PENDING',
  'APPROVER invitation transitions to PENDING after independent second approval'
);

-- 8. Lockout Counter Helpers (Flow 0 Steps U10, U12, U13, U7)
-- Record failed login attempts
SELECT lives_ok(
  'SELECT record_failed_login(''kitchen@example.test'', 5, 30)',
  'record_failed_login increments failed attempt counter'
);

SELECT is(
  (SELECT failed_login_count FROM m_users WHERE email = 'kitchen@example.test'),
  1,
  'failed_login_count is 1 after first failed attempt'
);

-- Push to lockout threshold (5 attempts total)
SELECT record_failed_login('kitchen@example.test', 5, 30);
SELECT record_failed_login('kitchen@example.test', 5, 30);
SELECT record_failed_login('kitchen@example.test', 5, 30);
SELECT record_failed_login('kitchen@example.test', 5, 30);

SELECT is(
  (SELECT is_account_locked('kitchen@example.test')),
  true,
  'Account is locked after reaching 5 failed login attempts'
);

-- Attempting login while locked throws exception
SELECT throws_matching(
  'SELECT record_login_success(''kitchen@example.test'')',
  'Account is locked until',
  'Cannot login while account is locked'
);

-- Non-admin cannot unlock
SET LOCAL "app.current_user_id" = 'usr-runner-01';
SET LOCAL "app.current_role" = 'RUNNER';
SELECT throws_ok(
  'SELECT unlock_user_account(''usr-kitchen-01'')',
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can unlock user accounts.',
  'Non-admin cannot unlock user accounts'
);

-- SYSTEM_ADMIN unlocks
SET LOCAL "app.current_user_id" = 'usr-sysadmin-01';
SET LOCAL "app.current_role" = 'SYSTEM_ADMIN';
SELECT lives_ok(
  'SELECT unlock_user_account(''usr-kitchen-01'')',
  'SYSTEM_ADMIN successfully unlocks user account'
);

SELECT is(
  (SELECT is_account_locked('kitchen@example.test')),
  false,
  'Account is unlocked after SYSTEM_ADMIN reset'
);

-- Record 2 failed attempts without locking
SELECT record_failed_login('kitchen@example.test', 5, 30);
SELECT record_failed_login('kitchen@example.test', 5, 30);
SELECT is(
  (SELECT failed_login_count FROM m_users WHERE email = 'kitchen@example.test'),
  2,
  'failed_login_count is 2 before successful login'
);

-- Successful login resets counter to 0
SELECT lives_ok(
  'SELECT record_login_success(''kitchen@example.test'')',
  'record_login_success resets counter'
);

SELECT is(
  (SELECT failed_login_count FROM m_users WHERE email = 'kitchen@example.test'),
  0,
  'failed_login_count reset to 0 after successful login'
);

-- 9. Row-Level Security Policy Checks
-- Set role to authenticated frontline user
SET LOCAL ROLE authenticated;
SET LOCAL "app.current_user_id" = 'usr-kitchen-01';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

-- Frontline user can only select their own profile
SELECT is(
  (SELECT count(*)::integer FROM m_users),
  1,
  'RLS: Frontline user can only read their own user profile'
);

SELECT * FROM finish();
ROLLBACK;
