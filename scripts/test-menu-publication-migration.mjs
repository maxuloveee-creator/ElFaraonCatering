import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260812040001_add_immutable_menu_publications.sql",
);
const migration = await readFile(migrationPath, "utf8");
const evidenceRegexFixPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260812055729_fix_publication_evidence_regex.sql",
);
const evidenceRegexFix = await readFile(evidenceRegexFixPath, "utf8");

const getFunctionSource = (signature, nextStatement) => {
  const start = migration.indexOf(signature);
  const end = migration.indexOf(nextStatement, start + signature.length);

  assert.notEqual(start, -1, `Missing function signature: ${signature}`);
  assert.notEqual(end, -1, `Missing function boundary after: ${signature}`);

  return migration.slice(start, end);
};

test("immutable publication migration keeps bootstrap isolated and structurally complete", () => {
  const bootstrap = getFunctionSource(
    "create or replace function public.bootstrap_menu_publication_deployment",
    "drop function if exists public.reserve_menu_publish_request",
  );

  assert.equal((migration.match(/\$\$/g) ?? []).length % 2, 0);
  assert.match(bootstrap, /snapshot_hash <> normalized_hash/);
  assert.match(bootstrap, /deployed_revision_id = selected_revision_id/);
  assert.doesNotMatch(bootstrap, /normalized_evidence_source|confirm_menu_publish_deployment/);
});

test("reservation captures one immutable snapshot and its exact visible change events", () => {
  const reserve = getFunctionSource(
    "create function public.reserve_menu_publish_request",
    "drop function if exists public.complete_menu_publish_request",
  );

  assert.match(reserve, /get_menu_publication_content_snapshot\(\) as content_snapshot/);
  assert.match(reserve, /array_agg\(event\.id order by event\.id\)/);
  assert.match(reserve, /menu_publication_revision_events/);
  assert.match(reserve, /request\.expires_at <= now\(\)/);
  assert.doesNotMatch(reserve, /request\.updated_at < now\(\)/);
});

test("build target is deployment-bound and never falls back to live draft content", () => {
  const buildTarget = getFunctionSource(
    "create or replace function app_private.get_menu_publication_build_target",
    "create or replace function public.bootstrap_menu_publication_deployment",
  );

  assert.match(buildTarget, /build\.project_id = normalized_project_id/);
  assert.match(buildTarget, /request\.expires_at > now\(\)/);
  assert.match(buildTarget, /state\.deployed_revision_id/);
  assert.doesNotMatch(buildTarget, /get_menu_publication_content_snapshot|get_menu_publication_content_hash/);
});

test("confirmation records append-only evidence and links only revision members", () => {
  const confirmation = getFunctionSource(
    "create function public.confirm_menu_publish_deployment",
    "create or replace function app_private.get_menu_publication_state",
  );

  assert.match(migration, /request_id bigint references app_private\.menu_publish_requests/);
  assert.match(confirmation, /insert into app_private\.menu_publication_promotions/);
  assert.match(confirmation, /menu_publication_revision_events included_event/);
  assert.match(confirmation, /event_created_at > state\.deployed_at/);
  assert.match(confirmation, /state\.active_request_id = confirm_menu_publish_deployment\.request_id/);
  assert.doesNotMatch(confirmation, /event\.created_at <= request_created_at/);
  assert.doesNotMatch(confirmation, /update app_private\.menu_publication_promotions/);
});

test("evidence IDs use PostgreSQL-safe length and character validation", () => {
  assert.match(
    evidenceRegexFix,
    /create or replace function public\.confirm_menu_publish_deployment/,
  );
  assert.match(
    evidenceRegexFix,
    /char_length\(confirmation_event_id\) between 1 and 256/,
  );
  assert.match(
    evidenceRegexFix,
    /char_length\(evidence_event_id\) between 1 and 256/,
  );
  assert.match(
    evidenceRegexFix,
    /char_length\(normalized_event_id\) > 256/,
  );
  assert.match(evidenceRegexFix, /normalized_event_id ~ '\[\^A-Za-z0-9:_-\]'/);
  assert.doesNotMatch(evidenceRegexFix, /\{1,256\}/);
});

test("deploy-hook start is idempotent after a fast promotion", () => {
  const startRequest = getFunctionSource(
    "create function public.start_menu_publish_request",
    "create function public.fail_menu_publish_request",
  );

  assert.match(startRequest, /request\.status = 'succeeded'/);
  assert.match(startRequest, /'publish_already_confirmed'/);
});

test("admin state and grants expose only the server-derived operational phase", () => {
  const publicationState = getFunctionSource(
    "create or replace function app_private.get_menu_publication_state",
    "create or replace function public.get_admin_operational_state",
  );
  const publicAdminState = getFunctionSource(
    "create or replace function public.get_admin_operational_state",
    "revoke all on table app_private.menu_publication_revisions",
  );

  assert.match(publicAdminState, /app_private\.get_admin_operational_state\(\)/);
  assert.match(publicAdminState, /'publication', app_private\.get_menu_publication_state\(\)/);
  assert.match(publicationState, /if not app_private\.is_active_staff\(\)/);
  assert.match(publicationState, /'can_retry', phase = 'failed'/);
  assert.match(publicationState, /'expires_at', case when phase = 'publishing' then active_expires_at else null end/);
  assert.match(migration, /grant execute on function app_private\.get_menu_publication_state\(\) to authenticated/);
  assert.match(migration, /revoke all on table app_private\.menu_publication_promotions from public, anon, authenticated, service_role/);
});
