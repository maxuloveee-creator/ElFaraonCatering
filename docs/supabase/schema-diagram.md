# Mapa de la base Supabase

Este mapa documenta el modelo activo del menú QR. Supabase se usa como fuente estructural y operativa build-time; la única superficie runtime sin rebuild es el overlay de disponibilidad.

Las columnas `available` dentro de `menu_content` son compatibilidad interna y deben permanecer en `true`. La disponibilidad operativa real se modela solo como excepción runtime en `public.menu_availability_overlays`.

Fuentes versionadas:

- `../../supabase/migrations/`: baseline prelanzamiento canónico y migraciones posteriores.
- `audits/menu-schema-audit.sql`: auditoría read-only del modelo activo.
- `audits/database-audit.sql`: inventario amplio de objetos, exposición y hallazgos.

Ver `README.md` en esta carpeta para las reglas del baseline y cambios posteriores.

## Mapa de schemas

```mermaid
flowchart TD
  DB[(Supabase Postgres)]

  DB --> MC["menu_content<br/>estructura y operación build-time"]
  DB --> PUB["public<br/>overlay runtime, staff y RPCs"]
  DB --> PRIV["app_private<br/>auditoría, revisiones inmutables e implementaciones definer"]
  DB --> AUTH["auth<br/>Supabase-managed"]

  MC -->|"captura transaccional"| PRIV
  PRIV -->|"target + snapshot exactos"| BUILD["Astro build<br/>SUPABASE_DB_URL"]
  BUILD --> STATIC["HTML/JS estático<br/>/menu/corpo y /menu/teleinde"]
  PUB --> MENU_CLIENT["Cliente menú<br/>solo disponibilidad"]
  PUB --> ADMIN_CLIENT["/admin/ estático<br/>RPCs operativas"]
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

El ERD muestra las tablas y columnas de dominio más relevantes. La migración baseline sigue siendo la referencia exacta de constraints, defaults y checks.

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
  WRITE_RPCS["RPCs operativas<br/>edición controlada"]
  EDGE["Supabase Edge Function<br/>publish-menu-changes"]
  RESERVE_RPC["reserve_menu_publish_request()<br/>transacción atómica"]
  TRANSITION_RPCS["start / fail / confirm<br/>RPCs service-role"]
  CHANGE_EVENTS["menu_change_events<br/>cambios build-time"]
  REVISIONS["menu_publication_revisions<br/>snapshots JSONB inmutables"]
  REVISION_EVENTS["menu_publication_revision_events<br/>membresía exacta de la revisión"]
  REQUESTS["menu_publish_requests + state<br/>queued / triggered / succeeded / failed"]
  BUILDS["menu_publication_builds<br/>deployment -> revisión"]
  PROMOTIONS["menu_publication_promotions<br/>evidencia append-only"]
  VERCEL["Vercel<br/>Deploy Hook + webhook opcional"]
  BUILD["Astro build estático<br/>revisión exacta"]
  ADMIN_UI["/admin/ estático<br/>CMS operativo de menú"]
  STATIC["HTML estático<br/>data-menu-id / data-section-id / data-item-id"]

  AUTH_USERS -->|"FK física: user_id"| STAFF
  AUTH_USERS -->|"FK física: updated_by"| OVERLAYS
  STAFF -. "RLS helper: can_edit_availability" .-> OVERLAYS
  STAFF -. "helpers de permisos" .-> READ_RPC
  STAFF -. "helpers de permisos" .-> WRITE_RPCS
  STAFF -. "can_publish_menu" .-> EDGE
  ADMIN_UI -->|"leer estado"| READ_RPC
  ADMIN_UI -->|"acciones del admin"| WRITE_RPCS
  READ_RPC -->|"estado operativo filtrado"| ADMIN_UI
  WRITE_RPCS -->|"writes controlados"| OVERLAYS
  WRITE_RPCS -->|"writes build-time"| MENU_CONTENT["menu_content"]
  WRITE_RPCS -->|"registra cambio"| CHANGE_EVENTS
  EDGE -->|"RPC service-role"| RESERVE_RPC
  EDGE -->|"RPCs service-role"| TRANSITION_RPCS
  RESERVE_RPC -->|"reserva snapshot"| REVISIONS
  RESERVE_RPC -->|"captura IDs visibles"| REVISION_EVENTS
  REVISIONS -->|"FK: revision_id"| REVISION_EVENTS
  CHANGE_EVENTS -->|"FK: change_event_id"| REVISION_EVENTS
  RESERVE_RPC -->|"crea queued"| REQUESTS
  TRANSITION_RPCS -->|"triggered / failed / succeeded"| REQUESTS
  REQUESTS -->|"FK: revision_id"| REVISIONS
  EDGE -->|"POST server-side"| VERCEL
  REQUESTS -->|"target activo"| BUILD
  REVISIONS -->|"snapshot por UUID"| BUILD
  BUILD -->|"registra deployment"| BUILDS
  BUILD -->|"artefacto estático"| VERCEL
  VERCEL -->|"webhook firmado"| EDGE
  ADMIN_UI -->|"POST /status"| EDGE
  EDGE -->|"probe admin canónico"| VERCEL
  EDGE -->|"verifica deployment del webhook"| VERCEL
  TRANSITION_RPCS -->|"evidencia verificada"| PROMOTIONS
  PROMOTIONS -->|"event_created_at más nuevo"| REQUESTS
  PROMOTIONS -->|"vincula solo miembros confirmados"| CHANGE_EVENTS
  OVERLAYS -. "IDs lógicos" .-> STATIC

  classDef runtime fill:#f3f8ee,stroke:#446b2f,color:#223815;
  classDef structural fill:#eef6ff,stroke:#1f4f82,color:#102a43;
  classDef private fill:#fff4e5,stroke:#8a5a13,color:#3f2c09;
  classDef platform fill:#f6f6f6,stroke:#777,color:#333;

  class STAFF,OVERLAYS,READ_RPC,WRITE_RPCS,EDGE,RESERVE_RPC,TRANSITION_RPCS,ADMIN_UI runtime;
  class STATIC,MENU_CONTENT,BUILD structural;
  class CHANGE_EVENTS,REVISIONS,REVISION_EVENTS,REQUESTS,BUILDS,PROMOTIONS private;
  class AUTH_USERS,VERCEL platform;
```

## Frontera build-time/runtime

- `menu_content` es la fuente editable build-time. Al solicitar publicación se captura una revisión JSONB inmutable; un build de publicación lee esa revisión, no las tablas vivas.
- Menú del día, descripción, servicio activo por local, catálogo, secciones, imágenes y precios son datos build-time.
- Las columnas build-time `available` no representan faltantes operativos; se conservan siempre `true` por compatibilidad.
- `menu_daily_items` modela dos opciones planas: común y vegetariano.
- `menu_catalog_item_images` es la única fuente de imágenes: el orden cero es la imagen principal de cada ítem del catálogo fijo.
- Menú diario y parrilla no soportan imágenes.
- `/admin/` funciona como CMS operativo de contenido de menú: cubre disponibilidad, servicio activo, menú del día, productos de parrilla y sus opciones, contenido de menú fijo, opciones de ítems que ya usan opciones, precios y publicación.
- `/admin/` puede editar datos operativos build-time, pero esos cambios requieren rebuild/deploy para impactar el menú público.
- La edición de menú fijo desde `/admin/` cubre altas, bajas y cambios de nombre/descripción de ítems puntuales dentro de secciones existentes, y altas, bajas o cambios de opciones de ítems que ya usan opciones; no abre CMS editorial general ni edición libre de secciones, IDs u orden.
- `public.menu_availability_overlays` es el único dato editable en runtime sin rebuild.
- La ausencia de overlay equivale a disponible; marcar disponible en admin debe limpiar el overlay.
- Los ítems con opciones exponen target padre y targets de opción; las opciones usan IDs compuestos `item-id-option-id` como `item_id` del overlay.
- `public.staff_users` define roles operativos (`operator`, `admin`); `operator` puede editar todos los perfiles y publicar.
- `staff_users.default_availability_profile_id` solo preselecciona el filtro de disponibilidad de `/admin/`; no restringe permisos por local.
- Las escrituras del admin deben pasar por RPCs operativas con respuesta `ok`, `changed`, `requires_redeploy`, `operation` y `message`.
- Las RPCs públicas del admin son wrappers `security invoker`; las implementaciones privilegiadas viven en `app_private`, que no debe exponerse por PostgREST.
- `publish-menu-changes` es la única frontera server-side de publicación: valida Auth, reserva la revisión, llama el Deploy Hook y recibe el webhook firmado en `/vercel-webhook`.
- Solo puede existir una solicitud activa (`queued` o `triggered`). Un `2xx` del hook significa `triggered`, no éxito.
- `app_private.menu_publication_builds` fija cada `VERCEL_DEPLOYMENT_ID` a una solicitud opcional, revisión, hash y proyecto.
- Mientras una publicación está activa, el polling del admin llama `POST /status`; también lo hace al iniciar sesión o recuperar foco, con throttle de un minuto. La misma Function verifica el `/admin/` canónico y registra promociones o rollbacks sin exigir Account Webhooks. El webhook `deployment.promoted` firmado acelera promociones en planes compatibles, pero Vercel no lo emite para rollbacks.
- `app_private.menu_publication_promotions` conserva evidencia append-only con fuente e ID de evidencia. `request_id` puede ser nulo para re-promociones o rollbacks, y el puntero desplegado sigue la evidencia más reciente por `event_created_at`.
- Las RPCs build-time registran eventos privados en `app_private.menu_change_events`; `menu_publication_revision_events` captura exactamente cuáles pertenecen al snapshot. Solo esos eventos se enlazan al confirmar la promoción correcta. La disponibilidad runtime no participa de ese log de deploy.
- El estado `publication` expone una fase server-side (`up_to_date`, `changes_pending`, `publishing` o `failed`), el vencimiento de la solicitud activa y si hubo ediciones posteriores al snapshot. El browser consulta con alta frecuencia al inicio y luego baja a una vez por minuto hasta observar un estado terminal; pausa cuando la pestaña no está visible y no usa storage ni cooldown como verdad.
- `public.editor_profiles` fue eliminada luego del backfill inicial; `staff_users` es la única fuente de permisos operativos.
- El cliente no debe consultar estructura, precios, menú del día, servicio activo, catálogo, secciones, imágenes ni textos estructurales.
