# Espazios — Agente de ventas IA para WhatsApp

Este repositorio implementa el agente conversacional de WhatsApp para Espazios
(remodelacion de hogar y carpinteria a medida, Colombia). El diseno completo
de arquitectura vive en el documento de arquitectura compartido con el equipo;
este archivo contiene las reglas de negocio y convenciones que el codigo debe
respetar, para que tanto Claude Code (en desarrollo) como el agente en
produccion trabajen con la misma informacion.

## Estado del proyecto

**Desplegado en produccion (2026-08-23): `src/tools-server.ts` corre en
Railway** — `https://espazios-whatsapp-agent-production.up.railway.app`,
ya no depende de tunel local ni de que una sesion de Claude Code este
corriendo. Se despliega solo con cada push a `master` (conectado al repo
de GitHub). Variables de entorno configuradas en el dashboard de Railway:
`GOOGLE_SERVICE_ACCOUNT_JSON` (contenido del JSON, no la ruta),
`TARIFAS_ILUSTRATIVAS_SHEET_ID`, `PUBLIC_BASE_URL` (usa la variable
magica `${{RAILWAY_PUBLIC_DOMAIN}}` de Railway). `PORT` lo inyecta
Railway solo. Probado end-to-end: `/tools/estimado-ilustrativo` y
`/tools/detalle-paquete` responden bien con datos reales.

Fase actual: **el Workflow nuevo de Isa v2 ya existe en Kapso y tiene un
system prompt real y detallado** (ver `docs/isa-v2-system-prompt.md`,
sincronizado 2026-08-18) — calificacion completa (ciudad + tipo + manejo
de objecion de presupuesto), FAQ, envio de fotos, agendamiento y prueba
social con videos de TikTok por torre.

**Alcance real de v1 (segun el prompt en produccion):** califica y agenda
una sesion con un Ejecutivo Comercial. NO genera cotizacion en PDF — la
cotizacion se entrega en la sesion humana. Eso significa:
- `/tools/generar-cotizacion` (`src/tools-server.ts`) esta construido pero
  **no es una dependencia de este lanzamiento** — queda para una fase
  futura si se decide automatizar el PDF.
- El agendamiento de reunion usa un **link de Google Calendar Appointment
  Schedule** ya existente — no hace falta construir un tool de Calendar
  API (`agendar_cita`) para eso. Solo el agendamiento de *llamada*
  telefonica queda como un dato capturado (franja horaria) que un humano
  ejecuta, sin integracion.
- `sync_hubspot` sigue pendiente de construir.

**Decision de arquitectura (2026-08-16): la IA vive DENTRO de Kapso, no en
un servidor nuestro que recibe webhooks.** Espazios ya tiene una Isa en
produccion — un Workflow de Kapso tipo arbol de decision (IVR). Por pedido
explicito del usuario, **no se toca ese Workflow**: la version generativa se
construye como un Workflow NUEVO y separado, con un `agent node` (soporta
modelos Anthropic/Claude) como cerebro de la conversacion. Kapso recibe y
manda los mensajes de WhatsApp y mantiene el estado de la conversacion —
nosotros no. Solo cuando la version nueva este lista y probada se cambia el
apuntamiento del numero/webhook de produccion de la Isa vieja a la nueva.

Nuestro repo entonces NO es un servidor conversacional — es el proveedor de
**herramientas de negocio** que el agent node llama (custom webhook tools o
MCP, ver `docs/flows/step-types/agent-node.mdx` en la doc de Kapso):
generar cotizacion (construido), agendar cita en Calendar (pendiente),
sincronizar HubSpot (pendiente). El Workflow nuevo mismo (system prompt,
nodos, que herramientas usa) se arma en el dashboard de Kapso — el MCP de
Kapso conectado a esta sesion no expone creacion de Workflows por API.

`kapso-client.ts` (SDK de envio directo) se mantiene para los seguimientos
programados (§07 del diseno, mensajes que salen sin que el cliente escriba
primero) — eso si sale desde nuestro lado, no desde el Workflow.
Doc: https://docs.kapso.ai/docs/introduction

## Reglas de negocio no negociables

- La cotizacion **nunca** la redacta el modelo de lenguaje en texto libre.
  Siempre se calcula diligenciando la plantilla oficial del cotizador y
  leyendo el resultado ya calculado por sus formulas. El LLM solo explica
  el resultado al cliente.
- El cotizador tiene **una sola plantilla maestra** en Drive. Cada cotizacion
  genera una **copia nueva** (nunca se edita la plantilla original) y esa
  copia se exporta a PDF.
- Toda cotizacion entregada es un **rango preliminar**, sujeto a visita
  tecnica — el texto que acompana el PDF debe dejarlo explicito.
- Los datos personales del cliente solo se capturan despues de un
  consentimiento explicito (Ley 1581 de 2012 / Habeas Data Colombia).

## Roadmap confirmado (2026-08-18, Prioridad 1 revisada 2026-08-23)

La version en produccion de Isa v2 es **MVP** — califica y agenda, sin
estimado automatico y sin Calendar API real. Prioridades de trabajo, en
este orden:

1. **Estimado ilustrativo con 3 paquetes** (reemplaza la idea original de
   "PDF de cotizacion" — la plantilla operativa del Cotizador resulto ser
   demasiado detallada para automatizar desde WhatsApp, ver mas abajo).
   **Construido** en `src/tools/estimado-ilustrativo/` + endpoints en
   `src/tools-server.ts` (`POST /tools/estimado-ilustrativo`,
   `GET /tools/estimados/:id`). Genera una imagen (tarjeta PNG, via
   `sharp`) con nombre, ciudad, proyecto y m² del cliente, y el "Desde $X"
   de los 3 paquetes (Solo Obra Blanca / Intermedio / Remodelacion
   completa) — inspirado en el flujo de Tervi (competencia). Bloqueado por
   credenciales de Google (ver checklist abajo) y por que el equipo
   comercial llene los precios en la hoja de tarifas (ver abajo).
2. **Google Calendar API para agendar sesiones (reunion/meet)** —
   **reemplaza** el link estatico de Google Calendar Appointment Schedule
   que usan hoy. Isa maneja Calendar directamente: consulta disponibilidad
   real y crea el evento (con Google Meet si es virtual) sin que el
   cliente salga de WhatsApp. Confirmado por el usuario 2026-08-18.
3. **Agendamiento de llamada con Calendar API** — mismo enfoque
   (Isa maneja Calendar directamente) aplicado al caso de llamada
   telefonica, que hoy solo guarda una franja horaria como texto sin dia
   ni evento real. Se vuelve un tool propio sobre la misma integracion de
   Calendar de la prioridad 2.
4. **Seguimiento automatico ~10 min despues de compartir el link/franja
   de agendamiento** (pedido por el usuario 2026-08-24, ver mas abajo) —
   pregunta si ya agendo, y si si, explica el proceso (los bullets que
   antes iban en el "paso previo" obligatorio, ahora se guardan para
   este momento). Requiere `kapso-client.ts` (seguimientos programados,
   ya escrito pero dormido) + `KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`
   (vacios en `.env`) — el `agent node` no puede hacer esto solo porque
   solo reacciona cuando el cliente escribe, no puede "despertar" solo
   despues de un tiempo. Falta ademas decidir como saber si "ya agendo"
   sin Calendar API (prioridad 2) — probablemente preguntando
   directamente, no verificando el calendario.

**Cambio de guion 2026-08-24, tras revisar la prueba en Sandbox (ver
seccion de arriba):** se quito el "paso previo" (mensaje automatico de
"quien es Espazios" + proceso en bullets) como paso obligatorio antes de
ofrecer agendar — Isa lo estaba mandando justo despues del estimado,
antes incluso de invitar a ver el detalle de un paquete, sintiendose
apurado y guionizado. Ahora: estimado -> invita a ver detalle de
paquetes (sin cambios) -> cuando el cliente ya no pide mas detalle,
pregunta corta ("¿tienes alguna duda, o te gustaria que agendemos...?")
-> si hay dudas sobre Espazios/el proceso, ahi si se responde con las
secciones 3 y 7 (nunca antes, nunca sin que lo pidan) -> si quiere
agendar, logistica sin cambios (llamada/reunion/presencial). Tambien se
agrego a la seccion 10 (tono): variar la palabra de confirmacion,
"Perfecto" se estaba repitiendo en casi todos los mensajes.

`generar_cotizacion` original (`src/tools/cotizador/`, plantilla operativa
detallada con ~100 items marcables) queda **dormido** — no es lo que
automatiza Isa. Esa plantilla es la herramienta manual del Ejecutivo
Comercial durante la sesion real; no se automatiza en esta fase.

Cobertura del prompt (alrededores = solo Carpinteria) confirmada como
intencional por el usuario — no es un error.

**Hallazgo 2026-08-23:** hay un conector de Google Drive conectado a esta
sesion (`mcp__75c3cd84-...`), autenticado como `espazios.co@gmail.com` —
permite buscar/leer/crear archivos de Drive directamente sin pasar por la
cuenta de servicio. Se uso para crear
[Tarifas Ilustrativas - Isa](https://docs.google.com/spreadsheets/d/1p_36FXsl0dSvV3EvDgln2XALR3gTIdji82xsYihx7oc/edit)
— hoja limpia y separada de la plantilla operativa, columnas
`paquete,m2_min,m2_max,precio_m2,notas`, 3 paquetes × 3 rangos de m2
(25-35/36-45/46-55, mismos rangos que la tabla real de mano de obra).

**Actualizado 2026-08-23 — precios ya cargados y probados end-to-end.**
La columna `precio_m2` es **precio por metro cuadrado**, no el total (asi
la cargo el equipo comercial, consistente con como estan las demas tablas
de tarifas de Espazios) — `pricing.ts` multiplica por el area para dar el
"Desde $" final. Probado con 40m²: da $25.8M / $32.9M / $43.3M para los 3
paquetes, casi identico a los precios de referencia de Tervi (competencia)
para el mismo tamano — buena senal de que el numero es realista.

**Detalle por paquete ("que incluye"), agregado 2026-08-23.** No va en la
tarjeta de resumen (se veria muy denso con 3 listas) — es una imagen
separada que Isa manda **solo si el cliente pregunta por un paquete en
especifico**, despues de invitarlo con algo como "¿te gustaria ver en
detalle que incluye alguno de estos paquetes?". Arquitectura:
- Pestana nueva `Incluye` en la misma hoja de Tarifas — columnas
  `paquete,item` (una fila por item, no texto largo en una celda — mas
  facil de editar).
- **Cargada 2026-08-23 con los items de Tervi (competencia) como
  PLACEHOLDER** — decision explicita del usuario, para no dejar la tarjeta
  vacia mientras tanto. Kit Basico -> Solo Obra Blanca (5 items), Kit
  Medio -> Intermedio (13 items), Kit Plus -> Remodelacion completa (14
  items). **Pendiente: reemplazar con los items reales de Espazios**
  despues de una reunion con los arquitectos — esto NO debe quedar asi en
  produccion, es solo para probar el flujo mientras tanto.

**Bug encontrado y arreglado 2026-08-23: texto invisible en produccion.**
Probado en Kapso via WhatsApp real (Sandbox), las imagenes llegaban con las
formas/colores bien pero el texto salia como glifos "tofu" (##) — Railway
corre Linux sin fuentes del sistema instaladas, y `sharp`/`librsvg` no
tiene con que dibujar los caracteres.

Primer intento (fallido): empacar la fuente directo en el SVG via
`@font-face` + base64. **No funciono** — es una limitacion conocida y
documentada de `librsvg` (soporte de `@font-face` embebido no confiable).

Segundo intento (fallido): `nixpacks.toml` con `aptPkgs`. **Tampoco
funciono** — Railway dejo de usar Nixpacks y ahora usa su propio builder,
**Railpack** (`railpack-v0.37.0`), que no reconoce `nixpacks.toml` en
absoluto (rompia el build: "railpack prepare exited with an error").
Se elimino el archivo.

Tercer intento (fallido, distinto problema): variable de entorno
`RAILPACK_DEPLOY_APT_PACKAGES` en Railway, valor `... fontconfig
fonts-dejavu-core fonts-liberation` (el `...` preserva los paquetes por
defecto de Railpack). El build seguia fallando con el mismo error
generico ("railpack prepare exited with an error", ~4-5s, sin detalle) —
se aislo el problema borrando esa variable por completo: **el build
seguia fallando igual sin ella**, y el diff completo desde el ultimo
deploy exitoso era minimo (4 archivos, nada que tocara package.json ni
config de build). Railway's "Diagnose" automatico tambien fallo
("Diagnosis failed for this deployment"), y no hay boton de "clear build
cache" en Settings (solo Delete Service). Conclusion: Railpack estaba
fallando por algo no relacionado con nuestra config — caja negra sin
manera de debuggear mas.

Se cambio a `Dockerfile` propio (`node:22-bookworm-slim`, instala
`fontconfig fonts-dejavu-core fonts-liberation` via `apt-get`, `npm ci`
sin `--omit=dev` porque el arranque usa `tsx` que es devDependency, no
hay paso de compilacion) — pero el build **seguia fallando** con un error
totalmente distinto y mucho mas especifico: `fsutil.NewFS(.../snapshot
-target-unpack/https:/github.com/espazios/espazios-whatsapp-agent):
resolve : lstat .../snapshot-target-unpack/https:: no such file or
directory`. Pasaba en la etapa de "unpack" del snapshot, **antes** de
que Railpack/Dockerfile entraran en juego — confirmaba que no era nada
de nuestro codigo/config.

**Causa raiz real, encontrada 2026-08-24 via el bot de soporte de
Railway (Community):** el campo **Settings → Source → Root Directory**
del servicio estaba puesto como `https://github.com/espazios/espazios-
whatsapp-agent` (la URL completa del repo) en vez de vacio — resto del
lio de reconexion del GitHub App del dia anterior. Railway usaba ese
valor como ruta de archivos durante el unpack del snapshot, de ahi el
`snapshot-target-unpack/https:/...`. **Arreglo: vaciar ese campo**
(el codigo esta en la raiz del repo). Con eso + el `Dockerfile` propio
(se dejo, ya no depende de Railpack para las fuentes), el build paso y
se confirmo en produccion via `POST /tools/estimado-ilustrativo`: texto
renderiza bien, sin glifos tofu. El endpoint temporal `GET /debug/fonts`
ya se quito de `tools-server.ts`.

(Se planeo crear un segundo servicio en Railway como plan B antes de dar
con la causa raiz, pero al final no hizo falta — nunca se creo.)

**Bug encontrado y arreglado 2026-08-24: mensaje de texto suelto
"(completed)".** Visto en una conversacion real de WhatsApp (Yonathan
Murillo, m2 corregidos de 40 a 60 a mitad de flujo, revisado via el MCP
de Kapso — `whatsapp_messages`): cuando el cliente corrige un dato ya
dado (ej. "corrijo, los m2 son 60") *despues* de que Isa ya penso que
esa etapa habia terminado, Isa manda la imagen actualizada bien (con la
invitacion de "ver en detalle" como caption, correcto), pero **ademas**
manda un mensaje de texto aparte que dice literalmente `(completed)` —
un mensaje suelto y sin sentido para el cliente. El prompt no tenia
ninguna instruccion para el caso "el cliente corrige un dato ya
enviado/procesado" — Isa estaba improvisando esa respuesta. **Arreglo:**
parrafo nuevo al final de la seccion 6.1 en
`docs/isa-v2-system-prompt.md` — instruye a regenerar y mandar solo la
imagen (via `send_media`), sin ningun mensaje de texto aparte, y prohibe
mandar mensajes de una sola palabra/marca de estado suelta. **Pendiente:
pegar este parrafo en el prompt real de Kapso** (ver nota de
sincronizacion al inicio de `isa-v2-system-prompt.md`).

**Formato de mensajes estandarizado, 2026-08-24.** El usuario pidio
consistencia: toda pregunta en negrilla y separada del texto anterior
por un salto de linea en blanco, y cualquier pregunta con opciones (no
solo tipo_proyecto) en formato de lista con vinetas. Ojo con la sintaxis
de WhatsApp: negrilla es un asterisco (`*texto*`), no dos — dos
asteriscos salen literales en el mensaje, no negrilla. Se agrego a la
seccion 10 (`docs/isa-v2-system-prompt.md`) y se actualizo el ejemplo
existente de la seccion 6 (pregunta de tipo_proyecto) para que quede
consistente. Pendiente pegar en el prompt real de Kapso.

**Nota 2026-08-24: se probo y se revirtio mover `presupuesto` al final
del orden de recoleccion.** El usuario pidio inicialmente recolectar
toda la info del proyecto antes de preguntar presupuesto; luego pidio
volver a dejarlo justo despues de `tipo_proyecto` (su posicion
original). Orden final, sin cambios respecto al diseno original:
`nombre`, `ciudad`, `tipo_proyecto`, `presupuesto`, `conjunto_o_barrio`,
`m2`, `plazo`, `correo`. Revertido con `git revert` del commit que hizo
el reorden — de ahi quedo tambien la nota de `celular` (numero de
WhatsApp del remitente, disponible automaticamente por el canal, nunca
se pregunta), que si se mantuvo por separado en la seccion 5.

**Prueba en Sandbox 2026-08-24: formato de preguntas confirmado, gap
encontrado en el momento del correo.** Se reviso la conversacion real
via el MCP de Kapso (`whatsapp_messages`). Hallazgos:
- El formato de negrilla + bullets (seccion 10) ya esta pegado en Kapso
  y funciona — el usuario confirmo que le gusta el resultado tal como
  salio (aunque Isa no siempre deja el salto de linea en blanco antes de
  la pregunta, eso no se va a forzar mas).
- El orden `presupuesto` justo despues de `tipo_proyecto` funciono bien
  (30 millones paso el filtro de Remodelacion completa sin objecion).
- El usuario noto que `correo` no se pidio antes del estimado — **no era
  un bug**, es como esta disenado hoy (`plazo`/`correo` se piden
  *despues* del estimado, seccion 6.1). El usuario decidio cambiar esto:
  quiere `plazo` y `correo` recolectados *antes* del estimado (o sea,
  volver al orden original de 8 datos completo antes de mostrar nada),
  con el correo pedido explicando que justo despues viene un valor
  ilustrativo de la cotizacion.

**Cambio 2026-08-24: `plazo` y `correo` se mueven antes del estimado
ilustrativo.** El disparador de la seccion 6.1 (`generar_estimado_ilustrativo`)
pasa de "en cuanto tengas `ciudad`, `tipo_proyecto`, `conjunto_o_barrio`
y `m2`" a "en cuanto tengas los ocho datos completos, correo incluido" —
o sea, el estimado ahora es lo ultimo que pasa antes del "paso previo"
de agendamiento (seccion 9), no un paso intermedio. El motivo para pedir
`correo` (seccion 5) tambien cambia: ya no es solo "para guardar tus
datos de contacto", ahora anuncia explicitamente que justo despues viene
un valor ilustrativo de la cotizacion — asi la persona entiende por que
se le pide el correo justo ahi. Sigue siendo explicito que ese valor
ilustrativo llega por WhatsApp (imagen), nunca por correo — la
cotizacion formal la entrega el Ejecutivo Comercial en la sesion. Toca
las secciones 5, 6.1 y 9 de `docs/isa-v2-system-prompt.md`.

**Espacio para logo y fotos, agregado 2026-08-23.** `render.ts` busca
archivos en `assets/` (`logo.png`, `paquetes/<slug>.jpg`) y los compone
sobre la tarjeta si existen — si no, deja el espacio reservado con un
placeholder discreto (nunca cambia el layout despues, solo se cubre).
**Pendiente: faltan las 3 fotos por paquete** — ver `assets/README.md`
para nombres/tamanos exactos. `logo.png` **ya se cargo**, ver mas abajo.

**Logo real cargado + rediseno de colores, 2026-08-24.** El usuario
mando el logo real de Espazios (`Logo color EZ-02.png`, PNG con canal
alfa/transparencia real confirmado por muestreo — no fondo blanco
"horneado", solo se veia blanco en el visor del chat). Guardado como
`assets/logo.png`, reescalado de 23622×9449px @600dpi (archivo de
impresion) a 1600×640px (~50KB) — de sobra para el tamano que ocupa en
la tarjeta.

El header de la tarjeta pasa de **fondo verde oscuro** (`#1F2E27`) a
**fondo blanco** — pedido explicito del usuario, porque un logo a color
no esta pensado para ir sobre fondo oscuro. Aprovechando el cambio, se
redisenio toda la paleta de la tarjeta con principios de UX/diseno:
colores tomados por **muestreo directo de los pixeles del logo**
(`node -e` con `sharp`, no a ojo) — sale un teal oscuro
(`#123B38`-ish, del wordmark) y un verde salvia (`#6FBE94`-ish, del
icono). El naranja (`#B5722E`) que tenia el precio en el primer
borrador era un color arbitrario sin relacion con la marca — se
reemplazo por el teal oscuro (mismo color que los titulos, maxima
jerarquia/contraste) y el salvia quedo como **unico acento de color**
(barra bajo el header, franja izquierda en cada card de paquete,
bullets del detalle) — principio de "un solo acento fuerte" en vez de
repetir el mismo verde en todo. Paleta completa en el objeto `COLORS`
al inicio de `render.ts`.

Verificado visualmente generando PNGs de prueba localmente antes de
subir (`npx tsx` con un script temporal, borrado despues) — encontro y
corrigio un bug de layout: el logo real (icono+wordmark, panoramico
~2.5:1) es mas alto de lo que el `LOGO_BOX` original preveia, y su
wordmark se solapaba con el subtitulo de abajo. Ajustado `LOGO_BOX` (mas
chico, h:100) y la posicion del subtitulo (y:150 → y:185).
- `src/tools/estimado-ilustrativo/contenido.ts` — lee esa pestana.
- `renderDetalle()` en `render.ts` — tarjeta de un solo paquete: nombre,
  precio, lista de items, mismo aviso de "ilustrativo". Si no hay items
  cargados, muestra un texto de respaldo en vez de una lista vacia.
- `POST /tools/detalle-paquete` (input: `paquete`, `m2`) en
  `tools-server.ts` — mismo cache en memoria que el estimado general.

**Evolución del cotizador a precio por m2 exacto, 2026-08-28.** Pedido
del usuario: dejar de calcular por rango de m2 (25-35/36-45/46-55) y usar
el precio real para el metraje exacto del apartamento; unificar
`tipo_proyecto` con los 3 nombres de paquete; y reorganizar el "que
incluye" por zona del hogar en vez de lista plana. El equipo comercial ya
habia recargado la hoja `Tarifas Ilustrativas - Isa` con el nuevo
esquema (`paquete, Baños, Habitaciones, m2, precio_m2, precio_m2 con
descuento, notas` — una fila por m2 exacto de 19 a 60) antes de pedir
este cambio.

Antes de tocar codigo se resolvieron 3 preguntas de negocio con el
usuario (via `AskUserQuestion`):

1. **Baños, no habitaciones, en la banda 31-44 m2.** La hoja real mostro
   que en esa banda lo que varia entre las dos filas por m2 es *baños* (1
   o 2) — habitaciones queda fijo en 2 ahi. Esto contradecia la
   instruccion literal original del usuario ("pregunte cuantas
   habitaciones tiene"). Confirmado por el usuario: se pregunta baños,
   no habitaciones. `habitaciones` nunca se le pregunta al cliente — se
   deriva sola de la fila de tarifa que se termino usando (fija segun la
   banda de m2), y de ahi se decide si aparecen las zonas condicionales
   "Habitación 2"/"Habitación 3" del detalle.
2. **Carpintería sigue como una 4ta opcion aparte** de `tipo_proyecto`
   (junto a Solo Obra Blanca/Intermedio/Remodelación Total), con sus
   reglas de cobertura extendida (Mosquera, Madrid, Chía, Cota,
   Zipaquirá, Cajicá, La Calera) y presupuesto minimo ($10M) intactas —
   no hereda nada al nuevo "Intermedio". "Intermedio" comparte cobertura
   (Bogotá/Soacha) y presupuesto minimo ($15M) con sus dos hermanos de
   cobertura completa — el usuario no dio una regla explicita para el
   presupuesto minimo de Intermedio especificamente, se asumio igual al
   de sus hermanos por ser lo menos arriesgado; confirmar si no es el
   caso.
3. **La tarjeta muestra el precio con descuento** (columna `precio_m2 con
   descuento`), resaltado, con el precio de lista (`precio_m2`) tachado
   al lado — pedido explicito del usuario. Implementado en `render.ts`
   con el atributo SVG `text-decoration="line-through"` (nativo, no
   depende de la libreria de fuentes que ya dio problemas con
   `@font-face`, ver el bug de texto invisible mas arriba).

Cambios de codigo: `pricing.ts` reescrito para leer una fila exacta por
m2 (con fallback al m2 conocido mas cercano fuera de 19-60, igual que
antes) y preferir la fila del `banos` pedido cuando hay mas de una en
31-44; `contenido.ts` ahora agrupa el "Incluye" por zona
(`paquete, zona, item`) y filtra zonas condicionales ("Baño principal"
solo si banos=2, "Habitación 2"/"3" solo si habitaciones>=2/3) —
retrocompatible con el formato viejo de 2 columnas (todo cae en una zona
"General") por si la pestaña no se ha actualizado todavia; `render.ts`
agrega el estado "destacado" (badge "Tu elección") para la tarjeta que
coincide con `tipo_proyecto`, agrupa el detalle por zona con
encabezados, y muestra precio-con-descuento + tachado en ambas tarjetas.
`tools-server.ts`: `/tools/estimado-ilustrativo` ahora recibe tambien
`banos` (opcional) y `tipoProyecto`, y cuando este coincide con uno de
los 3 paquetes genera y devuelve de una vez el `imageUrl` del detalle de
ese paquete (asi Isa lo manda sin una segunda llamada); `/tools/detalle-
paquete` recibe tambien `banos` (opcional).

El nombre visible del tercer paquete pasa de "Remodelación completa" a
**"Remodelación Total"** (el usuario pidio explicitamente "colócale un
nombre" a ese paquete y a Intermedio) — mismo nombre en la tarjeta, en
el detalle y en la pregunta de `tipo_proyecto`, para que sean
intercambiables sin mapeo adicional. La clave interna en el codigo sigue
siendo `"Remodelacion completa"` (ASCII, sin tildes) para minimizar el
diff; solo cambio el texto visible.

Encontrado y resuelto sin bloquear al usuario (bajo riesgo, reversible):
la pestaña "Tarifas" de la hoja usa **"Total"** como nombre del tercer
paquete, mientras que la pestaña "Incluye" usa "Remodelacion completa" —
inconsistencia entre pestañas de la misma hoja. `pricing.ts` acepta
ambos como alias del mismo paquete interno (`normalizarPaquete`), asi
que no hizo falta editar la hoja para esto.

**Pendiente — no se pudo resolver en esta sesion.** El conector de
Google Drive disponible aca (`mcp__Google_Drive__*`) solo permite leer
archivos y renombrar/mover metadata — no expone escritura de celdas de
un Sheet existente (no hay equivalente a `spreadsheets.values.update`).
No se pudo reestructurar la pestaña "Incluye" al formato nuevo
(`paquete, zona, item`) directamente en la hoja real. `contenido.ts` ya
soporta ese formato (y sigue funcionando con el viejo como fallback),
pero alguien con acceso de edicion al Sheet tiene que pegar el contenido
— se genero una propuesta de mapeo de los items placeholder de Tervi
(los que ya estaban cargados) a las 7 zonas, entregada en el chat de esa
sesion. Sigue siendo placeholder, como ya estaba anotado — falta el
contenido real de Espazios por zona, pendiente de la reunion con los
arquitectos.

**Actualizado 2026-08-28 — el equipo comercial ya cargo el contenido
real (ya no es el placeholder de Tervi).** El usuario subio un xlsx con
la pestaña "Incluye" ya reescrita con el contenido real de Espazios (36
items en 8 zonas: Obra blanca, Cocina, Zona de ropas, Baño general,
**Baño habitación principal**, Habitación principal, Habitación 2,
Habitación 3) — mucho mas detallado que el placeholder. Se corrigio
ortografia en 142 celdas (tildes/ñ que faltaban, mayusculas
inconsistentes, puntos finales sueltos) y se devolvio el archivo
corregido; el usuario ya lo pego en la hoja real. Se encontro y corrigio
un bug en `contenido.ts`: la zona condicional que solo debe aparecer con
2 baños se llama en el contenido real **"Baño habitación principal"**,
no "Baño principal" como se habia asumido antes de ver el contenido —
sin el ajuste esa zona nunca se hubiera ocultado bien para apartamentos
de 1 baño.

**Rediseño visual de la tarjeta de detalle, 2026-08-28.** Pedido del
usuario: que la tarjeta de "que incluye" se vea como una cotizacion real
(inspirado en la pestaña "Cotización" del Cotizador VER4, aunque esa
pestaña resulto ser una grilla operativa de checkboxes sin diseño visual
que copiar — se aprovecho de ahi el tagline de marca "Dale vida a cada
lugar." y la lista de campos parametricos que ya usa esa plantilla:
cliente, proyecto, area privada, habitaciones, baños), con imagenes
junto a cada zona, encabezados, paleta rediseñada aplicando principios
de UX, y disclaimers legales redactados como los pediria un abogado
comercial en Colombia. Cambios en `render.ts`:

- **Tarjetas de zona con imagen + texto** (ley de la region comun: cada
  zona es su propia tarjeta con borde; ley de proximidad: la foto vive
  junto a su texto). Foto por zona (no por paquete como antes) — busca
  `assets/zonas/<zona-normalizada>.jpg`, con el mismo placeholder
  discreto de siempre si no existe (ver `assets/README.md`, actualizado
  con los 8 nombres de archivo esperados). Las fotos por paquete viejas
  (`assets/paquetes/*.jpg`) ya no las usa el codigo.
- **Envoltura de texto real** (`envolverTexto()` en `render.ts`): los
  items ahora conviven con una imagen al lado, asi que la columna de
  texto es mas angosta — hacia falta partir items largos en varias
  lineas (antes cada item era una sola linea sin quiebre). Estima el
  ancho de caracter para DejaVu Sans/Liberation Sans, sin dependencias
  nuevas.
- **Etiqueta de descuento, esquina superior izquierda** ("Incluye
  descuento del X%") — pedido explicito del usuario, "dato parametrico,
  default 3%". Implementado como `calcularDescuentoPct()`: calcula el %
  real a partir de `precioDesde`/`precioDesdeSinDescuento` cuando ambos
  estan disponibles (para que nunca quede desactualizada si el
  descuento de la hoja cambia), y solo cae al 3% por defecto
  (`DESCUENTO_PCT_DEFAULT`) si no se puede calcular. Aparece en ambas
  tarjetas (resumen y detalle) para que sea el mismo sello en las dos
  (ley de Jakob / consistencia).
- **Disclaimer legal ampliado**, en bloque aparte con fondo distinto
  (ley del aislamiento — Von Restorff): dice explicitamente que el
  documento NO es una oferta comercial en firme (relevante en Colombia
  por el art. 845 del Código de Comercio — una propuesta con los
  elementos del contrato comunicada al destinatario puede considerarse
  vinculante si no se aclara lo contrario), que el valor final puede
  variar segun la personalizacion del cliente y los ajustes que resulten
  de conocer la vivienda en la visita tecnica, y que el descuento se
  confirma en la cotizacion formal.
- **Datos del cliente/proyecto en la tarjeta de detalle** — antes solo
  la tenia la tarjeta resumen; ahora la de detalle tambien muestra
  nombre, proyecto, ciudad, m2, habitaciones y baños (cuando se
  conocen), como una cotizacion real. Esto significa que
  `ver_detalle_paquete` (`docs/isa-v2-system-prompt.md`, sección 6.1) y
  `/tools/detalle-paquete` (`tools-server.ts`) ahora reciben tambien
  `nombre`, `ciudad` y `proyecto` — antes solo pedian `paquete`, `m2` y
  `banos`.
- Otras leyes de UX aplicadas con criterio, no las 12 a la fuerza: ley
  de la similitud (todas las tarjetas de zona con el mismo estilo), ley
  de Prägnanz (formas simples, sin adornos), efecto de posicion serial
  (Obra blanca — lo estructural — abre el listado; el disclaimer legal
  lo cierra con fuerza en vez de dejarlo desvanecer). Fitts/Hick/Doherty
  no aplican — es una imagen estatica, no hay interaccion ni carga.

No se pudo ver el estilo visual real de la pestaña "Cotización" del
Cotizador VER4 (colores, fuentes) — el conector de Drive disponible aca
no dejo descargar ese archivo como xlsx (~9.4MB, "session expired" en
varios intentos) para inspeccionar formato con `openpyxl`. Se diseño con
la paleta de marca ya verificada (muestreada del logo real) en vez de
copiar la de esa hoja.

## Autenticacion con Google (resuelto 2026-08-23)

`secrets/service-account.json` **no es una cuenta de servicio clasica** —
el proyecto de Google Cloud (`project-3220a2c1-d15e-4f6b-bec`, "My First
Project") tiene una politica que bloquea la creacion de llaves de cuenta de
servicio (`constraints/iam.disableServiceAccountKeyCreation`, no se pudo
levantar ni siendo dueno del proyecto — permiso denegado). En su lugar se
uso **Application Default Credentials de usuario**: se creo un Cliente
OAuth propio (tipo "Aplicacion de escritorio", no el cliente compartido de
`gcloud` — ese esta bloqueado por Google para scopes de Drive/Sheets/
Calendar) y se corrio `gcloud auth application-default login` con
`espazios.co@gmail.com`. El JSON resultante tiene `"type": "authorized_user"`
en vez de `"type": "service_account"` — `google-auth-library` acepta las
dos formas de forma transparente, asi que **no hizo falta cambiar nada en
`google-auth.ts`**. Probado end-to-end con `calcularEstimado()` — funciona.

Implicacion para desplegar en produccion: este archivo de credenciales
esta atado a la cuenta de usuario `espazios.co@gmail.com`, no a una
identidad de maquina — copiar el mismo `secrets/service-account.json` al
entorno de produccion funciona igual, pero si el refresh token se revoca
o expira hay que repetir el login (no es tan robusto como una llave de
servicio para un proceso desatendido de larga duracion). Si mas adelante
la politica del proyecto permite crear llaves de servicio, migrar a eso.

Cliente OAuth usado: `828398821260-86t2omrk0g7dhn08sb6i8d64kvtnte2f.apps.googleusercontent.com`
(tipo Desktop app, en modo "Testing" con `espazios.co@gmail.com` como test user).

## Pendiente de informacion (bloquea partes del flujo)

**Estimado ilustrativo: COMPLETO y probado end-to-end** (autenticacion +
tarifas + render de imagen). Falta conectarlo al agent node de Kapso como
webhook tool (desplegar `tools-server.ts` en una URL publica) — ver abajo.

- [ ] `sync_hubspot`: falta construir. Cuando se haga, mapear `presupuesto`
      (numero exacto, ej. "$15") al rango que espera la propiedad
      `rango_presupuesto` de HubSpot (ej. "Entre $15 y $30 millones").
- [ ] Confirmar si la franja horaria de "llamada" en el prompt deberia
      capturar tambien el dia, no solo el horario (ambiguo hoy).
- [ ] `KAPSO_API_KEY` / `KAPSO_PHONE_NUMBER_ID` para cuando se construya el
      envio de seguimientos programados (`kapso-client.ts`).
- [x] ~~Desplegar `src/tools-server.ts` en una URL publica real~~ — hecho,
      corre en Railway (ver arriba).
- [ ] Conectar `generar_estimado_ilustrativo` y `ver_detalle_paquete` como
      webhook tools en el agent node de Kapso, apuntando a
      `https://espazios-whatsapp-agent-production.up.railway.app` (URL
      permanente, ya no hay que actualizarla cada vez).
- [ ] Fotos por zona (`assets/zonas/*.jpg`, 8 archivos — ver
      `assets/README.md`) — ninguna existe todavia, la tarjeta de
      detalle rediseñada 2026-08-28 muestra el placeholder discreto en
      las 8 zonas mientras tanto.
- [ ] Si mas adelante se decide automatizar el PDF de cotizacion detallado:
      retomar `COTIZADOR_TEMPLATE_ID` (pendiente, ver abajo) — el estimado
      ilustrativo de 3 paquetes ya no depende de esto.
- [ ] ID del archivo de la plantilla del cotizador en Drive (`COTIZADOR_TEMPLATE_ID`).
- [ ] Estructura real de la plantilla: que celdas/rangos son entradas
      (cliente, ciudad, tipo de proyecto, m2, nivel de acabado...) y cuales
      son salidas (rango de precio, desglose). Ver `src/tools/cotizador/field-map.ts`
      — hoy tiene valores de ejemplo que **deben reemplazarse** por los reales.
- [ ] gid (pestana) de la hoja que debe imprimirse como PDF, si la plantilla
      tiene varias pestanas (entrada / calculo / version imprimible).
- [ ] Carpeta de Drive donde deben quedar las cotizaciones generadas.
- [ ] Correo de la cuenta de servicio de Google, para que el equipo comparta
      con permiso de edicion la plantilla y la carpeta de salida.

## Convenciones de codigo

- TypeScript, modulos ES (`type: module` en package.json), sin build step
  para desarrollo — se ejecuta con `tsx`.
- Cada integracion externa vive en `src/tools/<integracion>/` con un unico
  punto de entrada exportado; nada de logica de negocio directamente en
  `scripts/`.
- Credenciales solo por variables de entorno (`.env`, nunca committeado).
  `.env.example` documenta cada variable requerida.
- Sin dependencias nuevas sin necesidad clara — este proyecto prioriza
  superficie minima (ver decisiones de arquitectura: una sola base de datos,
  APIs oficiales, sin frameworks pesados).
