# Supabase AGENTS.md

## Scope

- Applies to `supabase/` and all Supabase/Auth/publication work routed here by root.
- Workflow: `docs/supabase/README.md`; schema: `docs/supabase/schema-diagram.md`.

## Local invariants

### Migrations

- Real migrations live only in `supabase/migrations/`; `docs/supabase/` is documentation/read-only audits.
- `20260707000000_prelaunch_baseline.sql` is for new databases only. Never apply it to an existing database.
- Pre-squash history is tag `supabase-prelaunch-history-2026-07-07`. Add incremental migrations after the baseline; never recreate removed legacy objects.
- Align remote history only with explicit authorization and proven schema/data/function/grant/policy/fingerprint equivalence.
- Never seed live Auth users, `staff_users`, overlays, publish requests, or change events into the baseline.

### Data API and privileges

- `menu_content` owns build-time content; `public` is the narrow browser contract; privileged code/audits belong in `app_private`.
- Create `public.staff_users` and permission helpers before dependent RPCs. Do not recreate `public.editor_profiles`.
- Admin reads use `get_admin_operational_state()`; browser operational writes use approved public RPCs. Never grant browser access to `menu_content`/`app_private`, and do not treat direct `staff_users` table writes as a supported browser contract.
- Data API migrations include explicit `revoke`/`grant`; grant minimal roles/columns, enable RLS/exact policies, and revoke non-contract access.
- Public functions callable by `anon`/`authenticated` stay `security invoker`; privileged bodies stay outside exposed schemas.
- Publication transition helpers (`bootstrap_menu_publication_deployment`, `reserve_menu_publish_request`, `start_menu_publish_request`, `fail_menu_publish_request`, and `confirm_menu_publish_deployment`) are service-role-only and revoked from `anon`/`authenticated`.
- Preserve `can_edit_menu_content()`/`can_publish_menu()` privileges. Build-time `available` stays `true`; runtime unavailability uses only the overlay.

### Publication

- `publish-menu-changes` is the only Edge Function. It validates Auth/permission, stores an immutable JSONB revision, triggers Vercel, reconciles the canonical artifact through authenticated `POST /status`, and optionally handles the signed, project-scoped Vercel promotion webhook route.
- No `pg_net`, other Function, exposed hook, or alternate publication path without explicit architecture scope.
- Keep platform JWT verification disabled as configured. Deploying the Function requires an explicit user request.
- Build-time RPC changes may log private `menu_change_events`; only a verified promoted publication links included events. Runtime availability stays outside this log.
- The Deploy Hook response transitions `queued` to `triggered`, never directly to `succeeded`. Success requires a verified canonical probe or signed `deployment.promoted` event whose served `/admin/` artifact matches deployment, revision, hash, and project.
- Promotion evidence is append-only. Re-promotions and rollbacks update the deployed revision by evidence time even when they do not correspond to an active publication request. Vercel `deployment.promoted` does not cover rollbacks; the throttled canonical probe at login/focus must reconcile them.
- Keep at most one `queued`/`triggered` request. Operators may keep editing during it; those newer edits remain pending for the next immutable revision.
- `menu_build_ci` may execute only the publication target/revision/hash functions needed by builds; never grant it direct SELECT on private publication tables.

## Sensitive/generated artifacts

- `SUPABASE_DB_URL` is private least-privilege build access. `SUPABASE_AUDIT_DB_URL` is private privileged local audit access. Never make either `PUBLIC_*` or client-visible.
- Intended browser variables are only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
- Service-role keys, deploy hooks, and access tokens are secrets: never commit/log/expose them. Function variables are documented in `docs/supabase/README.md`.
- Bootstrap the first `admin` only through privileged SQL. `service_role` has no direct `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grant on `staff_users` for staff management; browser RLS is not a bootstrap path.
- Keep the complete staff lifecycle outside the CMS. Auth user creation/invitation/revocation/deletion and `staff_users` creation, role/default-profile updates, activation, or deactivation require an explicitly authorized privileged external operation; do not add a browser staff-management surface or public staff-management RPC.
- Never use fake/guessed/unowned Auth addresses. Authorized email tests use an uncommitted controlled plus-address; cleanup/revocation needs authorization.
- Treat CLI link/temp metadata as local/generated state, never canonical migrations or content.
- Remote deploy/mutation, Auth email, and remote user create/invite/revoke/delete require an explicit user request.

## Validation

- `npm run supabase:audit` runs read-only SQL audits and must fail on risk rows, diagnostics, or unexpected structural states.
- Run `npm run menu:validate` for menu schema/content-shape changes; run `npm run check:js` and `npm run lint` for Function/shared code.
- Run `npm run test:edge` for the Deno suite covering `publish-menu-changes` route selection, canonical URL/artifact parsing, evidence IDs, and signed/project-scoped Vercel promotion events.
- Run `npm run test:tools` for handoff guards, publication build/migration tooling, and the shared Postgres client; it then invokes `npm run test:edge`.
- After Data API permission changes, verify the exact anon/authenticated browser query; classify `42501` as a missing required grant or intentional block.
- Prefer read-only audits/advisors/lint before any authorized mutation. Never present `npm run supabase:functions:deploy` as validation.
