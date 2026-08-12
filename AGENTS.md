# AGENTS.md

## Project

### Product and routes

El Faraon is an Astro/Supabase digital menu. The operational QR menu is the primary product surface; the institutional site is separate.

- `/`: public institutional landing page.
- `/menu/`: temporary redirect to `/`; do not expose location-menu links there.
- `/menu/corpo/` and `/menu/teleinde/`: active operational QR menus; deployment headers must keep `noindex, follow`.
- `/admin/`: static operational menu-content CMS; deployment headers must keep `noindex, nofollow`.

### Stack

Current stack: Astro 7, TypeScript, Tailwind CSS 4, Node 22 LTS, npm, Supabase Postgres, and static Vercel output. Use npm only; do not switch runtime or package manager without explicit scope.

## Source of truth

- `menu_content` in Supabase is the build-time source for structural and operational menu content.
- `public.menu_availability_overlays` is the only runtime menu-data overlay.
- `public.staff_users` is the staff role source for the operational CMS.
- Browser admin reads and operational writes use approved public RPCs; browser code must not query or mutate protected content tables directly.
- YAML is not active content. `yaml-rollback-2026-05-02` is only the historical file-backed rollback point.
- `README.md` is the human setup/product manual. `docs/supabase/README.md` is the detailed database workflow. Code, migrations, tests, and those documents carry exhaustive contracts; these guides carry decision-critical constraints.
- When setup, scripts, environment variables, content sources, routes, or deployment behavior change, update the affected README/docs and applicable agent guide without duplicating exhaustive documentation here.
- Do not edit generated output as source.

## Critical invariants

### Static-first architecture

- Structural content, service selection, menu text, catalog, images, and prices are build-time data. Admin changes to them require rebuild/deploy before public menus change.
- A publication captures one immutable JSONB revision. Every production build must render that exact revision; later admin edits belong to a later publication.
- A Deploy Hook acknowledgement means only `triggered`. Publication becomes `succeeded` only after trusted promotion evidence proves that the canonical admin or a signed Vercel `deployment.promoted` event serves the expected immutable revision.
- Availability is progressive runtime data and may only alter visual availability. A missing overlay means available.
- Do not add direct runtime queries for build-time content. Admin reads use approved RPCs; public runtime reads stay limited to the availability contract.
- Do not add `@supabase/supabase-js` to browser code unless a required capability justifies an explicit architecture change.
- All direct Postgres build, validation, and audit clients must use `src/utils/supabasePostgresClient.mjs` with the versioned Supabase CA. Do not instantiate `postgres()` elsewhere, accept weak SSL modes, replace the CA from a DSN, or disable TLS verification.

### Menu model

- A profile shows either `daily-menu` or `grill`, never both. Daily-menu profiles share the current main dish. Prices are global, not profile-specific; availability is profile/menu-specific.
- `menu_grill_families` are visible grill products; `menu_grill_catalog_items` are their pricing variants.
- The fixed catalog is flat: sections contain direct items, every item owns a `pricing_key`, and catalog groups or inherited group pricing must not return.
- Supported pricing is `fixed`, `included`, or flat `variants`; amounts are numeric. Do not add free-text or pending-price states.
- The content reader must preserve the shape consumed by `MenuPage`, `MenuSection`, and `DishCard`.

### Images

- `menu_catalog_item_images` is the only fixed-item image source. `order_index = 0` is primary and later indexes are contiguous. Daily and grill items do not support images.
- Store images under `public/uploads/` and use `/uploads/...` public paths. Reject external/data URLs, query strings, fragments, backslashes, empty/dot traversal segments, and unsupported extensions.
- Allowed formats are AVIF, JPEG/JPG, PNG, SVG, and WEBP. SVG is limited to repository-controlled assets.

## Scope boundaries

- Do not add ordering, cart, checkout, payments, reservations, customer accounts, WhatsApp ordering, SSR, server output, API routes, Vercel Functions, or broad editorial CMS behavior without explicit scope.
- Informational contact or WhatsApp profile links are allowed, but must not become ordering CTAs or handoff flows.
- The operational CMS may manage daily menu, active service, availability, grill products/options, fixed-menu content/options, global prices, and publication. It is not a general website CMS.
- Staff lifecycle is outside the CMS. Auth user creation/invitation/revocation/deletion and `staff_users` role, active-state, or default-profile changes require an explicitly authorized privileged external operation.
- Staff auth must not expand into customer, institutional-site, or public accounts.
- Keep `/admin/` static Astro. Do not add SSR, server output, API routes, or a second server/runtime surface.
- Keep compatibility with Node 22, Astro 7, current routes, and the static-first model unless an upgrade or architecture change is explicitly requested.

## Project rules

### Language and identifiers

- Code, file names, types, schemas, comments, logs, config keys, and internal identifiers use technical English and ASCII.
- User-facing copy, errors, status, help, accessibility labels, and public metadata use natural Spanish with correct accents, `n` with tilde, and punctuation.
- Keep technical IDs stable, ASCII, and kebab-case. Never derive them from visible names at runtime or rename them for preference.

### UI and implementation

- Keep the QR menu mobile-first, fast, readable, and operationally separate from marketing UI.
- Prefer Astro rendering, minimal client JavaScript, simple hierarchy, explicit TypeScript, Tailwind, and local patterns.
- Avoid unnecessary hydration, heavy client libraries, animations, speculative abstractions, hidden behavior, and new dependencies without a required capability.

## External systems

- Supabase and Vercel are external systems. Any deploy, release, remote mutation, or remote user creation/revocation/deletion requires explicit user scope.
- Never expose service-role credentials or the Vercel Deploy Hook in browser code.
- Never expose the Vercel webhook secret or deployment bypass secret in browser code. Keep canonical artifact probes, webhook verification, project scoping, evidence recording, and publication transitions inside `publish-menu-changes`.
- `publish-menu-changes` is the only approved Edge Function. Adding another Function/publication path or executing a real deployment requires an explicit user request.

## Validation

- Run `npm run check` and `npm run build` for application changes when the required environment is available.
- Run `npm run test:admin` for admin rules, selectors, rendering, operations, edit policy, or availability grouping.
- Run `npm run test:menu` for the public availability overlay.
- Run `npm run check:js` for public scripts, Node `.mjs` code, and shared JavaScript utilities.
- Run `npm run test:edge` after changes to `publish-menu-changes` routing, canonical artifact parsing, or signed Vercel promotion-webhook validation.
- Run `npm run test:tools` after changes to handoff guards, publication build/migration tooling, the shared Postgres client, or Edge publication helpers; it runs `npm run test:edge` after its Node test suites.
- Run `npm run lint` after TypeScript, public-script, Node utility, or Edge Function changes.
- After application builds, run `npm run verify:dist-secrets` before delivery.
- Supabase schema, grants, policies, RPCs, audits, and menu validation follow `supabase/AGENTS.md`.
- Never claim an unrun or failed check passed. Report blocked checks, prior failures, remaining risks, and live-environment validation still needed.

## Scoped guidance

- Before changing anything under `src/admin/`, read `src/admin/AGENTS.md`.
- Before changing anything under `supabase/`, read `supabase/AGENTS.md`.
- For work changing admin behavior, Supabase contracts, publication, or related documentation/tests, read both nested guides even when touched files are outside those directories.
