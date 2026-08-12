# Guía del panel operativo

Esta guía explica el uso diario de `/admin/`. El panel permite preparar el servicio, controlar la disponibilidad, editar los menús habilitados y publicar los cambios que lo requieren.

Las pantallas y acciones disponibles dependen de los permisos de la cuenta. Si una sección o acción no aparece, no intentes reemplazarla con accesos directos: avisale a quien administra el sitio.

## Antes de empezar

El panel maneja dos tipos de cambios:

| Cambio | Cuándo llega al menú público |
| --- | --- |
| Ocultar o volver a mostrar un ítem desde `Disponibilidad` | Al instante; no requiere publicación |
| Cambiar el servicio activo de un local | Después de publicar |
| Editar el menú del día o la parrilla | Después de publicar |
| Editar el menú fijo, sus opciones o sus precios | Después de publicar |
| Cambiar la contraseña de la cuenta | Al guardar; no afecta el menú |

Guardá cada formulario antes de cambiar de sección o publicar. Si aparece el aviso `Hay cambios sin guardar en otro formulario`, elegí cancelar y guardá ese formulario si querés conservar lo escrito. Un campo modificado pero todavía no guardado no forma parte de la publicación.

## Acceso y cuenta

### Iniciar y cerrar sesión

1. Abrí `/admin/`.
2. Completá `Email` y `Contraseña`.
3. Seleccioná `Iniciar sesión`.
4. Al terminar, seleccioná `Salir` en el encabezado del panel.

Si la sesión venció, el panel solicita volver a iniciar sesión. Si aparece `Sin acceso`, podés seleccionar `Reintentar`; si el mensaje persiste, salí y avisale a quien administra el sitio.

### Recuperar el acceso

1. En la pantalla `Ingresar`, seleccioná `Olvidé mi contraseña`.
2. Completá el email en `Recuperar acceso`.
3. Seleccioná `Enviar link`.
4. Abrí el enlace recibido por email. El enlace vuelve a `/admin/` y muestra `Nueva contraseña`.
5. Completá `Nueva contraseña` y `Confirmar contraseña`, y seleccioná `Guardar contraseña`.

El panel exige un mínimo de 8 caracteres y que ambos campos coincidan. El servicio de acceso puede aplicar requisitos adicionales. Si el enlace ya no funciona, pedí uno nuevo desde `Olvidé mi contraseña`.

### Cambiar la contraseña con una sesión abierta

1. Abrí la pestaña `Cuenta`.
2. Completá `Nueva contraseña` y `Confirmar contraseña`.
3. Seleccioná `Guardar contraseña`.

La confirmación correcta es `Contraseña actualizada.`.

## Disponibilidad: cambios instantáneos

La pestaña `Disponibilidad` sirve para ocultar temporalmente o volver a mostrar ítems del servicio activo y del menú fijo. Estos cambios se aplican al menú público en el momento y quedan fuera del proceso de publicación.

1. Elegí el `Local`.
2. Usá `Familia / grupo` para reducir la lista.
3. Revisá el estado: `Se muestra en el menú` u `Oculto en el menú`.
4. Seleccioná `Ocultar ahora` o `Volver a mostrar`.

La sección `Items ocultos` resume lo que está fuera de cada menú. Desde allí, `Mostrar` vuelve a habilitar el ítem. Cuando aparezca `Quitar ajuste`, esa acción elimina el ajuste temporal y recupera el estado base.

Tené en cuenta estas reglas:

- En parrilla, la disponibilidad se administra por producto completo; el cambio alcanza a todas sus opciones.
- En ítems del menú fijo con sabores u opciones, el panel mantiene coherente la disponibilidad del ítem principal y sus opciones.
- El mensaje `Disponibilidad actualizada. Ya se ve en el menú público.` confirma un cambio efectivo. `Sin cambios.` indica que el estado solicitado ya estaba aplicado.
- No selecciones `Publicar cambios` por una modificación hecha únicamente en `Disponibilidad`.

Verificá el resultado en el menú del local correspondiente: `/menu/corpo/` o `/menu/teleinde/`.

## Servicio

La pestaña `Servicio` contiene hasta tres pantallas: `Servicio activo`, `Menú del día` y `Parrilla`. Las últimas dos aparecen cuando ese servicio está activo al menos en un local.

### Servicio activo

En `Servicio activo`, cada local permite elegir `Menú del día` o `Parrilla`.

1. Elegí el servicio correspondiente al local.
2. Seleccioná `Guardar`.
3. Publicá los cambios para actualizar el menú público.

La selección decide qué servicio operativo muestra ese local. No modifica el `Menú fijo`, que permanece como catálogo separado y compartido.

### Menú del día

En `Menú del día`:

1. Editá `Menu regular` y `Menu vegetariano`, tal como aparecen en pantalla.
2. Completá el nombre y, si corresponde, la descripción de ambos platos.
3. Seleccioná `Guardar menú del día`.
4. Modificá los importes necesarios en `Precios` y seleccioná `Guardar` en cada fila.
5. Publicá los cambios.

Los platos y precios son globales: no se mantienen versiones distintas por local.

### Parrilla

En `Parrilla` podés:

- crear un producto mediante `Agregar producto de parrilla`, indicando su primera opción y precio;
- renombrarlo con `Guardar producto`;
- agregar opciones con `Agregar opción`;
- editar el nombre y el importe de una opción con `Guardar`;
- eliminar una opción con `Eliminar`;
- eliminar el producto completo y todas sus opciones con `Eliminar producto`.

Cada producto debe conservar al menos una opción. Cuando queda una sola, `Eliminar` se deshabilita; para retirar todo el conjunto se debe usar `Eliminar producto`. Todos estos cambios requieren publicación.

## Menú fijo y precios

La pestaña `Menú fijo` administra el catálogo estable compartido.

1. Elegí una `Sección`.
2. Usá `Agregar item nuevo` cuando el formulario esté disponible.
3. Para editar un ítem, modificá `Nombre`, `Descripción` y los precios habilitados, y seleccioná `Guardar`.
4. En ítems con opciones, usá `Agregar sabor`, `Guardar opción` o `Eliminar sabor`.
5. Publicá los cambios guardados.

Algunas ubicaciones, como `Tartas`, `Tortillas`, `Omelettes` y `Empanadas`, permiten administrar sabores u opciones, pero no crear, editar ni eliminar sus ítems principales desde esta pantalla. Las secciones, el orden y los identificadores técnicos tampoco se administran desde el panel.

Los precios son globales. Un importe puede ser compartido por más de una presentación o local. Ingresá números sin símbolo de peso y revisá todas las etiquetas antes de guardar. Los acompañamientos incluidos no ofrecen edición de precio, salvo el ítem independiente configurado para venderse por separado.

## Eliminaciones y cambios sin guardar

Las eliminaciones editoriales piden confirmación antes de ejecutarse:

- `Eliminar producto` también elimina todas sus opciones de parrilla.
- `Eliminar` en parrilla elimina una opción.
- `Eliminar` en el menú fijo elimina el ítem.
- `Eliminar sabor` elimina una opción del ítem.

Si el ítem del menú fijo tiene una foto asociada, la confirmación lo advierte. El panel no elimina ni administra el archivo de imagen. Ninguna eliminación editorial llega al menú público hasta publicar.

El panel impide eliminar el último ítem de una ubicación o la última opción de un conjunto cuando ese contenido debe conservar al menos uno.

## Publicar cambios

Los cambios de servicio, contenido y precios quedan guardados como cambios pendientes. Al publicar, la base captura una revisión inmutable con todo lo guardado hasta ese momento. Para llevarla al menú público:

1. Confirmá que no quede ningún formulario con campos sin guardar.
2. Revisá el aviso de publicación en la parte superior.
3. Seleccioná `Publicar cambios`.
4. Aceptá la confirmación `Vas a publicar todos los cambios guardados. El menú se actualizará automáticamente cuando termine. ¿Continuar?`.
5. Esperá a que el panel confirme el resultado. No hace falta recargar ni ejecutar una publicación adicional mientras siga en curso.

El panel comprueba automáticamente que la revisión publicada sea la que está sirviendo el sitio. Los estados técnicos se expresan así en la interfaz:

| Estado | Texto visible y acción |
| --- | --- |
| `up_to_date` | No muestra aviso pendiente. Al completar una publicación aparece `Menú publicado correctamente.` |
| `changes_pending` | `Hay cambios guardados sin publicar.` y `Todavía no se ven en el menú.`, con `Publicar cambios` |
| `publishing` | `Publicando cambios…` y `Podés seguir trabajando.`; no ofrece otra acción de publicación |
| `publishing` con cambios nuevos | `Publicando los cambios anteriores…` y `Tus cambios nuevos quedaron guardados para la próxima publicación.` |
| `failed` con reintento habilitado | `No se pudo publicar.` y `Tus cambios siguen guardados.`, con `Reintentar` |
| `failed` sin reintento habilitado | Muestra el error y conserva los cambios, pero no ofrece `Reintentar`; requiere escalamiento |

### Editar mientras se publica

Podés seguir trabajando mientras aparece `Publicando cambios…`. La publicación en curso contiene una revisión inmutable: cualquier cambio guardado después queda pendiente para una publicación nueva. Cuando termine la primera, el panel mostrará `Menú publicado correctamente. Hay cambios nuevos pendientes.` y volverá a ofrecer `Publicar cambios`.

### Publicación demorada o fallida

- Si aparece `La publicación está tardando más de lo esperado. Tus cambios siguen guardados.`, esperá el cambio de estado; no inicies publicaciones repetidas.
- Si el panel informa que no pudo actualizar el estado, los cambios continúan guardados. Revisá la conexión y dejá que el panel vuelva a consultar.
- Si aparece `Reintentar`, usalo una sola vez y esperá el resultado automático.
- Si no aparece `Reintentar`, si el estado no cambia o si el menú público no coincide después de una confirmación de éxito, avisale a quien administra el sitio.

## Errores y escalamiento

Ante un error:

1. Leé el mensaje completo y no repitas inmediatamente la acción.
2. Si dice que algunos cambios pueden haberse guardado, volvé a revisar el ítem antes de reintentar.
3. Si es un problema de conexión, comprobá la red y repetí la acción una vez.
4. Si persiste, informá la fecha y hora, la ruta, la acción realizada, el mensaje exacto y el local afectado.

No compartas contraseñas, enlaces de recuperación ni datos de sesión. Si adjuntás una captura, ocultá el email y el nombre de la cuenta.

## Fuera del alcance del panel

El panel no permite:

- crear, invitar, activar, desactivar ni cambiar el rol de cuentas del personal;
- gestionar permisos o el local predeterminado de una cuenta;
- cargar, reemplazar ni eliminar imágenes;
- crear, renombrar, ordenar o eliminar secciones;
- cambiar el orden o los identificadores técnicos de productos y opciones;
- editar el sitio institucional de `/`;
- administrar dominios, despliegues, variables de entorno, copias de seguridad o infraestructura.

Estas operaciones corresponden a la administración técnica del sitio y no deben intentarse desde herramientas o accesos alternativos.
