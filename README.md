# El Faraon Catering

Menú digital QR para los buffets operados por **El Faraon Catering** en los dos edificios de **Telefe**. La experiencia pública es rápida, mobile-first e informativa: no incluye pedidos, pagos, reservas, carrito ni cuentas de clientes. Los enlaces de WhatsApp, cuando existen, son solo vías de contacto.

Este repositorio mantiene la aplicación que se encuentra en producción. El trabajo habitual es operación, validación y mantenimiento controlado; el aprovisionamiento de entornos y la recuperación se documentan como procedimientos separados.

Producción: [elfaraoncatering.com.ar](https://elfaraoncatering.com.ar). El alias heredado `elfaraoncatering.vercel.app` redirige permanentemente al dominio canónico mediante una regla versionada en `vercel.json`. El dominio `www` también redirige conservando la ruta, pero se administra en Vercel Domains y esa configuración remota no está representada en `vercel.json`.

La landing publica metadatos Open Graph y Twitter con una imagen social propia, junto con JSON-LD `LocalBusiness` para identificar el negocio, sus contactos, domicilio y área de cobertura.

## Superficies activas

- `/`: landing institucional pública.
- `/menu/corpo/`: menú operativo principal.
- `/menu/teleinde/`: segundo menú operativo del modelo multiubicación.
- `/menu/`: redirección temporal a `/`; no publica un índice de ubicaciones.
- `/admin/`: CMS operativo estático para empleados.

Los menús se publican con `X-Robots-Tag: noindex, follow` y el admin con `X-Robots-Tag: noindex, nofollow`. `vercel.json` versiona esos headers, las redirecciones de rutas, la canonicalización del alias `vercel.app` y los demás headers de seguridad; la redirección de `www` pertenece a Vercel Domains.

## Arquitectura

El sitio usa Astro con output estático en Vercel. Supabase tiene dos responsabilidades separadas:

- `menu_content` es la fuente privada de estructura y contenido operativo que Astro lee durante el build.
- `public.menu_availability_overlays` es el único dato de menú que cambia en runtime sin rebuild.

El contenido build-time incluye menú del día, servicio activo por local, parrilla, catálogo fijo, opciones, precios, imágenes y textos estructurales. La disponibilidad es individual por local/menú; si no existe un overlay, el ítem se considera disponible.

`/admin/` usa Supabase Auth, lee mediante `get_admin_operational_state()` y escribe mediante RPCs controladas. La sesión Auth se conserva en `sessionStorage` para la pestaña activa; el estado operativo y de publicación se obtiene de Supabase y no usa el almacenamiento del navegador como fuente de verdad. Permite administrar disponibilidad, servicio del día, parrilla, contenido del menú fijo, opciones, precios y publicación. No es un CMS institucional ni una interfaz de gestión de empleados.

Los cambios de disponibilidad impactan en runtime. Los demás cambios del admin necesitan un nuevo build/deploy. Al publicar, la base captura una revisión JSONB inmutable y Vercel construye exactamente esa revisión; los cambios que el operador siga guardando quedan para la publicación siguiente. La Edge Function `publish-menu-changes` dispara el Deploy Hook y confirma el resultado cuando su probe server-side verifica la revisión servida por el admin canónico. El probe también se ejecuta de forma acotada al iniciar sesión o volver al panel para reconciliar rollbacks. Un webhook firmado de Vercel puede acelerar las promociones, pero no es requisito para el flujo del operador. El hook, las firmas y las credenciales de servicio nunca llegan al navegador.

Para el modelo de datos, baseline, permisos, auditorías y procedimientos remotos, consultar el [runbook de Supabase](./docs/supabase/README.md) y el [diagrama del schema](./docs/supabase/schema-diagram.md). Para el uso cotidiano del panel, consultar la [guía del operador](./docs/admin-operator-guide.md).

## Stack

- Astro 7 y TypeScript
- Tailwind CSS 4
- Node 22 LTS y npm 10+
- Supabase Postgres, Auth y una Edge Function
- Vercel static deployment

## Desarrollo local

### Requisitos

- Node `22.x`
- npm `>=10`
- `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` para el cliente y para cualquier build
- `SUPABASE_DB_URL` para builds y validaciones que leen contenido de Supabase
- `SUPABASE_AUDIT_DB_URL` para auditorías locales privilegiadas
- OpenSSL para `npm run supabase:tls:verify`; el script busca `OPENSSL_PATH`, Git for Windows y luego `openssl` en `PATH`

### Instalación y servidor

```bash
npm ci
npm run dev
```

Usar `npm ci` para reproducir exactamente `package-lock.json`. `npm install` se reserva para cambios intencionales de dependencias que deban actualizar el lockfile.

Rutas locales:

- `http://localhost:4321/`
- `http://localhost:4321/menu/corpo/`
- `http://localhost:4321/menu/teleinde/`
- `http://localhost:4321/admin/`

Para revisar un build ya generado:

```bash
npm run build
npm run preview
```

`npm run dev` lee el contenido editable actual para previsualización local. `npm run build` resuelve la revisión inmutable configurada en la base y falla si el estado de publicación aún no fue inicializado; no publica silenciosamente borradores vivos.

### Variables de entorno

Usar [.env.example](./.env.example) como referencia y guardar valores locales en `.env.local`, que está ignorado por Git.

```bash
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_URL=
SUPABASE_AUDIT_DB_URL=
# OPENSSL_PATH=
```

Las variables `PUBLIC_*` son intencionalmente visibles para el cliente. `PUBLIC_SUPABASE_URL` debe corresponder al origen HTTPS permitido en la directiva `connect-src` de `vercel.json`; cambiar de proyecto Supabase exige actualizar ambos valores, porque de lo contrario Auth, RPCs y el overlay fallarán en el navegador por CSP.

`SUPABASE_DB_URL` y `SUPABASE_AUDIT_DB_URL` son privadas y no deben llevar el prefijo `PUBLIC_`. La primera usa el rol mínimo de build y validación: sus lecturas directas están acotadas y su única escritura es el registro encapsulado del vínculo deployment/revisión; la segunda se reserva para auditorías locales. `OPENSSL_PATH` es opcional y solo selecciona el ejecutable local para las pruebas TLS. Los tokens del CLI y los secretos de `publish-menu-changes` se configuran por separado; sus nombres y procedimiento están documentados en el [runbook de Supabase](./docs/supabase/README.md#variables).

Las conexiones Postgres privadas validan la CA y el hostname mediante la factory compartida `src/utils/supabasePostgresClient.mjs` y el certificado público versionado `config/certs/supabase-prod-ca-2021.crt`. Los DSN deben omitir `sslmode` o usar `sslmode=verify-full`; no se admite desactivar la validación TLS ni reemplazar la CA desde la URL.

## Scripts npm

### Aplicación y checks locales

| Script | Uso |
| --- | --- |
| `npm run dev` | Levanta Astro en desarrollo. |
| `npm run build` | Resuelve la revisión de publicación y genera `dist/` con su snapshot inmutable. Requiere `SUPABASE_DB_URL`, una publicación inicializada y las dos variables `PUBLIC_SUPABASE_*`. |
| `npm run preview` | Sirve el build local. |
| `npm run check` | Ejecuta `astro check`. |
| `npm run check:js` | Valida sintaxis de JS/MJS fuera del typecheck de Astro. |
| `npm run lint` | Ejecuta ESLint. |
| `npm run test:admin` | Prueba reglas, render y operaciones del admin. |
| `npm run test:edge` | Ejecuta con Deno las pruebas de rutas, firma, binding y evidencia de `publish-menu-changes`. |
| `npm run test:menu` | Prueba el overlay público de disponibilidad. |
| `npm run test:tools` | Prueba guardas de configuración y secretos —incluida la lógica offline de exposición del Data API—, publicación inmutable, migración y cliente TLS; al final también ejecuta `test:edge`. |
| `npm run menu:validate` | Valida contenido y hardening esperado en Supabase. Requiere `SUPABASE_DB_URL`. |
| `npm run verify:dist-secrets` | Revisa un `dist/` ya generado en busca de marcadores de secretos. |
| `npm run supabase:audit` | Ejecuta auditorías SQL y probes read-only del Data API. Requiere `SUPABASE_AUDIT_DB_URL` y las dos variables `PUBLIC_SUPABASE_*`. |
| `npm run supabase:tls:verify` | Verifica en vivo conexiones autenticadas y el rechazo de CA/hostname incorrectos. Requiere ambos DSN privados y OpenSSL. |

### Imágenes fuente del menú

Los originales viven fuera del repositorio. El flujo de mantenimiento es:

1. Copiar fuentes JPG, JPEG o PNG a `<source-images-dir>/pending/`.
2. Añadir o revisar su entrada en `NAME_MAP`, dentro de `scripts/optimize-menu-images.mjs`. La clave es el nombre base del original, en minúsculas y sin extensión. Cada entrada fija el `itemId`, el slug WebP, el rol `primary` o `additional` y, para adicionales, un `orderIndex` mayor o igual que uno; las primarias reciben el índice cero.
3. Ejecutar `node scripts/optimize-menu-images.mjs <source-images-dir>`. Sin argumento, el script usa `assets/source-images/menu/` como staging local compatible.
4. Revisar los WebP generados en `public/uploads/menu/` y los originales movidos a `<source-images-dir>/used/`.
5. Versionar el asset y desplegar la aplicación mediante el flujo autorizado. Si cambia la ruta, el ítem o el orden, actualizar además la asociación build-time en `menu_content.menu_catalog_item_images`, validarla y publicar ese contenido. El optimizador no modifica Supabase y el panel no gestiona imágenes.

El script falla ante archivos sin mapeo, slugs u órdenes duplicados y salidas preexistentes. Un reemplazo sobre la misma ruta exige declarar `replaceExisting: true` de forma intencional en `NAME_MAP`; no se sobrescriben imágenes por omisión y ese reemplazo necesita un nuevo despliegue de la aplicación. La ruta absoluta de la biblioteca local se registra en `docs/project-context.local.md`, que permanece fuera de Git.

### Supabase CLI

| Script | Uso |
| --- | --- |
| `npm run supabase -- <args>` | Ejecuta el CLI fijado por el proyecto. |
| `npm run supabase:link` | Vincula el checkout con un proyecto remoto. |
| `npm run supabase:migrations` | Lista migraciones locales y remotas. |
| `npm run supabase:functions:deploy` | Despliega remotamente solo `publish-menu-changes`. |

Los comandos que vinculan, mutan o despliegan recursos remotos son procedimientos operativos, no checks locales. El [runbook de Supabase](./docs/supabase/README.md) indica sus precondiciones y efectos.

## Validación

Para cambios de aplicación, seleccionar los checks según la superficie:

```bash
npm run test:admin
npm run test:menu
npm run test:tools
npm run check:js
npm run lint
npm run check
```

Para una modificación aislada de `publish-menu-changes`, `npm run test:edge` ofrece la comprobación enfocada. La suite completa `npm run test:tools` vuelve a ejecutarla después de sus pruebas Node.

Cuando el cambio requiere construir con contenido real, ejecutar el build antes del escaneo de secretos:

```bash
npm run build
npm run verify:dist-secrets
```

Los cambios de schema, permisos o contenido build-time siguen la secuencia read-only y los procedimientos remotos del [runbook de Supabase](./docs/supabase/README.md#validación-local-y-read-only).

Antes de activar o cambiar SSL Enforcement en Supabase, ejecutar también `npm run supabase:tls:verify`. Ese comando es read-only, no modifica la configuración remota y no imprime los DSN.

### GitHub Actions

`.github/workflows/ci.yml` ejecuta `npm ci`, `check`, `check:js`, `lint`, `test:admin`, `test:menu` y `test:tools` en pull requests, pushes a `main` y ejecuciones manuales. Como `test:tools` incluye `test:edge`, las pruebas Deno también forman parte de ese job.

Después de los checks, un push a `main` o una ejecución manual habilitan el job `Production build`, que valida el menú, construye con las variables del environment `production-build` y revisa `dist/` en busca de secretos. Ese workflow no ejecuta `vercel deploy` ni promueve un deployment: un build verde de GitHub Actions valida el artefacto, pero no demuestra por sí solo que producción ya lo esté sirviendo. El despliegue y su confirmación pertenecen a Vercel y al flujo de publicación descrito más abajo.

## Mapa del repositorio

| Ruta | Responsabilidad |
| --- | --- |
| `src/pages/` | Rutas Astro públicas y admin. |
| `src/components/` y `src/menu/` | Presentación y reglas del menú. |
| `src/admin/` | Cliente TypeScript del CMS operativo. |
| `src/utils/` | Lectura, transformación y snapshot de contenido. |
| `public/` | Assets, uploads y scripts cliente. |
| `scripts/` | Builds auxiliares, validadores, auditorías y tests Node. |
| `supabase/migrations/` | Migraciones canónicas. |
| `supabase/functions/` | Edge Function de publicación y código compartido. |
| `docs/supabase/` | Runbook, diagrama y auditorías SQL read-only. |
| `docs/admin-operator-guide.md` | Uso cotidiano del CMS operativo. |

`dist/`, `.astro/` y `node_modules/` son generados y no forman parte de la fuente.

## Documentación

- [Guía del operador](./docs/admin-operator-guide.md): acceso, edición, disponibilidad, publicación y escalamiento desde el panel.
- [Supabase local-first workflow](./docs/supabase/README.md): operación técnica actual, aprovisionamiento, recuperación, baseline, auditorías, variables, CLI y operaciones remotas.
- [Supabase schema diagram](./docs/supabase/schema-diagram.md): modelo estructural, runtime, permisos y publicación.
- [AGENTS.md](./AGENTS.md): invariantes y límites para agentes que modifican el repositorio.

La documentación privada sobre custodios, accesos, responsables, continuidad e incidentes se conserva en la biblioteca operativa externa y no se versiona en este repositorio. `docs/project-context.local.md` solo enlaza ese contexto en cada máquina y permanece fuera de Git.

## Operación y despliegue actuales

El deploy de la aplicación es estático en Vercel. No hay adapter de servidor, SSR, API routes ni Vercel Functions. La única función server-side del sistema es la Edge Function Supabase `publish-menu-changes`: reserva una revisión inmutable, solicita el rebuild y reconcilia el artefacto servido mediante `POST /status`. Opcionalmente recibe en `/vercel-webhook` eventos firmados `deployment.promoted`.

El admin muestra estados simples (`cambios pendientes`, `publicando`, `publicado` o `fallo`) derivados de la base y actualiza automáticamente el progreso. La publicación no depende de cooldowns, hashes visibles, recargas manuales ni estado persistido en el navegador; el operador puede seguir editando mientras una revisión anterior se publica. Solo la sesión Auth de la pestaña se conserva en `sessionStorage`.

La operación normal consiste en guardar el contenido, publicar cuando corresponda y dejar que la reconciliación confirme el hash inmutable servido. Un acuse `2xx` del Deploy Hook solo indica que el despliegue fue solicitado; no equivale a una promoción confirmada. El Account Webhook de Vercel es una aceleración opcional para planes compatibles, no un requisito del flujo base.

El dominio canónico y único origen operativo del admin es `https://elfaraoncatering.com.ar`. La configuración remota de Supabase Auth y el secreto `PUBLISH_ALLOWED_ORIGINS` deben mantenerse alineados con ese origen y con la referencia versionada en `supabase/config.toml`.

### Aprovisionamiento y recuperación

La aplicación de migraciones, el bootstrap de la primera revisión, la configuración de secretos, el despliegue de la Edge Function y la recuperación desde una base o un deployment anterior no forman parte de la operación cotidiana. Se ejecutan únicamente para un entorno nuevo, una migración pendiente o una contingencia comprobada.

Esos procedimientos pueden modificar Supabase, Auth o Vercel y requieren autorización explícita, validación previa del proyecto objetivo y comprobación posterior del artefacto servido. La secuencia soportada, junto con las diferencias entre una base nueva, una base existente y una recuperación, está en el [runbook de Supabase](./docs/supabase/README.md).
