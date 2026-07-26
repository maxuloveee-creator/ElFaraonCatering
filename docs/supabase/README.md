# Supabase local-first workflow

Runbook tecnico para la base Supabase del menu QR. Las migraciones canonicas viven en `../../supabase/migrations/`; esta carpeta contiene documentacion, el diagrama del modelo y auditorias SQL read-only.

## Superficies activas

- `menu_content`: fuente privada de estructura y contenido operativo build-time.
- `public.menu_availability_overlays`: unico overlay runtime sin rebuild.
- `public.staff_users`: empleados, roles y preferencia de local del CMS.
- `public.get_admin_operational_state()`: lectura controlada para `/admin/`.
- RPCs operativas publicas: unica superficie de escritura del navegador.
- `app_private.menu_publish_requests`: solicitudes de publicacion y fingerprints.
- `app_private.menu_change_events`: cambios build-time asociados a una publicacion.
- `publish-menu-changes`: Edge Function que valida al empleado y llama el Vercel Deploy Hook.

Salvo disponibilidad, los cambios operativos necesitan rebuild/deploy para impactar los menus publicos. El modelo completo y sus relaciones estan en [schema-diagram.md](./schema-diagram.md).

## Frontera build-time/runtime

Se leen durante el build:

- menu del dia y servicio activo por local
- parrilla y sus variantes
- catalogo fijo, opciones, precios, imagenes y textos estructurales

La disponibilidad cambia en runtime exclusivamente mediante `public.menu_availability_overlays`. Las columnas build-time `available` permanecen en `true`; la ausencia de overlay significa disponible. Los items con opciones usan targets compuestos como `item-id-option-id`.

`/admin/` autentica empleados con Supabase Auth. `operator` administra el contenido operativo de todos los perfiles y puede publicar; `admin` hereda ese alcance y puede gestionar staff a nivel de base/RPC. La aplicacion no tiene una pantalla de gestion de empleados.

Las funciones publicas del admin son wrappers `security invoker`; sus cuerpos privilegiados viven en `app_private`. La excepcion son `public.reserve_menu_publish_request(...)` y `public.complete_menu_publish_request(...)`: son helpers service-role-only de `publish-menu-changes`, revocados para `anon` y `authenticated`.

## Baseline canonico

La migracion activa para bases nuevas es:

| Migracion | Proposito |
| --- | --- |
| `20260707000000_prelaunch_baseline.sql` | Crea schemas, tablas, contenido build-time, RPCs, fingerprint, auditoria privada, publicacion, RLS, policies, grants y hardening del estado prelanzamiento. |
| `20260723230712_add_menu_build_ci_role.sql` | Crea el rol de build sin login y limita sus grants al contenido, overlay y fingerprint requeridos. |

El tag anotado `supabase-prelaunch-history-2026-07-07` conserva la historia incremental inmediatamente anterior al squash actual. `supabase-prelaunch-history-2026-06-06` es un corte historico anterior; no es el tag de la baseline vigente. `yaml-rollback-2026-05-02` conserva el ultimo estado file-backed, pero YAML ya no es fuente activa.

El baseline incluye el contenido actual de `menu_content` y sincroniza las secuencias identity. Deja vacias estas superficies vivas:

- `public.staff_users`
- `public.menu_availability_overlays`
- `app_private.menu_publish_requests`
- `app_private.menu_change_events`

No incluye `auth.users`, secretos de Functions ni configuracion remota de Auth.

El baseline es solo para bases nuevas. No debe aplicarse sobre una base existente. Todo cambio posterior se versiona como una migracion incremental nueva.

## Variables

### Aplicacion, build y auditorias

- `PUBLIC_SUPABASE_URL`: URL publica para overlay, Auth, RPCs controladas y probes read-only de exposicion del Data API.
- `PUBLIC_SUPABASE_ANON_KEY`: anon key publica para el navegador y los probes read-only de exposicion del Data API.
- `SUPABASE_DB_URL`: conexion Postgres privada con el rol minimo `menu_build_ci` para build y validacion.
- `SUPABASE_AUDIT_DB_URL`: conexion Postgres privada y privilegiada solo para auditorias locales.
- `SUPABASE_ACCESS_TOKEN`: token local opcional para Management API/CLI; no pertenece al sitio ni a Functions.

### Runtime de `publish-menu-changes`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_DEPLOY_HOOK_URL`
- `PUBLISH_ALLOWED_ORIGINS`
- `PUBLISH_COOLDOWN_SECONDS` (default recomendado: `60`)

`SUPABASE_DB_URL`, `SUPABASE_AUDIT_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` y `VERCEL_DEPLOY_HOOK_URL` son privados. No deben exponerse como `PUBLIC_*`, registrarse en logs ni versionarse. `../../.env.example` enumera las variables locales sin valores reales.

`menu_build_ci` se crea sin login mediante migracion. Su contraseña se provisiona fuera del repositorio. Solo recibe lectura de las tablas build-time, las columnas de identificacion del overlay y la funcion privada de fingerprint. No recibe acceso a `staff_users`, tablas de `app_private`, Auth ni historial de migraciones. Las tablas build-time nuevas requieren un grant explicito en su migracion.

## Validacion local y read-only

Antes de considerar una mutacion remota, ejecutar las auditorias SQL contra `SUPABASE_AUDIT_DB_URL`, los probes del Data API con las dos variables `PUBLIC_SUPABASE_*` y las validaciones/builds contra `SUPABASE_DB_URL`:

```bash
npm audit --audit-level=high
npm run supabase:audit
npm run menu:validate
npm run check:js
npm run lint
npm run test:admin
npm run test:menu
npm run test:tools
npm run check
npm run build
npm run verify:dist-secrets
```

`npm run build` debe ejecutarse antes de `npm run verify:dist-secrets`; el verificador necesita que `dist/` exista. El build falla si falta cualquiera de las dos variables `PUBLIC_SUPABASE_*`, y el audit falla si `app_private` o `menu_content` no responden como esquemas fuera del Data API.

Para una auditoria de plataforma mas amplia:

```bash
npm run supabase -- db advisors --db-url "$SUPABASE_AUDIT_DB_URL"
npm run supabase -- db lint --db-url "$SUPABASE_AUDIT_DB_URL" --schema public,menu_content,app_private --fail-on none
```

Estado esperado:

- Los audits no devuelven risks, diagnostics ni estados estructurales inesperados.
- `menu_content` y `app_private` no tienen grants client-facing para `anon` o `authenticated`.
- El Data API expone de `public.menu_availability_overlays` solo `menu_id`, `section_id`, `item_id` y `available_override`; las escrituras pasan por RPCs.
- `public.staff_users` tiene RLS y solo se accede mediante las policies/helpers de staff.
- Los helpers de publicacion siguen ejecutables solo por `service_role`.
- El fingerprint actual de la base coincide con el fingerprint embebido en `/admin/` desplegado. El ultimo publish exitoso es evidencia de auditoria, no la fuente unica del estado pendiente.

## Procedimientos remotos

> Las operaciones de esta seccion afectan Supabase, Auth, usuarios o despliegues reales. Son procedimientos humanos y requieren una decision y autorizacion explicitas para el proyecto objetivo. Ejecutar primero la validacion read-only y confirmar URL, project ref, credenciales y efecto esperado.

### Base existente

1. Ejecutar `npm run supabase:audit` y `npm run menu:validate` contra la base objetivo.
2. Confirmar equivalencia de schema, datos, funciones, grants, policies y fingerprint.
3. Si el remoto conserva el historial pre-squash, no ejecutar `20260707000000_prelaunch_baseline.sql` sobre esa base.
4. Si se autoriza alinear el historial, reparar solo `supabase_migrations.schema_migrations` despues de probar la equivalencia; no reaplicar el baseline.
5. Aplicar exclusivamente migraciones incrementales posteriores pendientes.
6. Repetir audits, build y checks despues de la mutacion.

El remoto de handoff puede conservar el historial pre-squash completo sin representar drift. La equivalencia se determina por schema, contenido, funciones, permisos, policies y fingerprint, no por tener una sola fila de migracion.

### Base nueva

1. Aplicar `../../supabase/migrations/` con el Supabase CLI contra la base nueva confirmada.
2. Verificar que el baseline y cualquier migracion posterior terminen sin errores.
3. Ejecutar ambos audits SQL, `npm run menu:validate` y el resto de la secuencia de validacion.
4. Crear el primer usuario en Supabase Auth y agregar su fila `admin` a `public.staff_users` mediante SQL privilegiado.
5. Configurar los secretos de la Function y desplegar `publish-menu-changes`.

La creacion del primer admin no se realiza desde browser RLS y `service_role` no tiene acceso directo a `public.staff_users`.

### Auth, staff y pruebas de email

Redirects esperados:

- `https://elfaraoncatering.vercel.app/admin/`
- `http://localhost:4321/admin/`

Login con un usuario staff existente no necesita crear cuentas temporales. Los flujos de recovery, signup, invitacion, magic link u OTP pueden enviar email real. Probarlos contra el remoto, crear/invitar usuarios y revocarlos o eliminarlos son acciones externas separadas y requieren autorizacion explicita.

Si una prueba de email fue autorizada, usar una casilla controlada y no versionar su direccion. Eliminar un usuario temporal al finalizar revoca el acceso, pero no deshace emails ya enviados ni sus posibles rebotes. La proteccion contra passwords filtradas se habilita en Supabase Auth settings si el plan la soporta; no se configura mediante migracion SQL.

El proyecto opera en Supabase Free para mantener costo cero. El warning `auth_leaked_password_protection` se acepta como una limitacion conocida del plan y solo debe reevaluarse si se migra a un plan pago.

### Edge Function y secretos

El CLI esta fijado como dependencia de desarrollo del repo:

```bash
npm run supabase -- --version
npm run supabase:link -- --project-ref <project-ref>
npm run supabase:migrations
```

Configurar secretos es una mutacion remota. Ejemplo, solo despues de confirmar el proyecto vinculado:

```bash
npm run supabase -- secrets set VERCEL_DEPLOY_HOOK_URL=...
```

El deploy tambien es una accion remota y requiere autorizacion explicita:

```bash
npm run supabase:functions:deploy
```

Ese script despliega unicamente `publish-menu-changes` con `--no-verify-jwt`, en linea con `supabase/config.toml`.

## Archivos de esta carpeta

- `schema-diagram.md`: mapa Mermaid del modelo, overlay, admin y publicacion.
- `audits/menu-schema-audit.sql`: tablas, constraints, indices y diagnosticos del modelo activo.
- `audits/database-audit.sql`: inventario de objetos, exposicion, policies, helpers y hallazgos.

Estos archivos son documentacion y auditorias read-only. La historia aplicable permanece exclusivamente en `../../supabase/migrations/`.
