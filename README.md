# El Faraon Catering

Menu digital QR para los buffets operados por **El Faraon Catering** en los dos edificios de **Telefe**. La experiencia publica es rapida, mobile-first e informativa: no incluye pedidos, pagos, reservas, carrito ni cuentas de clientes. Los enlaces de WhatsApp, cuando existen, son solo vias de contacto.

Produccion: [elfaraoncatering.com.ar](https://elfaraoncatering.com.ar). El dominio `www` redirige al dominio canonico sin `www`.

## Superficies activas

- `/`: landing institucional publica.
- `/menu/corpo/`: menu operativo principal.
- `/menu/teleinde/`: segundo menu operativo del modelo multi-locacion.
- `/menu/`: redirect temporal a `/`; no publica un indice de ubicaciones.
- `/admin/`: CMS operativo estatico para empleados.

Las rutas de menu y admin se publican con headers `noindex`; `vercel.json` contiene los redirects, canonicalizaciones y headers de seguridad vigentes.

## Arquitectura

El sitio usa Astro con output estatico en Vercel. Supabase tiene dos responsabilidades separadas:

- `menu_content` es la fuente privada de estructura y contenido operativo que Astro lee durante el build.
- `public.menu_availability_overlays` es el unico dato de menu que cambia en runtime sin rebuild.

El contenido build-time incluye menu del dia, servicio activo por local, parrilla, catalogo fijo, opciones, precios, imagenes y textos estructurales. La disponibilidad es individual por local/menu; si no existe un overlay, el item se considera disponible.

`/admin/` usa Supabase Auth, lee mediante `get_admin_operational_state()` y escribe mediante RPCs controladas. Permite administrar disponibilidad, servicio del dia, parrilla, contenido del menu fijo, opciones, precios y publicacion. No es un CMS institucional ni una interfaz de gestion de empleados

Los cambios de disponibilidad impactan en runtime. Los demas cambios del admin necesitan un nuevo build/deploy. La Edge Function `publish-menu-changes` es el puente entre el admin y el Vercel Deploy Hook; el hook y las credenciales de servicio nunca llegan al navegador.

Para el modelo de datos, baseline, permisos, auditorias y procedimientos remotos, consultar el [runbook de Supabase](./docs/supabase/README.md) y el [diagrama del schema](./docs/supabase/schema-diagram.md).

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
- `SUPABASE_DB_URL` para builds y validaciones que leen contenido de Supabase
- `SUPABASE_AUDIT_DB_URL` para auditorias locales privilegiadas

### Instalacion y servidor

```bash
npm install
npm run dev
```

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

### Variables de entorno

Usar [.env.example](./.env.example) como referencia y guardar valores locales en `.env.local`, que esta ignorado por Git.

```bash
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_URL=
SUPABASE_AUDIT_DB_URL=
```

Las variables `PUBLIC_*` son intencionalmente visibles para el cliente. `SUPABASE_DB_URL` y `SUPABASE_AUDIT_DB_URL` son privadas y no deben llevar ese prefijo. La primera usa el rol de lectura minimo para build; la segunda se reserva para auditorias locales. Los tokens del CLI y los secretos de `publish-menu-changes` se configuran por separado; sus nombres y procedimiento estan documentados en el [runbook de Supabase](./docs/supabase/README.md#variables).

## Scripts npm

### Aplicacion y checks locales

| Script | Uso |
| --- | --- |
| `npm run dev` | Levanta Astro en desarrollo. |
| `npm run build` | Genera `dist/` con contenido leido de `menu_content`. Requiere `SUPABASE_DB_URL` y las dos variables `PUBLIC_SUPABASE_*`. |
| `npm run preview` | Sirve el build local. |
| `npm run check` | Ejecuta `astro check`. |
| `npm run check:js` | Valida sintaxis de JS/MJS fuera del typecheck de Astro. |
| `npm run lint` | Ejecuta ESLint. |
| `npm run test:admin` | Prueba reglas, render y operaciones del admin. |
| `npm run test:menu` | Prueba el overlay publico de disponibilidad. |
| `npm run test:tools` | Prueba los guardas de entorno, secretos y exposicion del Data API. |
| `npm run menu:validate` | Valida contenido y hardening esperado en Supabase. Requiere `SUPABASE_DB_URL`. |
| `npm run verify:dist-secrets` | Revisa un `dist/` ya generado en busca de marcadores de secretos. |
| `npm run supabase:audit` | Ejecuta auditorias SQL y probes read-only del Data API. Requiere `SUPABASE_AUDIT_DB_URL` y las dos variables `PUBLIC_SUPABASE_*`. |

### Imagenes fuente del menu

Los originales viven fuera del repositorio. `node scripts/optimize-menu-images.mjs <source-images-dir>` procesa la carpeta `pending/`, escribe los WebP versionados en `public/uploads/menu/` y mueve los originales procesados a `used/`. Sin argumento, conserva `assets/source-images/menu/` como staging local compatible.

La ruta absoluta de la biblioteca local se registra en `docs/project-context.local.md`, que permanece fuera de Git.

### Supabase CLI

| Script | Uso |
| --- | --- |
| `npm run supabase -- <args>` | Ejecuta el CLI fijado por el proyecto. |
| `npm run supabase:link` | Vincula el checkout con un proyecto remoto. |
| `npm run supabase:migrations` | Lista migraciones locales y remotas. |
| `npm run supabase:functions:deploy` | Despliega remotamente solo `publish-menu-changes`. |

Los comandos que vinculan, mutan o despliegan recursos remotos son procedimientos operativos, no checks locales. El [runbook de Supabase](./docs/supabase/README.md) indica sus precondiciones y efectos.

## Validacion

Para cambios de aplicacion, seleccionar los checks segun la superficie:

```bash
npm run test:admin
npm run test:menu
npm run test:tools
npm run check:js
npm run lint
npm run check
```

Cuando el cambio requiere construir con contenido real, ejecutar el build antes del escaneo de secretos:

```bash
npm run build
npm run verify:dist-secrets
```

Los cambios de schema, permisos o contenido build-time siguen la secuencia read-only y los procedimientos remotos del [runbook de Supabase](./docs/supabase/README.md#validacion-local-y-read-only).

## Mapa del repositorio

| Ruta | Responsabilidad |
| --- | --- |
| `src/pages/` | Rutas Astro publicas y admin. |
| `src/components/` y `src/menu/` | Presentacion y reglas del menu. |
| `src/admin/` | Cliente TypeScript del CMS operativo. |
| `src/utils/` | Lectura, transformacion y snapshot de contenido. |
| `public/` | Assets, uploads y scripts cliente. |
| `scripts/` | Builds auxiliares, validadores, auditorias y tests Node. |
| `supabase/migrations/` | Migraciones canonicas. |
| `supabase/functions/` | Edge Function de publicacion y codigo compartido. |
| `docs/supabase/` | Runbook, diagrama y auditorias SQL read-only. |

`dist/`, `.astro/` y `node_modules/` son generados y no forman parte de la fuente.

## Documentacion

- [Supabase local-first workflow](./docs/supabase/README.md): baseline, auditorias, variables, CLI y operaciones remotas.
- [Supabase schema diagram](./docs/supabase/schema-diagram.md): modelo estructural, runtime, permisos y publicacion.
- [AGENTS.md](./AGENTS.md): invariantes y limites para agentes que modifican el repositorio.

## Despliegue

El deploy de la aplicacion es estatico en Vercel. No hay adapter de servidor, SSR, API routes ni Vercel Functions. La unica funcion server-side del sistema es la Edge Function Supabase `publish-menu-changes`, dedicada a solicitar el rebuild del contenido operativo.

El dominio canonico y unico origen operativo del admin es `https://elfaraoncatering.com.ar`. La configuracion remota de Supabase Auth y el secreto `PUBLISH_ALLOWED_ORIGINS` deben mantenerse alineados con `supabase/config.toml` y `.env.example`.
