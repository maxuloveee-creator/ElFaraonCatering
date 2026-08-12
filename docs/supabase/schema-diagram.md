# Supabase database map

Este mapa documenta el modelo activo del menu QR. Supabase se usa como fuente estructural y operativa build-time; la unica superficie runtime sin rebuild es el overlay de disponibilidad.

Las columnas `available` dentro de `menu_content` son compatibilidad interna y deben permanecer en `true`. La disponibilidad operativa real se modela solo como excepcion runtime en `public.menu_availability_overlays`.

Fuentes versionadas:

- `../../supabase/migrations/`: baseline prelanzamiento canonico de handoff y migraciones posteriores.
- `audits/menu-schema-audit.sql`: auditoria read-only del modelo activo.
- `audits/database-audit.sql`: inventario amplio de objetos, exposicion y hallazgos.

Ver `README.md` en esta carpeta para las reglas del baseline y cambios posteriores.

## Mapa de schemas

```mermaid
flowchart TD
  DB[(Supabase Postgres)]

  DB --> MC["menu_content<br/>estructura y operacion build-time"]
  DB --> PUB["public<br/>overlay runtime, staff y RPCs"]
  DB --> PRIV["app_private<br/>auditoria, revisiones inmutables e implementaciones definer"]
  DB --> AUTH["auth<br/>Supabase-managed"]

  MC -->|"captura transaccional"| PRIV
  PRIV -->|"target + snapshot exactos"| BUILD["Astro build<br/>SUPABASE_DB_URL"]
  BUILD --> STATIC["HTML/JS estatico<br/>/menu/corpo y /menu/teleinde"]
  PUB --> MENU_CLIENT["Cliente menu<br/>solo disponibilidad"]
  PUB --> ADMIN_CLIENT["/admin/ estatico<br/>RPCs operativas"]
  AUTH -. "staff autenticado" .-> PUB
  PUB -. "publish-menu-changes" .-> PRIV

  classDef structural fill:#eef6ff,stroke:#1f4f82,color:#102a43;
  classDef runtime fill:#f3f8ee,stroke:#446b2f,color:#223815;
  classDef private fill:#fff4e5,stroke:#8a5a13,color:#3f2c09;
  classDef platform fill:#f6f6f6,stroke:#777,color:#333;

  class MC,BUILD,STATIC structural;
  class PUB,MENU_CLIENT,ADMIN_CLIENT runtime;
  class PRIV private;
  class AUTH platform;
```

## ERD resumido: `menu_content`

El ERD muestra las tablas y columnas de dominio mas relevantes. La migracion baseline sigue siendo la referencia exacta de constraints, defaults y checks.

```mermaid
erDiagram
  MENU_PROFILES {
    text id PK
    text eyebrow
    text title
    text description
    text info_title
  }

  MENU_PROFILE_FACTS {
    text profile_id PK,FK
    text fact_id PK
    text label
    text value
    text link_text
    text link_href
    int order_index
  }

  MENU_PRICES {
    text pricing_key PK
    text kind
    int amount
  }

  MENU_PRICE_VARIANTS {
    text pricing_key PK,FK
    text variant_id PK
    text name
    int amount
    bool available
    int order_index
  }

  MENU_DAILY_ITEMS {
    bigint id PK
    text item_id
    text name
    text description
    bool available
    text pricing_key FK
    int order_index
  }

  MENU_PROFILE_SERVICE_SETTINGS {
    text profile_id PK,FK
    text service_kind
  }

  MENU_CATALOG_SECTIONS {
    bigint id PK
    text section_id
    text title
    text description
    text presentation
    int order_index
  }

  MENU_CATALOG_ITEMS {
    bigint id PK
    text section_id FK
    text item_id
    text name
    text description
    bool available
    text pricing_key FK
    int order_index
  }

  MENU_CATALOG_ITEM_OPTIONS {
    bigint catalog_item_id PK,FK
    text option_id PK
    text name
    bool available
    int order_index
  }

  MENU_CATALOG_ITEM_IMAGES {
    bigint id PK
    bigint catalog_item_id FK
    text image_path
    int order_index
  }

  MENU_GRILL_FAMILIES {
    text family_id PK
    text title
    int order_index
  }

  MENU_GRILL_CATALOG_ITEMS {
    bigint id PK
    text family_id FK
    text item_id
    text name
    text variant_name
    bool available
    text pricing_key FK
    int order_index
  }

  MENU_PROFILES ||--o{ MENU_PROFILE_FACTS : physical
  MENU_PROFILES ||--|| MENU_PROFILE_SERVICE_SETTINGS : physical

  MENU_PRICES ||--o{ MENU_PRICE_VARIANTS : physical
  MENU_PRICES ||--o{ MENU_DAILY_ITEMS : physical
  MENU_PRICES ||--o{ MENU_CATALOG_ITEMS : physical
  MENU_PRICES ||--o{ MENU_GRILL_CATALOG_ITEMS : physical

  MENU_CATALOG_SECTIONS ||--o{ MENU_CATALOG_ITEMS : physical
  MENU_CATALOG_ITEMS ||--o{ MENU_CATALOG_ITEM_IMAGES : physical
  MENU_CATALOG_ITEMS ||--o{ MENU_CATALOG_ITEM_OPTIONS : physical

  MENU_GRILL_FAMILIES ||--o{ MENU_GRILL_CATALOG_ITEMS : physical
```

## Runtime operativo

```mermaid
flowchart LR
  AUTH_USERS["auth.users<br/>Supabase-managed"]
  STAFF["public.staff_users<br/>roles operativos"]
  OVERLAYS["public.menu_availability_overlays<br/>disponibilidad runtime"]
  READ_RPC["get_admin_operational_state()<br/>lectura admin"]
  WRITE_RPCS["RPCs operativas<br/>edicion controlada"]
  EDGE["Supabase Edge Function<br/>publish-menu-changes"]
  REVISIONS["menu_publication_revisions<br/>snapshots JSONB inmutables"]
  REVISION_EVENTS["menu_publication_revision_events<br/>cambios incluidos exactamente"]
  REQUESTS["menu_publish_requests + state<br/>queued / triggered / succeeded / failed"]
  BUILDS["menu_publication_builds<br/>deployment -> revision"]
  PROMOTIONS["menu_publication_promotions<br/>evidencia append-only"]
  VERCEL["Vercel<br/>Deploy Hook + webhook opcional"]
  BUILD["Astro build estatico<br/>revision exacta"]
  ADMIN_UI["/admin/ estatico<br/>CMS operativo de menu"]
  STATIC["HTML estatico<br/>data-menu-id / data-section-id / data-item-id"]

  AUTH_USERS -->|"FK fisica: user_id"| STAFF
  AUTH_USERS -->|"FK fisica: updated_by"| OVERLAYS
  STAFF -. "RLS helper: can_edit_availability" .-> OVERLAYS
  STAFF -. "helpers de permisos" .-> READ_RPC
  STAFF -. "helpers de permisos" .-> WRITE_RPCS
  STAFF -. "can_publish_menu" .-> EDGE
  ADMIN_UI -->|"leer estado"| READ_RPC
  ADMIN_UI -->|"acciones del admin"| WRITE_RPCS
  READ_RPC -->|"estado operativo filtrado"| ADMIN_UI
  WRITE_RPCS -->|"writes controlados"| OVERLAYS
  WRITE_RPCS -->|"writes build-time"| MENU_CONTENT["menu_content"]
  WRITE_RPCS -->|"change events build-time"| REQUESTS
  EDGE -->|"reserva snapshot"| REVISIONS
  REQUESTS -->|"captura membresia"| REVISION_EVENTS
  EDGE -->|"queued -> triggered"| REQUESTS
  EDGE -->|"POST server-side"| VERCEL
  REQUESTS -->|"target activo"| BUILD
  REVISIONS -->|"snapshot por UUID"| BUILD
  BUILD -->|"registra deployment"| BUILDS
  BUILD -->|"artefacto estatico"| VERCEL
  VERCEL -->|"webhook firmado"| EDGE
  ADMIN_UI -->|"POST /status"| EDGE
  EDGE -->|"probe admin canonico"| VERCEL
  EDGE -->|"verifica deployment del webhook"| VERCEL
  EDGE -->|"evidencia verificada"| PROMOTIONS
  PROMOTIONS -->|"event time mas nuevo"| REQUESTS
  OVERLAYS -. "IDs logicos" .-> STATIC

  classDef runtime fill:#f3f8ee,stroke:#446b2f,color:#223815;
  classDef structural fill:#eef6ff,stroke:#1f4f82,color:#102a43;
  classDef private fill:#fff4e5,stroke:#8a5a13,color:#3f2c09;
  classDef platform fill:#f6f6f6,stroke:#777,color:#333;

  class STAFF,OVERLAYS,READ_RPC,WRITE_RPCS,EDGE,ADMIN_UI runtime;
  class STATIC,MENU_CONTENT,BUILD structural;
  class REVISIONS,REVISION_EVENTS,REQUESTS,BUILDS,PROMOTIONS private;
  class AUTH_USERS,VERCEL platform;
```

## Frontera build-time/runtime

- `menu_content` es la fuente editable build-time. Al solicitar publicacion se captura una revision JSONB inmutable; un build de publicacion lee esa revision, no las tablas vivas.
- Menu del dia, descripcion, servicio activo por local, catalogo, secciones, imagenes y precios son datos build-time.
- Las columnas build-time `available` no representan faltantes operativos; se conservan siempre `true` por compatibilidad.
- `menu_daily_items` modela dos opciones planas: comun y vegetariano.
- `menu_catalog_item_images` es la unica fuente de imagenes: el orden cero es la imagen principal de cada item del catalogo fijo.
- Menu diario y parrilla no soportan imagenes.
- `/admin/` funciona como CMS operativo de contenido de menu: cubre disponibilidad, servicio activo, menu del dia, productos de parrilla y sus opciones, contenido de menu fijo, opciones de items que ya usan opciones, precios y publicacion.
- `/admin/` puede editar datos operativos build-time, pero esos cambios requieren rebuild/deploy para impactar el menu publico.
- La edicion de menu fijo desde `/admin/` cubre altas, bajas y cambios de nombre/descripcion de items puntuales dentro de secciones existentes, y altas, bajas o cambios de opciones de items que ya usan opciones; no abre CMS editorial general ni edicion libre de secciones, IDs u orden.
- `public.menu_availability_overlays` es el unico dato editable en runtime sin rebuild.
- La ausencia de overlay equivale a disponible; marcar disponible en admin debe limpiar el overlay.
- Los items con opciones exponen target padre y targets de opcion; las opciones usan IDs compuestos `item-id-option-id` como `item_id` del overlay.
- `public.staff_users` define roles operativos (`operator`, `admin`); `operator` puede editar todos los perfiles y publicar.
- `staff_users.default_availability_profile_id` solo preselecciona el filtro de disponibilidad de `/admin/`; no restringe permisos por local.
- Las escrituras del admin deben pasar por RPCs operativas con respuesta `ok`, `changed`, `requires_redeploy`, `operation` y `message`.
- Las RPCs publicas del admin son wrappers `security invoker`; las implementaciones privilegiadas viven en `app_private`, que no debe exponerse por PostgREST.
- `publish-menu-changes` es la unica frontera server-side de publicacion: valida Auth, reserva la revision, llama el Deploy Hook y recibe el webhook firmado en `/vercel-webhook`.
- Solo puede existir una solicitud activa (`queued` o `triggered`). Un `2xx` del hook significa `triggered`, no exito.
- `app_private.menu_publication_builds` fija cada `VERCEL_DEPLOYMENT_ID` a una solicitud opcional, revision, hash y proyecto.
- Mientras una publicacion esta activa, el polling del admin llama `POST /status`; tambien lo hace al iniciar sesion o recuperar foco, con throttle de un minuto. La misma Function verifica el `/admin/` canonico y registra promociones o rollbacks sin exigir Account Webhooks. El webhook `deployment.promoted` firmado acelera promociones en planes compatibles, pero Vercel no lo emite para rollbacks.
- `app_private.menu_publication_promotions` conserva evidencia append-only con fuente e ID de evidencia. `request_id` puede ser nulo para re-promociones o rollbacks, y el puntero desplegado sigue la evidencia mas reciente por `event_created_at`.
- Las RPCs build-time registran eventos privados en `app_private.menu_change_events`; `menu_publication_revision_events` captura exactamente cuales pertenecen al snapshot. Solo esos eventos se enlazan al confirmar la promocion correcta. La disponibilidad runtime no participa de ese log de deploy.
- El estado `publication` expone una fase server-side (`up_to_date`, `changes_pending`, `publishing` o `failed`), el vencimiento de la solicitud activa y si hubo ediciones posteriores al snapshot. El browser consulta con alta frecuencia al inicio y luego baja a una vez por minuto hasta observar un estado terminal; pausa cuando la pestaña no esta visible y no usa storage ni cooldown como verdad.
- `public.editor_profiles` fue eliminada luego del backfill inicial; `staff_users` es la unica fuente de permisos operativos.
- El cliente no debe consultar estructura, precios, menu del dia, servicio activo, catalogo, secciones, imagenes ni textos estructurales.
