# Admin AGENTS.md

## Scope

- Applies to `src/admin/` and, through root routing, every admin behavior change.
- Read `supabase/AGENTS.md` before changing RPC, role, Auth, publication, database, or Edge Function behavior.

## Local invariants

### CMS boundary

- Browser reads use `public.get_admin_operational_state()`. Browser writes use approved public RPC wrappers. Never query `menu_content` or `app_private` directly from browser code.

### Roles and publication

- `operator` may use every current operational edit surface for every profile, including requesting publication.
- `admin` includes operator capabilities and may manage staff only through privileged SQL/RPC surfaces. `default_availability_profile_id` is a UI default, never a permission boundary.
- Preserve the `can_edit_menu_content()` wrapper/privilege contract and approved RPC surface.
- Publication UI consumes the server-backed phase (`up_to_date`, `changes_pending`, `publishing`, or `failed`) and polls while publishing. Never use browser storage, a local cooldown, a fabricated fingerprint, or a Deploy Hook response as publication truth.
- Polling calls the authenticated `publish-menu-changes/status` path so the same Edge Function can reconcile the canonical deployed artifact before the admin reloads state. Also reconcile once at login and, with a bounded throttle, when a visible panel regains focus so rollbacks are observed without probing after every edit. This fallback must work without a Vercel Account Webhook.
- Keep publication copy operational: one clear action, automatic progress/success/failure updates, safe retry after failure, and an explicit note that edits made during a publish remain saved for the next one.

### Availability and service

- Availability controls write only overlay state; they must not call structural-content, service-kind, or price RPCs.
- Marking available clears the overlay instead of writing an explicit `true` override.
- Items with options expose parent and option targets. Option target IDs use `item-id-option-id`.

### Grill editing

- Allow adding a product with its first option, renaming/deleting a product, adding/updating/deleting options, and editing explicit global option prices.
- Never leave a product with zero options. Do not expose reorder, technical-ID changes, availability, or image management.

### Fixed-menu editing

- Sections remain fixed. Within an existing section, allow item add/update/delete and option edits only for items that already use options.
- `tartas-tortillas-omelettes` exposes option-only locations for `tartas`, `tortilla`, and `omelette` under one technical `section_id`; `empanadas` permits option edits only. Do not expose item CRUD in those locations.
- Never leave an option-based item with zero options.
- Do not expose item price, availability, technical-ID, item/option order, section create/delete/rename/reorder, or conversion between priced and option-only models.
- Included side items in `guarniciones`, except `guarnicion-sola`, do not expose price editing. Insert new included side entries before the current last option when that rule is available.
- Global price edits remain the explicit global-price RPC workflow.

## Sensitive/generated artifacts

- Do not fabricate publication revisions, phases, or fingerprints in client state or fixtures.

## Validation

- Preserve confirmations for destructive editorial actions and clear server-error handling.
- If RPC or database contracts change, also run checks required by `supabase/AGENTS.md`.
