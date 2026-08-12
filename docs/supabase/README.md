# Flujo local-first de Supabase

Runbook técnico para la base Supabase del menú QR. Las migraciones canónicas viven en `../../supabase/migrations/`; esta carpeta contiene documentación, el diagrama del modelo y auditorías SQL read-only.

## Superficies activas

- `menu_content`: fuente privada de estructura y contenido operativo build-time.
- `public.menu_availability_overlays`: único overlay runtime sin rebuild.
- `public.staff_users`: empleados, roles y preferencia de local del CMS.
- `public.get_admin_operational_state()`: lectura controlada para `/admin/`.
- RPCs operativas públicas: única superficie de escritura del navegador.
- `app_private.menu_publication_revisions`: snapshots JSONB inmutables del contenido solicitado.
- `app_private.menu_publication_revision_events`: membresía exacta de cambios incluida en cada revisión.
- `app_private.menu_publish_requests`: solicitudes y fases de publicación.
- `app_private.menu_publication_state`: punteros singleton a la solicitud activa y revisión desplegada.
- `app_private.menu_publication_builds`: vínculo auditable entre un deployment de Vercel y su revisión exacta.
- `app_private.menu_publication_promotions`: evidencia append-only de promociones, re-promociones y rollbacks.
- `app_private.menu_change_events`: cambios build-time asociados a una publicación.
- `publish-menu-changes`: Edge Function que valida al empleado, llama el Vercel Deploy Hook y reconcilia promociones por probe canónico o webhook firmado opcional.

Salvo disponibilidad, los cambios operativos necesitan rebuild/deploy para impactar los menús públicos. El modelo completo y sus relaciones están en [schema-diagram.md](./schema-diagram.md).

## Frontera build-time/runtime

Se leen durante el build:

- menú del día y servicio activo por local
- parrilla y sus variantes
- catálogo fijo, opciones, precios, imágenes y textos estructurales

La disponibilidad cambia en runtime exclusivamente mediante `public.menu_availability_overlays`. Las columnas build-time `available` permanecen en `true`; la ausencia de overlay significa disponible. Los ítems con opciones usan targets compuestos como `item-id-option-id`.

`/admin/` autentica empleados con Supabase Auth. `operator` administra el contenido operativo de todos los perfiles y puede publicar; `admin` hereda ese alcance y satisface los helpers y policies de gestión de staff. La aplicación no tiene una pantalla ni un flujo de navegador para altas, cambios de rol, desactivaciones o bajas de empleados; esas operaciones se realizan fuera de la UI desde un entorno administrativo confiable.

Las funciones públicas del admin son wrappers `security invoker`; sus cuerpos privilegiados viven en `app_private`. Los helpers `bootstrap_menu_publication_deployment`, `reserve_menu_publish_request`, `start_menu_publish_request`, `fail_menu_publish_request` y `confirm_menu_publish_deployment` son service-role-only para `publish-menu-changes` y la inicialización controlada; están revocados para `anon` y `authenticated`.

Una solicitud de publicación captura el snapshot, su hash y los IDs exactos de `menu_change_events` dentro de la misma sentencia MVCC. Solo puede existir una solicitud activa en estado interno `queued` o `triggered`; `expires_at`, derivado de `PUBLISH_STALE_SECONDS`, permite mostrar fallo y reintentar sin cooldown local si Vercel no completa el ciclo. El build resuelve una vez el target, vincula el `VERCEL_DEPLOYMENT_ID` y luego lee la revisión por UUID; nunca vuelve a consultar contenido vivo para ese artefacto. Un `2xx` del Deploy Hook solo cambia el estado interno de la solicitud a `triggered`; la fase expuesta al panel continúa en `publishing`.

Mientras la fase es `publishing`, y también una vez al iniciar sesión o volver al panel con un límite de una consulta por minuto, el admin consulta `POST /publish-menu-changes/status`. La Function verifica server-side el `/admin/` canónico y registra evidencia cuando sus metadatos coinciden con un build conocido. Esta reconciliación automática es el camino base, cubre rollbacks y no exige acciones del operador. Un Account Webhook `deployment.promoted` agrega confirmación más rápida cuando el plan de Vercel lo permite, pero Vercel no emite ese evento para rollbacks. Ambas fuentes escriben promociones append-only, actualizan la revisión desplegada por `event_created_at` y admiten evidencia sin `request_id`.

## Estado operativo actual

En la verificación del 2026-08-12, el entorno en uso opera con publicación inmutable y las seis migraciones de este repositorio aparecen aplicadas en orden tanto local como remotamente. El trabajo cotidiano no repite migraciones ni `bootstrap_menu_publication_deployment(...)`: el operador guarda cambios en `/admin/`, solicita una publicación y espera la confirmación server-side del artefacto canónico. La disponibilidad continúa siendo la única excepción runtime.

El baseline, el aprovisionamiento de una base nueva y la secuencia de adopción inicial se conservan como procedimientos de instalación, recuperación o referencia histórica. No son pasos de operación recurrente.

## Cadena canónica de migraciones

Para una base nueva, las migraciones canónicas se aplican en este orden:

| Migración | Propósito |
| --- | --- |
| `20260707000000_prelaunch_baseline.sql` | Crea schemas, tablas, contenido build-time, RPCs, fingerprint, auditoría privada, publicación, RLS, policies, grants y hardening del estado prelanzamiento. |
| `20260723230712_add_menu_build_ci_role.sql` | Crea el rol de build sin login y limita sus grants al contenido, overlay y fingerprint requeridos. |
| `20260808233225_standardize_teleinde_whatsapp.sql` | Normaliza el enlace de WhatsApp de Teleinde al formato internacional móvil `54911`. |
| `20260812040001_add_immutable_menu_publications.sql` | Agrega revisiones JSONB inmutables, target exacto de build, fases server-side y confirmación de promoción de Vercel. |
| `20260812055729_fix_publication_evidence_regex.sql` | Corrige la validación de IDs de evidencia para el límite de cuantificadores del motor regex de PostgreSQL. |
| `20260812062557_restore_admin_editor_state.sql` | Restaura en `get_admin_operational_state()` los editores de catálogo y parrilla, el estado de publicación y la preferencia de local del empleado después del cambio de publicación inmutable. |

El tag anotado `supabase-prelaunch-history-2026-07-07` conserva la historia incremental inmediatamente anterior al squash actual. `supabase-prelaunch-history-2026-06-06` es un corte histórico anterior; no es el tag del baseline vigente. `yaml-rollback-2026-05-02` conserva el último estado file-backed, pero YAML ya no es fuente activa.

El baseline incluye el contenido de partida versionado de `menu_content`, sincroniza las secuencias identity y deja vacías estas superficies que ya crea:

- `public.staff_users`
- `public.menu_availability_overlays`
- `app_private.menu_publish_requests`
- `app_private.menu_change_events`

Después de aplicar la cadena completa desde ese baseline, también quedan vacías las superficies agregadas por la publicación inmutable:

- `app_private.menu_publication_revisions`
- `app_private.menu_publication_revision_events`
- `app_private.menu_publication_builds`
- `app_private.menu_publication_promotions`

Después de aplicar la cadena completa, `app_private.menu_publication_state` conserva una fila singleton sin target hasta ejecutar el bootstrap controlado. Por eso una base nueva o recuperada no puede construir producción con la versión actual antes de inicializar el target de publicación. El entorno operativo ya inicializado no debe ejecutar ese bootstrap otra vez.

No incluye `auth.users`, secretos de Functions ni configuración remota de Auth.

El baseline es solo para bases nuevas. No debe aplicarse sobre una base existente. Todo cambio posterior se versiona como una migración incremental nueva.

## Variables

### Aplicación, build y auditorías

- `PUBLIC_SUPABASE_URL`: URL pública para overlay, Auth, RPCs controladas y probes read-only de exposición del Data API.
- `PUBLIC_SUPABASE_ANON_KEY`: anon key pública para el navegador y los probes read-only de exposición del Data API.
- `SUPABASE_DB_URL`: conexión Postgres privada con el rol mínimo `menu_build_ci` para build y validación; su única escritura es el binding deployment/revisión encapsulado por `get_menu_publication_build_target(...)`.
- `SUPABASE_AUDIT_DB_URL`: conexión Postgres privada y privilegiada solo para auditorías locales.
- `SUPABASE_ACCESS_TOKEN`: token local opcional para Management API/CLI; no pertenece al sitio ni a Functions.

### Runtime de `publish-menu-changes`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_DEPLOY_HOOK_URL`
- `PUBLISH_ALLOWED_ORIGINS`
- `PUBLISH_STALE_SECONDS` (default recomendado: `900`; rango aceptado: `60` a `3600`)
- `PUBLISH_CANONICAL_ADMIN_URL` (producción: `https://elfaraoncatering.com.ar/admin/`)
- `VERCEL_PROJECT_ID`
- `VERCEL_WEBHOOK_SECRET` (opcional; solo si se configura Account Webhook)
- `VERCEL_TEAM_ID` (opcional; restringe el webhook al team esperado)
- `VERCEL_DEPLOYMENT_BYPASS_SECRET` (opcional; permite verificar `/admin/` si el deployment tiene protección)

`SUPABASE_DB_URL`, `SUPABASE_AUDIT_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_DEPLOY_HOOK_URL`, `VERCEL_WEBHOOK_SECRET` y `VERCEL_DEPLOYMENT_BYPASS_SECRET` son privados. No deben exponerse como `PUBLIC_*`, registrarse en logs ni versionarse. `../../.env.example` enumera las variables locales sin valores reales.

### TLS de conexiones Postgres

Los clientes directos de Postgres deben usar exclusivamente `../../src/utils/supabasePostgresClient.mjs`. Los entrypoints protegidos por esa regla son:

- `../../scripts/audit-supabase-readonly.mjs`
- `../../scripts/build-menu-publication.mjs`
- `../../scripts/menu-content-supabase.mjs`
- `../../scripts/validate-menu-supabase.mjs`
- `../../src/utils/menuSupabaseContent.ts`

La factory carga `../../config/certs/supabase-prod-ca-2021.crt`, exige validación de CA y hostname, y rechaza configuraciones que debiliten o reemplacen esa política. `../../scripts/verify-supabase-postgres-tls.mjs` reutiliza la misma factory como verificador en vivo.

El certificado raíz es público y se versiona; no contiene credenciales. Los DSN privados pueden omitir `sslmode` o declarar `sslmode=verify-full`. No usar `disable`, `allow`, `prefer`, `require`, `verify-ca`, `NODE_TLS_REJECT_UNAUTHORIZED=0` ni parámetros de certificado dentro del DSN.

La suite `test-supabase-postgres-client.mjs`, incluida en `npm run test:tools`, verifica offline que la CA sea válida y tenga al menos un año de vigencia restante, que los DSN degradados fallen antes de conectar y que no exista ningún `postgres()` fuera de la factory. `npm run supabase:tls:verify` usa ambos DSN privados y OpenSSL para demostrar en vivo:

- conexión exitosa con la CA y el hostname correctos
- rechazo con una CA temporal incorrecta
- rechazo con un hostname incorrecto

El verificador en vivo es read-only, no cambia SSL Enforcement y no imprime credenciales.

`menu_build_ci` se crea con `NOLOGIN` mediante migración. Habilitar `LOGIN` y provisionar o rotar su credencial son operaciones administrativas externas a las migraciones y al repositorio. El rol conserva la lectura necesaria de las tablas build-time para validación y recibe `execute` sobre las funciones privadas de hash, target y revisión. No recibe `select` directo sobre tablas de `app_private`, `staff_users`, Auth ni historial de migraciones. `get_menu_publication_build_target(...)` es la única escritura controlada del build: registra el deployment/revisión bajo `security definer` sin ampliar grants de tabla.

`npm run dev` y `menu:validate` inspeccionan el borrador vivo para trabajo local. `npm run build` resuelve el target inmutable antes de iniciar Astro, pasa request/revisión/hash/versión por variables internas del proceso hijo y hace que el lector cargue solo esa revisión. En Vercel, `VERCEL_DEPLOYMENT_ID` y `VERCEL_PROJECT_ID` deben llegar juntos para persistir la vinculación auditable del deployment.

## Validación local y read-only

Antes de considerar una mutación remota, ejecutar las auditorías SQL contra `SUPABASE_AUDIT_DB_URL`, los probes del Data API con las dos variables `PUBLIC_SUPABASE_*` y las validaciones/builds contra `SUPABASE_DB_URL`:

```bash
npm audit --audit-level=high
npm run supabase:audit
npm run menu:validate
npm run supabase:tls:verify
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

`npm run test:tools` ejecuta, en este orden:

1. `test-handoff-guards.mjs`: alinea dominio/configuración, pin de Supabase en la Function, precondiciones de publicación, dependencia de imágenes, variables públicas, escaneo de secretos y lógica offline del guard de exposición de schemas protegidos en el Data API. La comprobación remota corresponde a `npm run supabase:audit`.
2. `test-menu-publication-build.mjs`: comprueba target y revisión inmutables, snapshot v1, binding de Vercel y fronteras entre build, validador, loaders y admin.
3. `test-menu-publication-migration.mjs`: valida la estructura y las garantías de las tres migraciones de publicación inmutable, incluidas la corrección de regex y la restauración del estado de editores.
4. `test-supabase-postgres-client.mjs`: verifica CA, rechazo de TLS débil, sanitización de errores y uso exclusivo de la factory.
5. `npm run test:edge`: ejecuta con Deno los tests unitarios de rutas de la Function, URL canónica, IDs de evidencia, firma HMAC, binding de proyecto/team/tiempo y metadatos del artefacto.

Para iterar solo sobre `vercelWebhook.ts`, puede ejecutarse `npm run test:edge`; no sustituye las demás suites de `test:tools`.

Para una auditoría de plataforma más amplia:

```bash
npm run supabase -- db advisors --db-url "$SUPABASE_AUDIT_DB_URL"
npm run supabase -- db lint --db-url "$SUPABASE_AUDIT_DB_URL" --schema public,menu_content,app_private --fail-on none
```

Estado esperado:

- Los audits no devuelven risks, diagnostics ni estados estructurales inesperados.
- `menu_content` y las tablas de `app_private` no tienen grants directos de tabla para `anon` o `authenticated`. Las ejecuciones autenticadas en `app_private` se limitan a los helpers requeridos por los wrappers públicos, y ese schema no se expone mediante el Data API.
- El Data API expone de `public.menu_availability_overlays` solo `menu_id`, `section_id`, `item_id` y `available_override`; las escrituras pasan por RPCs.
- `public.staff_users` tiene RLS; cualquier acceso de `authenticated` queda sujeto a sus policies y helpers de staff. El ciclo soportado de altas, cambios y bajas sigue siendo una operación privilegiada externa al navegador.
- Los helpers de transición de publicación siguen ejecutables solo por `service_role`.
- `menu_build_ci` puede ejecutar hash, target y revisión, pero no leer directamente las tablas privadas de publicación.
- No hay más de una solicitud `queued`/`triggered`; cada revisión conserva un snapshot cuyo hash coincide, su conjunto exacto de eventos capturados y cada build apunta a una revisión existente.
- Cada promoción conserva evidencia append-only, fuente, deployment/revisión/hash/proyecto coincidentes y `request_id` opcional. El puntero desplegado corresponde a la evidencia más nueva por tiempo de evento, no necesariamente a la última solicitud.
- Una solicitud `succeeded` tiene evidencia de promoción coincidente; un rollback o re-promoción sin solicitud sigue actualizando correctamente el estado desplegado.

## Procedimientos remotos

> Las operaciones de esta sección afectan Supabase, Auth, usuarios o despliegues reales. Son procedimientos humanos y requieren una decisión y autorización explícitas para el proyecto objetivo. Ejecutar primero la validación read-only y confirmar URL, project ref, credenciales y efecto esperado.

### Operación normal

1. El empleado guarda los cambios desde `/admin/`. Disponibilidad impacta inmediatamente; el resto queda pendiente de publicación.
2. Una solicitud de publicación captura una revisión inmutable y activa el Deploy Hook.
3. El panel consulta `POST /publish-menu-changes/status` y reconcilia automáticamente el artefacto canónico.
4. Considerar el cambio servido solo cuando la solicitud interna tenga estado `succeeded` o la fase expuesta al panel haya vuelto a `up_to_date`; `queued`, `triggered`, `publishing` o un `2xx` del Deploy Hook no demuestran promoción.
5. Si la fase termina en `failed`, reintentar desde el panel una vez liberada la solicitud activa. Si el fallo se repite, inspeccionar Function, build y Vercel antes de otra publicación.

La operación normal no requiere SQL, replay de migraciones, bootstrap, Deploy Hook manual ni seguimiento separado del operador en Vercel.

### Actualizar o recuperar una base existente

1. Ejecutar `npm run supabase:audit` y `npm run menu:validate` contra la base objetivo.
2. Confirmar equivalencia de schema, datos, funciones, grants, policies y fingerprint.
3. Si el remoto conserva el historial pre-squash, no ejecutar `20260707000000_prelaunch_baseline.sql` sobre esa base.
4. Si se autoriza alinear el historial, usar el comando oficial `npm run supabase -- migration repair --linked --status applied <version>...` con las versiones exactas justificadas por la equivalencia comprobada. Usar `--status reverted` solo cuando la evidencia exija retirar una marca. No editar directamente `supabase_migrations.schema_migrations` ni reaplicar el baseline.
5. Aplicar exclusivamente las migraciones incrementales pendientes, siempre en orden. La adopción de publicación inmutable queda completa únicamente con `20260812040001`, `20260812055729` y `20260812062557`.
6. Ejecutar `bootstrap_menu_publication_deployment(...)` solo si el estado recuperado todavía no tiene `deployed_revision_id` y se ha verificado el hash que debe servir el entorno. No repetirlo en un proyecto ya inicializado.
7. Repetir audits, build y checks después de la mutación.

El remoto puede conservar el historial pre-squash completo sin representar drift. La equivalencia se determina por schema, contenido, funciones, permisos, policies y fingerprint, no por tener una sola fila de migración.

### Activar SSL Enforcement

SSL Enforcement rechaza conexiones Postgres sin TLS y su cambio reinicia brevemente la base. La validación autenticada del cliente debe quedar desplegada antes de activarlo.

1. Ejecutar la secuencia de validación local y `npm run supabase:tls:verify` con ambos DSN de producción.
2. Publicar la versión validada de la aplicación y confirmar que build, validación de menú y auditoría siguen conectando.
3. En Supabase Dashboard, abrir **Database Settings -> SSL Configuration** y activar **Enforce SSL on incoming connections**. Esta es una mutación remota y requiere autorización explícita.
4. Esperar que finalice el reinicio breve de la base y repetir `npm run supabase:tls:verify`, `npm run menu:validate`, `npm run supabase:audit`, `npm run build` y `npm run verify:dist-secrets`.
5. Confirmar por separado que una conexión sin TLS sea rechazada. No debilitar temporalmente la factory para hacer esa prueba.
6. Cuando el rollout quede estable, rotar las credenciales Postgres que pudieron haberse usado antes de la validación autenticada.

Si la CA cambia o el test informa menos de un año de vigencia restante, descargar el nuevo **Server root certificate** desde el mismo proyecto, validar su fingerprint y vigencia, comprobarlo contra el hostname real y reemplazar el archivo versionado antes de desplegar. Nunca agregar una CA desconocida para silenciar un error de conexión.

### Base nueva

1. Confirmar que la base esté vacía y corresponda al proyecto objetivo.
2. Aplicar las seis migraciones de `../../supabase/migrations/` con el Supabase CLI, en orden, y verificar que todas terminen sin errores.
3. Provisionar fuera de las migraciones el acceso del rol `menu_build_ci`: habilitar `LOGIN`, asignar o rotar su credencial sin registrarla en SQL versionado y configurar `SUPABASE_DB_URL`. La migración lo deja deliberadamente en `NOLOGIN`; esta habilitación es una mutación remota separada y autorizada.
4. Configurar las variables públicas y la conexión privilegiada de auditoría; después ejecutar `npm audit --audit-level=high`, `npm run supabase:audit`, `npm run menu:validate`, `npm run supabase:tls:verify`, `npm run check:js`, `npm run lint`, `npm run test:admin`, `npm run test:menu`, `npm run test:tools` y `npm run check`. Reservar `npm run build` y `npm run verify:dist-secrets` hasta completar el bootstrap.
5. Crear el primer usuario en Supabase Auth y agregar su fila `admin` a `public.staff_users` mediante SQL privilegiado.
6. Antes de permitir ediciones, definir el primer target inmutable desde el contenido inicial cargado. En una sesión SQL privilegiada ejecutar una sola vez:

   ```sql
   select *
   from public.bootstrap_menu_publication_deployment(
     app_private.get_menu_publication_content_hash()
   );
   ```

   Exigir `bootstrapped = true`, `message = 'publication_bootstrapped'` y un `revision_id` no nulo. Esta llamada define el contenido que debe servir el primer deployment; no copia un hash de un artefacto anterior porque en una base nueva todavía no existe. Si el resultado no es exitoso, detenerse y revisar el estado en lugar de repetirla.
7. Configurar los secretos de la Function y desplegar `publish-menu-changes`.
8. Desplegar la aplicación y comprobar que el `/admin/` canónico exponga la misma revisión y hash iniciales.
9. Ejecutar la validación completa posterior al build y recién entonces habilitar el uso operativo del panel.

La creación del primer admin no se realiza desde browser RLS. `service_role` no tiene grants directos de `SELECT`, `INSERT`, `UPDATE` ni `DELETE` sobre `public.staff_users` para crear o editar staff. Una base nueva todavía sin usuarios operativos no necesita un mecanismo adicional para bloquear la acción de publicar.

### Auth, staff y pruebas de email

Redirects esperados:

- `https://elfaraoncatering.com.ar/admin/`
- `http://localhost:4321/admin/`

Cada empleado operativo necesita dos registros coordinados: una identidad en `auth.users` y una fila en `public.staff_users`. Los roles válidos son `operator` y `admin`; `active` controla el acceso operativo, y `default_availability_profile_id` es solo una preferencia de UI.

El producto no implementa una pantalla ni una RPC pública de mutación de staff. El procedimiento soportado se ejecuta desde Supabase Dashboard y SQL privilegiado en un entorno confiable:

1. **Alta:** crear o invitar la identidad Auth autorizada; después insertar la fila correspondiente en `public.staff_users` con rol, nombre visible, estado activo y preferencia de local.
2. **Cambio:** actualizar rol, nombre visible, preferencia o estado en `public.staff_users`; comprobar que `get_admin_operational_state()` refleje el resultado esperado.
3. **Desactivación:** establecer `active = false` antes de retirar acceso adicional. Esto hace fallar los helpers operativos aun si el JWT todavía no venció.
4. **Baja permanente:** después de desactivar staff, eliminar la identidad desde Supabase Dashboard o una API administrativa autorizada y comprobar por separado el estado de sus sesiones y refresh tokens. Ninguna de esas acciones invalida retroactivamente un JWT ya emitido, que puede seguir siendo válido hasta expirar; la desactivación previa en `staff_users` es la garantía inmediata que corta las RPC operativas del producto. Un bloqueo temporal de Auth no sustituye esta baja.
5. **Verificación:** confirmar el acceso con la cuenta controlada y el rechazo posterior a la desactivación/revocación, sin registrar emails ni credenciales en el repositorio.

La cuenta del último `admin` activo no debe desactivarse o eliminarse sin confirmar antes otro camino administrativo. Cada alta, invitación, cambio, revocación o baja afecta el remoto y requiere autorización explícita.

Login con un usuario staff existente no necesita crear cuentas temporales. Los flujos de recovery, signup, invitación, magic link u OTP pueden enviar email real. Si una prueba fue autorizada, usar una casilla controlada y no versionar su dirección; los emails ya enviados y sus posibles rebotes no se revierten al limpiar el usuario.

La protección contra passwords filtradas se habilita en Supabase Auth settings si el plan la soporta; no se configura mediante migración SQL. El warning `auth_leaked_password_protection` solo se acepta como limitación conocida mientras el proyecto use un plan sin esa capacidad y debe reevaluarse al cambiar de plan.

`supabase/config.toml` versiona la referencia de configuración del proyecto para redirects, confirmación de email, requisito `letters_digits` y flags TOTP, pero no demuestra por sí solo el estado de Auth alojado. Antes de afirmar o modificar una política, comprobar el remoto. El panel valida un mínimo de ocho caracteres y deja que Auth aplique requisitos adicionales; alinear esa validación o agregar una experiencia MFA sería un cambio de producto separado.

La semántica actual de baja, sesiones y JWT se contrasta con la [guía oficial de gestión de usuarios de Supabase](https://supabase.com/docs/guides/auth/managing-user-data).

### Edge Function y secretos

El CLI está fijado como dependencia de desarrollo del repo:

```bash
npm run supabase -- --version
npm run supabase:link -- --project-ref <project-ref>
npm run supabase:migrations
```

Configurar secretos es una mutación remota. Ejemplo, solo después de confirmar el proyecto vinculado y reemplazar todos los placeholders:

```bash
npm run supabase -- secrets set \
  VERCEL_DEPLOY_HOOK_URL=... \
  PUBLISH_ALLOWED_ORIGINS=https://elfaraoncatering.com.ar \
  PUBLISH_STALE_SECONDS=900 \
  PUBLISH_CANONICAL_ADMIN_URL=https://elfaraoncatering.com.ar/admin/ \
  VERCEL_PROJECT_ID=...
```

Agregar `VERCEL_WEBHOOK_SECRET`, `VERCEL_TEAM_ID` y `VERCEL_DEPLOYMENT_BYPASS_SECRET` solo cuando se configure el Account Webhook o el proyecto los requiera. El bypass debe permitir únicamente la lectura server-side necesaria para verificar el artefacto y nunca debe incorporarse al HTML.

El deploy también es una acción remota y requiere autorización explícita:

```bash
npm run supabase:functions:deploy
```

Ese script despliega únicamente `publish-menu-changes` con `--no-verify-jwt`, en línea con `supabase/config.toml`.

La Function fija `@supabase/supabase-js` a una versión exacta en su import. Las actualizaciones deben conservar ese pin, respetar la cuarentena de versiones nuevas y pasar `npm run test:tools` —que incluye `npm run test:edge`—, `npm run check:js` y `npm run lint` antes de considerar un deploy. El repositorio no define un comando separado de typecheck de la Function.

### Referencia histórica: adopción de publicación inmutable

Esta secuencia explica la transición que introdujo las revisiones inmutables. El entorno operativo ya la completó: no debe repetirse como mantenimiento normal. Para un proyecto nuevo usar **Base nueva**; para una restauración o actualización usar **Actualizar o recuperar una base existente**.

1. Registrar el hash real servido por el `/admin/` de producción anterior (`data-deployed-content-hash`) y confirmar que corresponde al dominio canónico.
2. Aplicar, en orden, `20260812040001_add_immutable_menu_publications.sql`, `20260812055729_fix_publication_evidence_regex.sql` y `20260812062557_restore_admin_editor_state.sql`.
3. Con una sesión privilegiada, ejecutar una sola vez `select * from public.bootstrap_menu_publication_deployment('<hash-servido>');`. La función falla sin mutar si el contenido vivo ya difiere del artefacto servido.
4. Configurar los secretos obligatorios, incluido `PUBLISH_CANONICAL_ADMIN_URL`, y desplegar `publish-menu-changes`.
5. Confirmar que Vercel exponga `VERCEL_DEPLOYMENT_ID` y `VERCEL_PROJECT_ID` durante el build. `npm run build` exige ambos juntos en Vercel y registra el target antes de construir.
6. Desplegar la aplicación compatible y verificar en un ciclo real que la solicitud pase por los estados internos `queued`/`triggered`, que el build use la revisión solicitada y que el polling del admin llame `POST /status`, reconcilie el artefacto canónico y deje la solicitud en `succeeded` sin recarga ni paso manual. La fase expuesta debe volver a `up_to_date`, o a `changes_pending` si se guardaron cambios posteriores al snapshot.
7. Opcional en Vercel Pro/Enterprise: crear un Account Webhook filtrado al proyecto para `deployment.promoted`, con endpoint `https://<project-ref>.supabase.co/functions/v1/publish-menu-changes/vercel-webhook`. Guardar el secreto generado como `VERCEL_WEBHOOK_SECRET`; si se restringe por team, configurar también `VERCEL_TEAM_ID`. En planes sin Account Webhooks, conservar solo el probe canónico.
8. Si Deployment Protection impide leer URLs de deployment para el webhook opcional, crear un bypass secret acotado y guardarlo como `VERCEL_DEPLOYMENT_BYPASS_SECRET`. El probe canónico no lo necesita.
9. Mientras una publicación esté activa, guardar un cambio adicional y confirmar que el admin indique que queda para la próxima publicación; después confirmar retry frente a un fallo controlado.
10. Verificar una re-promoción mediante webhook y un rollback mediante el probe canónico al iniciar sesión o volver al panel: la evidencia debe registrarse aun sin solicitud asociada y el puntero desplegado debe seguir el `event_created_at` más reciente.
11. Repetir `npm run supabase:audit`, `npm run menu:validate`, build y escaneo de secretos.

No existe en el código un interruptor general de mantenimiento para pausar globalmente la publicación. La documentación no debe presentar esa acción como un mecanismo disponible; si se necesitara en una transición futura, requeriría una capacidad implementada y validada por separado.

Aplicar migraciones, cargar secretos, desplegar Function/aplicación, crear el Account Webhook opcional o ejecutar una publicación real son cambios externos separados. La presencia de este procedimiento no los autoriza.

## Archivos de esta carpeta

- `schema-diagram.md`: mapa Mermaid del modelo, overlay, admin y publicación.
- `audits/menu-schema-audit.sql`: tablas, constraints, índices y diagnósticos del modelo activo.
- `audits/database-audit.sql`: inventario de objetos, exposición, policies, helpers y hallazgos.

Estos archivos son documentación y auditorías read-only. La historia aplicable permanece exclusivamente en `../../supabase/migrations/`.
