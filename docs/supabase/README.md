# Supabase local-first workflow

Runbook tecnico para la base Supabase del menu QR. Las migraciones canonicas viven en `../../supabase/migrations/`; esta carpeta contiene documentacion, el diagrama del modelo y auditorias SQL read-only.

## Superficies activas

- `menu_content`: fuente privada de estructura y contenido operativo build-time.
- `public.menu_availability_overlays`: unico overlay runtime sin rebuild.
- `public.staff_users`: empleados, roles y preferencia de local del CMS.
- `public.get_admin_operational_state()`: lectura controlada para `/admin/`.
- RPCs operativas publicas: unica superficie de escritura del navegador.
- `app_private.menu_publication_revisions`: snapshots JSONB inmutables del contenido solicitado.
- `app_private.menu_publication_revision_events`: membresia exacta de cambios incluida en cada revision.
- `app_private.menu_publish_requests`: solicitudes y fases de publicacion.
- `app_private.menu_publication_state`: punteros singleton a la solicitud activa y revision desplegada.
- `app_private.menu_publication_builds`: vinculo auditable entre un deployment de Vercel y su revision exacta.
- `app_private.menu_publication_promotions`: evidencia append-only de promociones, re-promociones y rollbacks.
- `app_private.menu_change_events`: cambios build-time asociados a una publicacion.
- `publish-menu-changes`: Edge Function que valida al empleado, llama el Vercel Deploy Hook y reconcilia promociones por probe canonico o webhook firmado opcional.

Salvo disponibilidad, los cambios operativos necesitan rebuild/deploy para impactar los menus publicos. El modelo completo y sus relaciones estan en [schema-diagram.md](./schema-diagram.md).

## Frontera build-time/runtime

Se leen durante el build:

- menu del dia y servicio activo por local
- parrilla y sus variantes
- catalogo fijo, opciones, precios, imagenes y textos estructurales

La disponibilidad cambia en runtime exclusivamente mediante `public.menu_availability_overlays`. Las columnas build-time `available` permanecen en `true`; la ausencia de overlay significa disponible. Los items con opciones usan targets compuestos como `item-id-option-id`.

`/admin/` autentica empleados con Supabase Auth. `operator` administra el contenido operativo de todos los perfiles y puede publicar; `admin` hereda ese alcance y puede gestionar staff a nivel de base/RPC. La aplicacion no tiene una pantalla de gestion de empleados.

Las funciones publicas del admin son wrappers `security invoker`; sus cuerpos privilegiados viven en `app_private`. Los helpers `bootstrap_menu_publication_deployment`, `reserve_menu_publish_request`, `start_menu_publish_request`, `fail_menu_publish_request` y `confirm_menu_publish_deployment` son service-role-only para `publish-menu-changes` y el rollout inicial; estan revocados para `anon` y `authenticated`.

Una solicitud de publicacion captura el snapshot, su hash y los IDs exactos de `menu_change_events` dentro de la misma sentencia MVCC. Solo puede existir una solicitud activa en `queued` o `triggered`; `expires_at`, derivado de `PUBLISH_STALE_SECONDS`, permite mostrar fallo y reintentar sin cooldown local si Vercel no completa el ciclo. El build resuelve una vez el target, vincula el `VERCEL_DEPLOYMENT_ID` y luego lee la revision por UUID; nunca vuelve a consultar contenido vivo para ese artefacto. Un `2xx` del Deploy Hook solo cambia la fase a `triggered`.

Mientras la fase es `publishing`, y tambien una vez al iniciar sesion o volver al panel con un limite de una consulta por minuto, el admin consulta `POST /publish-menu-changes/status`. La Function verifica server-side el `/admin/` canonico y registra evidencia cuando sus metadatos coinciden con un build conocido. Esta reconciliacion automatica es el camino base, cubre rollbacks y no exige acciones del operador. Un Account Webhook `deployment.promoted` agrega confirmacion mas rapida cuando el plan de Vercel lo permite, pero Vercel no emite ese evento para rollbacks. Ambas fuentes escriben promociones append-only, actualizan la revision desplegada por `event_created_at` y admiten evidencia sin `request_id`.

## Baseline canonico

La migracion activa para bases nuevas es:

| Migracion | Proposito |
| --- | --- |
| `20260707000000_prelaunch_baseline.sql` | Crea schemas, tablas, contenido build-time, RPCs, fingerprint, auditoria privada, publicacion, RLS, policies, grants y hardening del estado prelanzamiento. |
| `20260723230712_add_menu_build_ci_role.sql` | Crea el rol de build sin login y limita sus grants al contenido, overlay y fingerprint requeridos. |
| `20260808233225_standardize_teleinde_whatsapp.sql` | Normaliza el enlace de WhatsApp de Teleinde al formato internacional movil `54911`. |
| `20260812040001_add_immutable_menu_publications.sql` | Agrega revisiones JSONB inmutables, target exacto de build, fases server-side y confirmacion de promocion de Vercel. |
| `20260812055729_fix_publication_evidence_regex.sql` | Corrige la validacion de IDs de evidencia para el limite de cuantificadores del motor regex de PostgreSQL. |

El tag anotado `supabase-prelaunch-history-2026-07-07` conserva la historia incremental inmediatamente anterior al squash actual. `supabase-prelaunch-history-2026-06-06` es un corte historico anterior; no es el tag de la baseline vigente. `yaml-rollback-2026-05-02` conserva el ultimo estado file-backed, pero YAML ya no es fuente activa.

El baseline incluye el contenido actual de `menu_content` y sincroniza las secuencias identity. Deja vacias estas superficies vivas:

- `public.staff_users`
- `public.menu_availability_overlays`
- `app_private.menu_publish_requests`
- `app_private.menu_publication_revisions`
- `app_private.menu_publication_revision_events`
- `app_private.menu_publication_builds`
- `app_private.menu_publication_promotions`
- `app_private.menu_change_events`

`app_private.menu_publication_state` conserva una fila singleton sin target hasta ejecutar el bootstrap controlado. Por eso una base nueva o existente no puede construir produccion con la nueva version antes de completar el bootstrap del rollout.

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
- `PUBLISH_STALE_SECONDS` (default recomendado: `900`; rango aceptado: `60` a `3600`)
- `PUBLISH_CANONICAL_ADMIN_URL` (produccion: `https://elfaraoncatering.com.ar/admin/`)
- `VERCEL_PROJECT_ID`
- `VERCEL_WEBHOOK_SECRET` (opcional; solo si se configura Account Webhook)
- `VERCEL_TEAM_ID` (opcional; restringe el webhook al team esperado)
- `VERCEL_DEPLOYMENT_BYPASS_SECRET` (opcional; permite verificar `/admin/` si el deployment tiene proteccion)

`SUPABASE_DB_URL`, `SUPABASE_AUDIT_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_DEPLOY_HOOK_URL`, `VERCEL_WEBHOOK_SECRET` y `VERCEL_DEPLOYMENT_BYPASS_SECRET` son privados. No deben exponerse como `PUBLIC_*`, registrarse en logs ni versionarse. `../../.env.example` enumera las variables locales sin valores reales.

### TLS de conexiones Postgres

Los cuatro consumidores directos de Postgres (build de Astro, lectura del snapshot, validacion de menu y auditoria privilegiada) deben usar exclusivamente `../../src/utils/supabasePostgresClient.mjs`. La factory carga `../../config/certs/supabase-prod-ca-2021.crt`, exige validacion de CA y hostname, y rechaza configuraciones que debiliten o reemplacen esa politica.

El certificado raiz es publico y se versiona; no contiene credenciales. Los DSN privados pueden omitir `sslmode` o declarar `sslmode=verify-full`. No usar `disable`, `allow`, `prefer`, `require`, `verify-ca`, `NODE_TLS_REJECT_UNAUTHORIZED=0` ni parametros de certificado dentro del DSN.

`npm run test:tools` verifica offline que la CA sea valida y tenga al menos un ano de vigencia restante, que los DSN degradados fallen antes de conectar y que no exista ningun `postgres()` fuera de la factory. `npm run supabase:tls:verify` usa ambos DSN privados y OpenSSL para demostrar en vivo:

- conexion exitosa con la CA y el hostname correctos
- rechazo con una CA temporal incorrecta
- rechazo con un hostname incorrecto

El verificador en vivo es read-only, no cambia SSL Enforcement y no imprime credenciales.

`menu_build_ci` se crea sin login mediante migracion. Su contraseña se provisiona fuera del repositorio. Conserva la lectura necesaria de las tablas build-time para validacion y recibe `execute` sobre las funciones privadas de hash, target y revision. No recibe `select` directo sobre tablas de `app_private`, `staff_users`, Auth ni historial de migraciones. `get_menu_publication_build_target(...)` es la unica escritura controlada del build: registra el deployment/revision bajo `security definer` sin ampliar grants de tabla.

`npm run dev` y `menu:validate` inspeccionan el borrador vivo para trabajo local. `npm run build` resuelve el target inmutable antes de iniciar Astro, pasa request/revision/hash/version por variables internas del proceso hijo y hace que el lector cargue solo esa revision. En Vercel, `VERCEL_DEPLOYMENT_ID` y `VERCEL_PROJECT_ID` deben llegar juntos para persistir la vinculacion auditable del deployment.

## Validacion local y read-only

Antes de considerar una mutacion remota, ejecutar las auditorias SQL contra `SUPABASE_AUDIT_DB_URL`, los probes del Data API con las dos variables `PUBLIC_SUPABASE_*` y las validaciones/builds contra `SUPABASE_DB_URL`:

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
- Los helpers de transicion de publicacion siguen ejecutables solo por `service_role`.
- `menu_build_ci` puede ejecutar hash, target y revision, pero no leer directamente las tablas privadas de publicacion.
- No hay mas de una solicitud `queued`/`triggered`; cada revision conserva un snapshot cuyo hash coincide, su conjunto exacto de eventos capturados y cada build apunta a una revision existente.
- Cada promocion conserva evidencia append-only, fuente, deployment/revision/hash/proyecto coincidentes y `request_id` opcional. El puntero desplegado corresponde a la evidencia mas nueva por tiempo de evento, no necesariamente a la ultima solicitud.
- Una solicitud `succeeded` tiene evidencia de promocion coincidente; un rollback o re-promocion sin solicitud sigue actualizando correctamente el estado desplegado.

## Procedimientos remotos

> Las operaciones de esta seccion afectan Supabase, Auth, usuarios o despliegues reales. Son procedimientos humanos y requieren una decision y autorizacion explicitas para el proyecto objetivo. Ejecutar primero la validacion read-only y confirmar URL, project ref, credenciales y efecto esperado.

### Base existente

1. Ejecutar `npm run supabase:audit` y `npm run menu:validate` contra la base objetivo.
2. Confirmar equivalencia de schema, datos, funciones, grants, policies y fingerprint.
3. Si el remoto conserva el historial pre-squash, no ejecutar `20260707000000_prelaunch_baseline.sql` sobre esa base.
4. Si se autoriza alinear el historial, reparar solo `supabase_migrations.schema_migrations` despues de probar la equivalencia; no reaplicar el baseline.
5. Aplicar exclusivamente migraciones incrementales posteriores pendientes.
6. Para esta migracion, completar el bootstrap y el rollout coordinado de la seccion siguiente antes de ejecutar un build de la nueva aplicacion.
7. Repetir audits, build y checks despues de la mutacion.

El remoto de handoff puede conservar el historial pre-squash completo sin representar drift. La equivalencia se determina por schema, contenido, funciones, permisos, policies y fingerprint, no por tener una sola fila de migracion.

### Activar SSL Enforcement

SSL Enforcement rechaza conexiones Postgres sin TLS y su cambio reinicia brevemente la base. La validacion autenticada del cliente debe quedar desplegada antes de activarlo.

1. Ejecutar la secuencia de validacion local y `npm run supabase:tls:verify` con ambos DSN de produccion.
2. Publicar la version validada de la aplicacion y confirmar que build, validacion de menu y auditoria siguen conectando.
3. En Supabase Dashboard, abrir **Database Settings -> SSL Configuration** y activar **Enforce SSL on incoming connections**. Esta es una mutacion remota y requiere autorizacion explicita.
4. Esperar que finalice el reinicio breve de la base y repetir `npm run supabase:tls:verify`, `npm run menu:validate`, `npm run supabase:audit`, `npm run build` y `npm run verify:dist-secrets`.
5. Confirmar por separado que una conexion sin TLS sea rechazada. No debilitar temporalmente la factory para hacer esa prueba.
6. Cuando el rollout quede estable, rotar las credenciales Postgres que pudieron haberse usado antes de la validacion autenticada.

Si la CA cambia o el test informa menos de un ano de vigencia restante, descargar el nuevo **Server root certificate** desde el mismo proyecto, validar su fingerprint y vigencia, comprobarlo contra el hostname real y reemplazar el archivo versionado antes de desplegar. Nunca agregar una CA desconocida para silenciar un error de conexion.

### Base nueva

1. Aplicar `../../supabase/migrations/` con el Supabase CLI contra la base nueva confirmada.
2. Verificar que el baseline y cualquier migracion posterior terminen sin errores.
3. Ejecutar ambos audits SQL, `npm run menu:validate` y el resto de la secuencia de validacion.
4. Crear el primer usuario en Supabase Auth y agregar su fila `admin` a `public.staff_users` mediante SQL privilegiado.
5. Inicializar la revision desplegada, configurar los secretos de la Function y desplegar `publish-menu-changes` segun el rollout coordinado.

La creacion del primer admin no se realiza desde browser RLS y `service_role` no tiene acceso directo a `public.staff_users`.

### Auth, staff y pruebas de email

Redirects esperados:

- `https://elfaraoncatering.com.ar/admin/`
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

Configurar secretos es una mutacion remota. Ejemplo, solo despues de confirmar el proyecto vinculado y reemplazar todos los placeholders:

```bash
npm run supabase -- secrets set \
  VERCEL_DEPLOY_HOOK_URL=... \
  PUBLISH_ALLOWED_ORIGINS=https://elfaraoncatering.com.ar \
  PUBLISH_STALE_SECONDS=900 \
  PUBLISH_CANONICAL_ADMIN_URL=https://elfaraoncatering.com.ar/admin/ \
  VERCEL_PROJECT_ID=...
```

Agregar `VERCEL_WEBHOOK_SECRET`, `VERCEL_TEAM_ID` y `VERCEL_DEPLOYMENT_BYPASS_SECRET` solo cuando se configure el Account Webhook o el proyecto los requiera. El bypass debe permitir unicamente la lectura server-side necesaria para verificar el artefacto y nunca debe incorporarse al HTML.

El deploy tambien es una accion remota y requiere autorizacion explicita:

```bash
npm run supabase:functions:deploy
```

Ese script despliega unicamente `publish-menu-changes` con `--no-verify-jwt`, en linea con `supabase/config.toml`.

La Function fija `@supabase/supabase-js` a una version exacta en su import. Las actualizaciones deben conservar ese pin, respetar la cuarentena de versiones nuevas y pasar `npm run test:tools`, el chequeo Deno de la Function, `npm run check:js` y `npm run lint` antes de considerar un deploy.

### Rollout de publicacion inmutable

Este rollout coordina Supabase y Vercel y requiere autorizacion explicita para cada proyecto remoto. Deshabilitar temporalmente la accion de publicar antes de aplicar la migracion y mantenerla deshabilitada hasta completar bootstrap, Edge Function y aplicacion nueva: el admin y la Function anteriores no son compatibles con las nuevas firmas y fases.

1. Registrar el hash real servido por el `/admin/` de produccion actual (`data-deployed-content-hash`) y confirmar que corresponde al dominio canonico.
2. Aplicar `20260812040001_add_immutable_menu_publications.sql` y, con una sesion privilegiada, ejecutar una sola vez `select * from public.bootstrap_menu_publication_deployment('<hash-servido>');`. La funcion falla sin mutar si el contenido vivo ya difiere del artefacto servido.
3. Configurar los secretos obligatorios, incluido `PUBLISH_CANONICAL_ADMIN_URL`, y desplegar `publish-menu-changes`.
4. Confirmar que Vercel expone `VERCEL_DEPLOYMENT_ID` y `VERCEL_PROJECT_ID` durante el build. `npm run build` exige ambos juntos en Vercel y registra el target antes de construir.
5. Desplegar la aplicacion nueva y recien entonces volver a habilitar publicaciones.
6. Verificar en un ciclo real que la solicitud pase por `queued`/`triggered`, que el build use la revision solicitada y que el polling del admin llame `POST /status`, reconcilie el artefacto canonico y cambie a `succeeded` sin recarga ni paso manual.
7. Recomendado en Vercel Pro/Enterprise: crear un Account Webhook filtrado al proyecto para `deployment.promoted`, con endpoint `https://<project-ref>.supabase.co/functions/v1/publish-menu-changes/vercel-webhook`. Guardar el secreto generado como `VERCEL_WEBHOOK_SECRET`; si se restringe por team, configurar tambien `VERCEL_TEAM_ID`. En planes sin Account Webhooks, conservar solo el probe canonico.
8. Si Deployment Protection impide leer URLs de deployment para el webhook opcional, crear un bypass secret acotado y guardarlo como `VERCEL_DEPLOYMENT_BYPASS_SECRET`. El probe canonico no lo necesita.
9. Mientras una publicacion esta activa, guardar un cambio adicional y confirmar que el admin indique que queda para la proxima publicacion; despues confirmar retry frente a un fallo controlado.
10. Verificar una re-promocion mediante webhook y un rollback mediante el probe canonico al iniciar sesion o volver al panel: la evidencia debe registrarse aun sin solicitud asociada y el puntero desplegado debe seguir el `event_created_at` mas reciente.
11. Repetir `npm run supabase:audit`, `npm run menu:validate`, build y escaneo de secretos.

Aplicar la migracion, cargar secretos, desplegar Function/aplicacion, crear el Account Webhook opcional o ejecutar una publicacion real son cambios externos separados. La presencia de este procedimiento no los autoriza.

## Archivos de esta carpeta

- `schema-diagram.md`: mapa Mermaid del modelo, overlay, admin y publicacion.
- `audits/menu-schema-audit.sql`: tablas, constraints, indices y diagnosticos del modelo activo.
- `audits/database-audit.sql`: inventario de objetos, exposicion, policies, helpers y hallazgos.

Estos archivos son documentacion y auditorias read-only. La historia aplicable permanece exclusivamente en `../../supabase/migrations/`.
