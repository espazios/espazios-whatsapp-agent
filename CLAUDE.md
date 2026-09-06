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
Railway solo. Probado end-to-end en su momento: `/tools/estimado-
ilustrativo` y `/tools/detalle-paquete` respondian bien con datos
reales — **ver el bug critico de 2026-08-28 mas abajo**, la hoja
cambio de esquema despues de esta prueba y el codigo desplegado quedo
desactualizado hasta que se mezclo el fix.

**Bug critico encontrado y arreglado en produccion, 2026-08-28.** Al
mezclar la evolucion del cotizador (ver mas abajo) se detecto que
`master` — lo que corria en Railway — todavia leia la hoja de tarifas
con el esquema viejo (`A2:D` = `paquete, m2_min, m2_max, precio_m2`),
pero la hoja real ya tenia el esquema nuevo (`paquete, Baños,
Habitaciones, m2, precio_m2, precio_m2 con descuento`) desde *antes* de
que empezara esta sesion. El codigo viejo terminaba leyendo la columna
"Baños" como si fuera `m2_min`, "Habitaciones" como `m2_max`, y la
columna "m2" como si fuera el precio — para cualquier area real de
cliente el filtro nunca hacia match, caia siempre al caso "aproximado",
y multiplicaba un numero de la columna m2 (19-60) por el area del
cliente: precios de unos miles de pesos en vez de millones. Esto
probablemente llevaba roto desde que el equipo comercial recargo la
hoja — y segun este mismo archivo el tool ya se habia probado "end to
end via WhatsApp real" el 2026-08-23, asi que es posible que algun
cliente real haya visto ese numero. Se mezclo `claude/cotizador-m2-
evolution-mwndvk` a `master` de inmediato (confirmado con el usuario
antes, dado que es un cambio a produccion) — Railway confirmo
"Deployment successful" para el commit `b8becd6`. Queda pendiente que
alguien confirme con una prueba real (Sandbox o WhatsApp real) que el
precio ya sale en millones.

Fase actual: **el Workflow nuevo de Isa v2 ya existe en Kapso y tiene un
system prompt real y detallado** (ver `docs/isa-v2-system-prompt.md`,
sincronizado 2026-08-28 — el usuario pego el cuerpo completo directo en
Kapso) — calificacion completa (ciudad + tipo + manejo de objecion de
presupuesto), FAQ, envio de fotos, agendamiento y prueba social con
videos de TikTok por torre.

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

**Bug critico #2 en produccion, 2026-08-31 — refresh token expirado.**
Yonathan probo el estimado ilustrativo real via WhatsApp (dos
conversaciones el mismo dia) y Isa respondio repetidas veces "tuve un
problema generando el estimado ilustrativo". Isa habia recolectado todo
bien (m2=40, banos=2, tipo_proyecto="Intermedio") — el fallo estaba en
el backend. Revisando el log de error en Railway (`err` completo del
`req.log.error` en `tools-server.ts`):

```
err.message: invalid_grant Error: invalid_grant
err.response.data.error: invalid_grant
err.response.data.error_description: Token has been expired or revoked.
```

Confirma exactamente lo que ya advertia la nota de arriba: el Cliente
OAuth esta en modo "Testing" en Google Cloud, y Google le pone un
**limite duro de 7 dias a los refresh tokens de una app en ese modo**,
sin importar si se usan o no. Las credenciales se generaron el
2026-08-23 — fallaron el 2026-08-31, 8 dias despues. Afecta a *cualquier*
llamado que use `getSheetsClient()` (estimado, detalle, cotizador
dormido), no solo al que se probo.

**Arreglado 2026-08-31 — confirmado con prueba real.** El usuario
renovo el token manualmente:
1. Como el Cliente OAuth ya no permite descargar el secreto de un
   cliente existente (Google cambio esto — la pantalla de credenciales
   solo deja "Ver/descargar" en el momento en que se genera un secreto
   nuevo, no despues), hubo que generar un secreto nuevo desde
   "APIs y servicios → Credenciales → Cliente de escritorio 1 →
   Secretos del cliente → Agregar secreto", que si permitio descargar
   el JSON en ese momento.
2. Primer intento en Google Cloud Shell: fallo. `gcloud auth
   application-default login --client-id-file=...` con un Cliente
   OAuth tipo "Desktop app" en un entorno sin navegador propio cae al
   flujo `--remote-bootstrap`, que depende del flujo OOB
   ("out-of-band", copiar/pegar un codigo) que Google deprecio hace
   tiempo por seguridad — la URL que genera ni siquiera trae
   `redirect_uri`, y Google la rechaza con "Error 400: invalid_request,
   Missing required parameter: redirect_uri". No es arreglable
   copiando la URL distinto — Cloud Shell no sirve para este tipo de
   cliente OAuth.
3. Se cambio a correr el mismo comando en Windows local (instalando
   Google Cloud SDK ahi) — con navegador real disponible, `gcloud`
   completa el flujo por `http://localhost` sin el problema del OOB.
   JSON resultante pegado en `GOOGLE_SERVICE_ACCOUNT_JSON` en Railway.
4. Confirmado con Isa por WhatsApp real: el estimado ilustrativo ya
   genera bien.

**Esto va a volver a pasar cada ~7 dias** mientras el Cliente OAuth siga
en modo "Testing" — no es algo que se arregle en el codigo. Dos salidas
reales para que no sea un problema recurrente: publicar la app OAuth
(pantalla de consentimiento, de "Testing" a "In production" — los
refresh tokens de apps publicadas no expiran por tiempo), o migrar a una
llave de cuenta de servicio clasica si la politica del proyecto alguna
vez lo permite (ver arriba, hoy bloqueada). Pendiente decidir cual de
las dos se persigue — por ahora queda como proceso manual repetible
(pasos 1-3 arriba) cuando vuelva a expirar.

**Solucion durable — RESUELTO, 2026-09-03. Se persiguieron dos salidas en
paralelo (ver intento original 2026-09-02 abajo); la de publicar la app
OAuth cerro y quedo confirmada con prueba real.**

1. **Llave de cuenta de servicio clasica — abandonado.** El usuario si
   tiene rol de administrador de politicas de organizacion y logro anular
   `constraints/iam.disableServiceAccountKeyCreation` a nivel de proyecto
   (Politicas de la organizacion → esa restriccion → "Anular politica del
   elemento superior" → regla con aplicacion "Desactivado" → Configurar
   politica — la UI muestra un paso de "Probar cambios"/simulacion que es
   solo un dry-run, hay que volver atras y guardar la politica real
   aparte). Confirmado guardado ("Estado: No aplicada" para el proyecto),
   pero **crear la llave seguia fallando** con el mismo error
   (`iam.disableServiceAccountKeyCreation` bloqueada "en tu empresa")
   incluso despues de esperar varios minutos — probablemente una
   restriccion puesta mas arriba (la "aplicacion de Seguridad de forma
   predeterminada" que Google le pone a organizaciones/proyectos nuevos)
   que un "anular" a nivel de solo proyecto no alcanza a vencer.
   Requeriria acceso a nivel de Organizacion que este setup (proyecto
   personal sin dominio de Workspace) puede ni siquiera tener expuesto en
   la consola — no se siguio este camino, se prefirio el de publicar la
   app.
2. **Publicar la app OAuth — funciono.** Se redujo el scope pedido en
   `src/lib/google-auth.ts`: se quito `.../auth/drive` (el unico de los 4
   scopes que Google clasifica como "restringido" — exige evaluacion de
   seguridad para publicar; los otros tres —Sheets, Calendar,
   Gmail.send— son "sensibles", verificacion mas liviana pero igual
   exige, entre otros requisitos, un enlace de pagina de inicio y una
   politica de privacidad publica). Drive solo lo usaba
   `generar_cotizacion` (`getDriveClient()`), que ya esta dormido — cero
   impacto en produccion (commit `cdd92b1`).
   - Se intento primero marcar la app como "Interno" (evita toda la
     verificacion) — **revertido de inmediato**: bloqueo al propio
     `espazios.co@gmail.com` para autenticar ("Error 403: org_internal"),
     porque esa cuenta no pertenece al dominio/Organizacion de Google
     Workspace atado al proyecto. Se volvio a "Externo".
   - Google exigio 2 datos de marca antes de dejar pasar a "En
     produccion": **pagina de inicio** (se uso la pagina real ya
     existente de Espazios, `https://www.espazios.com.co/`, aunque el
     usuario advirtio que esta desactualizada) y **URL de politica de
     privacidad** (no existia ninguna — se redacto una nueva desde cero,
     con los datos reales de tratamiento de datos de Espazios y
     referencia a la Ley 1581 de 2012/Decreto 1377 de 2013, y se publico
     como Claude Artifact — ver nota abajo, pendiente migrarla a una
     pagina real en `espazios.com.co` cuando el usuario tenga quien la
     suba).
   - Con esos 2 datos la app paso a **Externo + En produccion**.
   - Se repitio `gcloud auth application-default login` (mismo cliente
     OAuth de escritorio, scopes reducidos) desde Windows local — la
     pantalla de "Google no verifico esta app" **si sigue saliendo**
     (eso depende de que la app pase la verificacion completa de Google,
     no de si esta en modo Testing o Produccion; con pocos usuarios,
     Google deja avanzar igual con esa advertencia) pero eso no afecta la
     duracion del refresh token — lo que si cambia con "En produccion" es
     que el limite duro de 7 dias, especifico del modo "Testing",
     desaparece. JSON nuevo pegado en `GOOGLE_SERVICE_ACCOUNT_JSON` en
     Railway, deploy confirmado.
   - **Confirmado con prueba real, 2026-09-03 ~7:35pm:** conversacion de
     WhatsApp con Yonathan Murillo (revisada via el MCP de Kapso,
     `search_logs`) — Isa pidio el correo, genero y entrego la imagen del
     estimado ilustrativo sin errores (`outbound image delivered`), y
     mando la invitacion a ver detalle de paquetes. Cero eventos de
     problema en las ultimas 24h para ese flujo.

**Pendiente de verificar con el tiempo:** el token nuevo se emitio bajo
la app ya en "En produccion", asi que en teoria no deberia volver a
expirar a los 7 dias como antes — pero esto no se puede confirmar del
todo hasta que pasen esos 7 dias sin que vuelva a fallar. Si vuelve a
pasar, revisar primero si la app sigue en estado "En produccion" (no se
revirtio sola a "Testing") antes de asumir que es el mismo bug de antes.

## Base de datos de leads de Isa v2 — decision de arquitectura (2026-09-04)

El usuario pidio un informe con las variables que recolecta Isa v2
(nombre, ciudad, tipo_proyecto, presupuesto, conjunto_o_barrio, m2,
banos, plazo, correo), incluyendo la fecha/hora cuando el cliente agenda
una llamada. Investigacion antes de construir nada:

- **Kapso no guarda esto de forma estructurada para Isa v2.** La Isa
  vieja (el Workflow tipo arbol de decision, "Precalificacion Leads EZ",
  el que sigue atendiendo el numero real de produccion — ver mas abajo)
  si tiene un registro limpio por conversacion (`nombre_cliente`,
  `ciudad_vivienda`, `tipo_proyecto`, `presupuesto`, `conjunto`, `plazo`,
  `correo`, `lead_guardado`), visible via `search_logs` (MCP de Kapso,
  `source=function_invocation_event`) porque usa un paso tipo `Function`
  que loguea `execution_context.vars` completo en cada invocacion. Isa
  v2 es un `agent node` (LLM libre) — su "memoria" vive solo en el
  contexto de la conversacion con el modelo, sin ningun paso que la deje
  en una tabla consultable. Se revisaron a fondo los logs de Kapso
  (flow_event, function_invocation_event, external_api_log,
  webhook_delivery) buscando el payload de las llamadas a
  `generar_estimado_ilustrativo`/`ver_detalle_paquete` y no aparece en
  ningun lado — solo metadata tecnica (que tool se llamo, cuanto tardo).
- **Nuestro propio servidor tampoco lo guarda.** `tools-server.ts` recibe
  nombre/ciudad/proyecto/m2/banos/tipoProyecto en cada llamada pero es
  sin estado — nunca los escribe a ningun lado, solo los usa para
  calcular el precio y devolver la imagen.
- **Hallazgo aparte, importante:** el numero de produccion real
  (`+57 310 8708467`, `whatsapp_config.kind: "production"`) todavia
  atiende clientes reales con la **Isa vieja** (IVR/arbol de decision,
  botones de opciones) — se confirmo revisando `search_logs` por 30
  dias, con al menos 10 conversaciones reales distintas. Isa v2 (agent
  node, texto libre) solo se ha probado con Yonathan Murillo, en un
  `whatsapp_config_id` distinto — osea el numero de pruebas interno, no
  el de produccion. Esto es consistente con el diseño ya documentado
  arriba ("solo cuando la version nueva este lista y probada se cambia
  el apuntamiento del numero de produccion") — no es un bug, solo una
  confirmacion de que el corte todavia no ha pasado.

**Decision: construir `guardar_lead` como una base de datos DENTRO de
Kapso (Cloudflare D1 via Kapso Functions), no en un Google Sheet.**
Se evaluaron ambas opciones — ver la comparacion completa en el chat de
esta sesion. Kapso Functions (Cloudflare Workers) tienen acceso
automatico a `env.DB`, una base D1 (SQL, compatible SQLite) compartida
por todo el proyecto — es el mismo mecanismo que ya usa la funcion
`Precalificacion` de la Isa vieja. Ventaja principal sobre el Sheet: cero
dependencia del OAuth de Google (el que se ha vencido 2 veces esta
sesion).

**Limitacion real encontrada:** esta sesion de Claude Code no tiene
salida de red hacia `api.kapso.ai` (bloqueada por el proxy del sandbox,
confirmado con `403 policy denial` al probar) y el MCP de Kapso
conectado aqui no expone creacion/deploy de Functions (solo
customers/whatsapp_*/search_logs/etc.) — asi que **no se pudo automatizar
el deploy desde esta sesion**, a pesar de tener ya un `KAPSO_API_KEY`
(guardado en `.env` local, no committeado). El deploy quedo como pasos
manuales para el usuario en el dashboard de Kapso.

**Construido, pendiente de desplegar por el usuario:**
- `kapso-functions/guardar-lead.js` — tool que Isa v2 llama 2 veces
  (justo despues del estimado, con los 8 datos de calificacion; justo
  despues del agendamiento, con `tipo_agendamiento`/`fecha_llamada`/
  `hora_llamada`). Usa el telefono del contacto (inyectado automatico por
  Kapso en `execution_context.context.phone_number`, nunca lo pasa Isa
  como argumento) como llave para hacer upsert sin duplicar filas. Crea
  la tabla sola (`CREATE TABLE IF NOT EXISTS`) en la primera invocacion.
- `kapso-functions/leads-reporte.js` — endpoint publico de solo lectura,
  devuelve una tabla HTML (o JSON con `?format=json`) de todos los leads
  guardados — el "informe" que se pidio. Proteccion opcional via Secret
  `REPORT_TOKEN` (`?token=...` en la URL).
- `kapso-functions/README.md` — paso a paso completo del deploy (crear
  las 2 funciones en el dashboard, pegar el codigo, deploy, y declarar
  `guardar_lead` como tool del agent node de Isa v2 con su JSON schema).
- `docs/isa-v2-system-prompt.md` — secciones 6.1 y 9 actualizadas: llaman
  a `guardar_lead` en los 2 momentos, y la pregunta de agendar llamada
  ahora pide **dia y horario** por separado (antes solo horario, sin
  dia — bug ya anotado en las notas de revision del archivo, ahora
  resuelto). **No pegar este prompt en Kapso hasta desplegar las 2
  funciones primero** — el prompt llama un tool que todavia no existe.

**Limite conocido que NO resuelve esta base de datos:** para reuniones
(virtual/presencial), Isa nunca sabe la fecha/hora exacta que el cliente
elige — eso queda en Google Calendar, fuera del alcance de Kapso, porque
sigue siendo el link estatico de Appointment Schedule (no la integracion
real de Calendar API que es la Prioridad 2 del roadmap). El reporte solo
puede decir "eligio reunion virtual/presencial", no cuando.

### RESUELTO — 2026-09-05, confirmado end-to-end en produccion

El deploy manual lo hizo el usuario, pero el problema real (y el arreglo
final) lo resolvio el **propio asistente de IA de Kapso** (dentro de su
dashboard, con acceso interno que esta sesion no tiene) — no esta
sesion de Claude Code. Cronologia:

1. Deploy manual de `guardar-lead.js` como funcion `guardar-lead-isa-v2`
   y `leads-reporte.js` como `leads-reporte-isa-v2` (nombres con sufijo
   `-isa-v2` porque el proyecto ya tenia una funcion `guardar-lead`
   propia de la Isa vieja — no tocar esa).
2. **Bug de nombre de tabla:** la tabla `leads` (nombre generico usado en
   el codigo original) ya existia en la base D1 compartida del proyecto
   con otro esquema — el `CREATE TABLE IF NOT EXISTS` nunca corria de
   verdad. Arreglado renombrando a `leads_isa_v2` en ambos archivos
   (mismo commit que agrego el sufijo a los nombres de function).
3. **Bug real, mas de fondo:** el tool `guardar_lead` se habia conectado
   en el agent node como **"Webhook Tool"** generico (URL manual +
   header `X-API-Key`, apuntando al invoke endpoint publico de la
   funcion) — igual que `generar_estimado_ilustrativo`/
   `ver_detalle_paquete` apuntan a Railway. Con eso, la funcion NUNCA
   se invocaba: la pestaña "Invocations" del dashboard se quedaba en
   "No invocations yet" pase lo que pase, aunque el log de la
   conversacion mostrara `agent_tool_called`/`agent_tool_response`
   normal — el agente "creia" haber llamado el tool y recibido
   respuesta, pero la funcion real nunca se ejecutaba. Confirmado por
   triplicado: `search_logs` (MCP de Kapso, `function_invocation_event`
   filtrado por `function_id`) en cero, la pestaña Invocations del
   dashboard en cero, y la tabla `leads_isa_v2` en Database con 0 filas
   — los tres a la vez, para la misma conversacion de prueba real donde
   el tool si aparecia llamado 4 veces en el log del flujo.
4. **Diagnostico y fix delegados al asistente de IA de Kapso** (no a
   esta sesion — no tenemos acceso interno a por que el "Webhook Tool"
   fallaba silenciosamente). Se le paso la evidencia exacta de arriba
   (llamadas registradas en el flujo vs. cero invocaciones reales) y se
   le pidio explicitamente que analizara y ajustara el, no solo que
   explicara. Resultado: reconecto `guardar_lead` como **"Function
   Tool" nativo** (selecciona la funcion Kapso directamente, sin URL/
   headers manuales) en vez de "Webhook Tool" — ese era el problema.
5. **Confirmado end-to-end con evidencia real** (`search_logs`,
   `function_invocation_event`, function_id de `guardar-lead-isa-v2`,
   2026-09-05 ~7:28-7:31am hora Colombia, sandbox de WhatsApp):
   - Primera invocacion: guarda los 8 datos de calificacion
     (`nombre`, `ciudad`, `tipo_proyecto`, `presupuesto`,
     `conjunto_o_barrio`, `m2`, `plazo`, `correo`) →
     `{"ok": true, "telefono": "573024058302", "campos_guardados": [...]}`
   - Segunda invocacion (mismo telefono): actualiza el mismo registro
     agregando `tipo_agendamiento: "llamada"`, `fecha_llamada:
     "2026-09-07"`, `hora_llamada: "9:00 am"` — el upsert por telefono
     funciono, no duplico fila. **Esto es exactamente el dato que el
     usuario pidio al inicio de todo esto: dia y hora de la llamada,
     capturados y guardados.**

**Leccion para la proxima vez que se conecte una Kapso Function como
tool de un agent node en este proyecto:** usar siempre **"Function
Tool"** nativo (selecciona la funcion de una lista) — nunca "Webhook
Tool" apuntando al invoke endpoint publico de una funcion propia del
mismo proyecto. El segundo tipo falla en silencio (el agente cree que
funciono, pero la funcion real nunca corre) y no deja ningun rastro de
error en ningun log accesible desde el MCP de Kapso ni desde el
dashboard — solo se nota comparando el conteo de invocaciones contra el
conteo de llamadas en el log de la conversacion.

**Actualizacion 2026-09-05, misma tarde — el tool se renombro a
`guardar_lead_db`.** El usuario sincronizo el prompt real de Kapso con
este repo y aparece llamando **`guardar_lead_db`** (no `guardar_lead`)
en las secciones 6.1 y 9 — el asistente de IA de Kapso debio renombrar
el tool al reconectarlo como Function Tool nativo. El prompt tambien
gano instrucciones mas robustas: llamada obligatoria (no solo "guarda
el lead") en los 2 momentos, puede volver a llamarse si el cliente
corrige/agrega notas de agendamiento, y nunca afirmar que se guardo si
la herramienta da error. Queda una referencia vieja sin actualizar en
la ultima frase de la seccion 9 ("guardados con `guardar_lead`") —
inconsistencia menor, es solo texto descriptivo, no rompe nada.
**Confirmado por el usuario, 2026-09-05:** el tool en la pestaña
"Tools" del agent node si se llama exactamente `guardar_lead_db`,
coincidiendo con el prompt ya sincronizado — `kapso-functions/
README.md` (paso 3) tambien se actualizo con el nombre nuevo.

**Correccion, 2026-09-05:** al releer los `flow_event` (`search_logs`,
`event_type=agent_tool_called`) de esa misma conversacion de prueba se
confirmo que **las 2 invocaciones de la seccion "RESUELTO" arriba ya
eran con el nombre `guardar_lead_db`**, no con el nombre viejo
`guardar_lead` como se anoto por error mas arriba — el atributo
`tool_name` de ambos eventos `agent_tool_called` (07:28:03 y
07:31:08 hora Colombia) dice literalmente `guardar_lead_db`, con
`tool_type: "function_tool"`. Osea que el rename ya estaba en
produccion desde antes de esa prueba, no despues — la nota original
tenia la secuencia de tiempo invertida. No hace falta entonces una
prueba adicional solo para confirmar el nombre nuevo: las 2
invocaciones ya documentadas (status 200, upsert correcto con
`fecha_llamada`/`hora_llamada` incluidas) YA fueron bajo
`guardar_lead_db`.

**Pendiente, no urgente:** decidir si `leads-reporte-isa-v2` (el
endpoint HTML/JSON de solo lectura) sigue haciendo falta ahora que
Kapso tiene una pestaña nativa de **Database** en el dashboard del
proyecto donde se puede ver `leads_isa_v2` directamente sin necesitar
ninguna funcion nuestra — probablemente se pueda dar de baja
`leads-reporte-isa-v2` y quedarse solo con la vista nativa.

## Bug de doble mensaje por turno en Isa v2 — RESUELTO, 2026-09-05

Encontrado revisando conversaciones de prueba reales (Yonathan Murillo,
via `search_logs`/`whatsapp_messages` del MCP de Kapso): en casi todos
los turnos, Isa le mandaba al cliente **dos mensajes de WhatsApp** para
una sola respuesta — a veces la misma pregunta repetida palabra por
palabra, a veces la pregunta real seguida de un mensaje aparte de puro
relleno ("Quedo atento a tu respuesta.", "Quedo atento a esa
información."). Se diagnostico la causa raiz cruzando los mensajes
reales con los `flow_event` internos del agent node (`agent_tool_called`,
`agent_message_sent`): el agente tiene disponible una herramienta de
comunicacion generica del agent node, `send_notification_to_user`, y
nada le impedia llamarla mas de una vez (o llamarla y ademas dejar que
su respuesta de turno normal tambien saliera) para una sola respuesta
al cliente.

Se le paso la evidencia exacta al asistente de IA de Kapso en 3 rondas
sucesivas (cada vez con ejemplos reales de la conversacion de prueba
mas reciente), pidiendole que **analizara y ajustara**, no solo que
explicara:

1. Primera ronda: identifico el problema (dos canales de salida a la
   vez) pero el primer ajuste solo le cambio el contenido al segundo
   mensaje (paso de repetir la pregunta a mandar una frase de relleno
   tipo "Quedo atento a...") — no cerro el segundo canal.
2. Segunda ronda: agrego una herramienta de control de flujo nueva,
   `enter_waiting`, que el agente llama explicitamente para cerrar su
   turno — funciono para las primeras 1-2 preguntas de la conversacion,
   pero de la tercera pregunta en adelante el agente seguia llamando
   `send_notification_to_user` dos veces (con dos redacciones distintas
   de la misma respuesta) antes de llegar a `enter_waiting` — o sea,
   `enter_waiting` resolvia cuando terminar el turno, pero no habia un
   limite duro de cuantas veces se podia enviar un mensaje dentro de
   ese turno.
3. Tercera ronda: se le pidio explicitamente un limite duro (no una
   instruccion de texto) de un solo envio por turno. **Confirmado
   funcionando por el usuario con una conversacion de prueba real** —
   cada turno manda ahora un solo mensaje, de principio a fin.

Como red de seguridad adicional (no reemplaza el arreglo de
plataforma), se agrego una regla nueva en la seccion 14 de
`docs/isa-v2-system-prompt.md`: nunca reformular ni reenviar la misma
respuesta dentro de un turno, ni agregar un mensaje de cierre/relleno
despues de la respuesta real.

**Leccion para la proxima vez que aparezca un problema de mensajes
duplicados o de comportamiento del agent node en este proyecto:**
pedirle a Kapso un limite duro de plataforma en vez de conformarse con
un ajuste de contenido o una instruccion de texto — un LLM puede
"decidir" que dos mensajes son mejor que uno en un turno especifico
aunque el prompt diga lo contrario; los primeros dos intentos de Kapso
lo confirmaron (cambiaron el sintoma, no la causa) hasta que se les
pidio explicitamente una restriccion tecnica.

**Ajustes de tono relacionados, mismo dia** (`docs/isa-v2-system-prompt.md`):
- **Mensaje de bienvenida (seccion 2):** ahora incluye un gancho corto
  de valor en el mismo primer mensaje ("te ayudo a armar tu cotizacion
  y a agendarte con un Ejecutivo Comercial experto"), pedido explicito
  del usuario — antes solo saludaba y confirmaba el nombre, sin decir
  que hace Isa.
- **Formato de opciones (secciones 6 y 10):** paso de vinetas (•) a
  lista numerada (1., 2., 3...) — el usuario prefiere las listas
  numeradas. Aplica a la pregunta de `tipo_proyecto` y a la regla
  general de cualquier pregunta con opciones.

**Segunda ronda de tono, misma noche — "que no se sienta IA".** El
saludo de la ronda anterior ("soy Isa, tu asesora virtual de Espazios")
seguia sonando a bot segun el usuario. Se itero varias veces en vivo
con el ejemplo exacto hasta llegar a: "hablas con Isa de Espazios. Te
puedo ayudar con una cotizacion ilustrativa, y si te llama la atencion,
te conecto con un Ejecutivo Comercial especialista en acabados para una
cotizacion mas personalizada." + confirmacion de nombre — sin la
palabra "asesora virtual" en ningun lado. Ademas, 2 reglas de
puntuacion nuevas en la seccion 10, aplicadas a todos los ejemplos del
prompt: (1) nunca signo de apertura ¿/¡, solo el de cierre (? o !) —
como escribe la mayoria de la gente real en WhatsApp en Colombia; (2)
mayuscula inicial opcional en cada mensaje. Ninguno de estos cambios
toca reglas de negocio, orden de variables, filtros, precios ni logica
de agendamiento — son puramente de tono/estilo. Pendiente: el usuario
debe probar esto en Kapso y confirmar que el tono se sienta mas
humano/menos detectable como IA.

**Bug real encontrado con captura de WhatsApp, mismo dia — lista de
tipo_proyecto se veia mal.** El usuario mando una captura de la
conversacion real (todavia con el prompt viejo en Kapso, sin los
cambios de arriba pegados aun): la pregunta de tipo_proyecto se via
como un bloque de texto en vez de una lista limpia. Causa raiz: cada
opcion tiene una descripcion larga entre parentesis, y WhatsApp no
sangra la linea cuando una opcion se parte en 2-3 lineas — las lineas
de continuacion quedan al mismo margen que el inicio de la siguiente
opcion, mezclando visualmente todo. Confirmado que **no era un
problema de vineta (•) vs. numero (1.)** — el wrap pasa igual con
cualquiera de los dos formatos, asi que cambiar a lista numerada
(cambio de la ronda anterior) no lo iba a arreglar por si solo.
Arreglo real: acortar la descripcion entre parentesis de cada una de
las 4 opciones (secciones 6 y 10 de `docs/isa-v2-system-prompt.md`) y
agregar una regla general de mantener las opciones cortas por esta
misma razon — las 4 categorias y su significado de negocio no
cambiaron, solo el texto explicativo. Pendiente: el usuario aun no ha
pegado ningun cambio de esta sesion en el prompt real de Kapso (la
captura confirma que sigue con "asesora virtual", vinetas y "¿" de
apertura) — falta esa sincronizacion antes de poder probar todo esto
junto.

**Verificacion de fidelidad de copia + version final consolidada,
mismo dia.** El usuario copio el prompt real desde Kapso (desde el
celular) y lo pego para verificar. Se comparo palabra por palabra
contra la ultima version sincronizada en el repo (antes de los ajustes
de tono de esta sesion): coincide 100%, sin faltantes — las unicas
diferencias eran de formato de markdown (negrillas, numeracion,
subtitulos) que el copiado desde celular no conserva, ya documentado
como inofensivo. Confirma tambien, de nuevo, que Kapso sigue con la
version anterior a todos los ajustes de tono de esta sesion. Con esto
confirmado, `docs/isa-v2-system-prompt.md` se marco como la
**version final consolidada lista para pegar** — se corrigio ademas
el ultimo leftover pendiente (`guardar_lead` sin `_db` en el cierre de
la seccion 9, que se habia dejado a proposito por fidelidad en rondas
anteriores) para que las 4 menciones de la herramienta en el prompt
sean consistentes. Pendiente: el usuario debe copiar las secciones
1-14 del archivo y reemplazar el prompt completo en el agent node de
Kapso.

**3 bugs nuevos encontrados y arreglados, misma sesion, revisando una
prueba real posterior (conversacion con Yonathan Murillo via el MCP de
Kapso, `whatsapp_messages`) — la version que fallo en esa prueba era la
version vieja todavia vigente en Kapso, anterior a toda la ronda de
tono de arriba, no la version final consolidada (que seguia sin pegarse
en Kapso).**

1. **Saludo no uso el nombre de perfil real.** Isa fue directo al
   fallback "con quien tengo el gusto?" aunque el usuario confirmo que
   el nombre de perfil de WhatsApp si estaba disponible. Arreglo en
   `docs/isa-v2-system-prompt.md` seccion 2: instruccion explicita de
   llamar `get_whatsapp_context` **siempre** antes del primer mensaje —
   nunca asumir que no hay nombre sin haberlo consultado.
2. **Saludo reescrito**, a pedido del usuario, con un borrador nuevo
   mas corto ("Hola, hablas con Isa de Espazios — te acompañamos con
   acabados y remodelacion de tu vivienda. Te tomo unos datos, te
   comparto una cotizacion ilustrativa, resolvemos dudas y agendamos
   una sesion para personalizarla.") manteniendo la confirmacion de
   nombre en el mismo mensaje. Excepcion nueva a la regla de "mayuscula
   inicial opcional" (seccion 10): el usuario pidio que este primer
   mensaje puntual si arranque en mayuscula, a diferencia del resto de
   la conversacion. Se agrego tambien el manejo de "el nombre que
   confirme no es el correcto" (el cliente corrige — se acepta sin
   insistir y se guarda el nombre correcto).
3. **Bug de entrega incompleta de las 2 imagenes del estimado.** En la
   prueba real, con `tipo_proyecto` ya en "Remodelacion Total" (el
   cliente ya lo habia elegido), Isa solo mando la tarjeta general y
   luego pregunto "cual de los 3 paquetes" nombrando los 3 (incluido el
   ya elegido) — el cliente protesto ("ya te dije que remodelacion
   total"). Isa afirmo despues haber mandado el detalle sin mandarlo
   realmente, y solo llego (sin la imagen general junto, como un
   mensaje separado) tras un segundo reclamo del cliente ("no me has
   enviado nada"). Arreglo en la seccion 6.1: secuencia obligatoria de
   2 pasos en el mismo turno (imagen general → imagen de detalle del
   paquete ya elegido, sin pregunta intermedia ni depender de que el
   cliente la pida), y la pregunta de seguimiento ahora nombra
   explicitamente solo los paquetes que faltan por ver, nunca el que
   ya se mostro.

Los 3 cambios son de confiabilidad de ejecucion (que Isa efectivamente
haga lo que el prompt ya pedia, mas explicito sobre el saludo) — no
tocan reglas de negocio, orden de variables, filtros de
cobertura/presupuesto ni precios.

**Actualizacion, mismo dia — el usuario si pego esa version en Kapso, y
la siguiente prueba real confirmo el saludo arreglado pero encontro bugs
nuevos y mas graves.** Se revisaron 3 conversaciones de prueba seguidas
con Yonathan Murillo (`aefb5660...`, `8c446fb4...`, `63356834...`, via
`whatsapp_messages` y `search_logs` del MCP de Kapso). El saludo ya usaba
bien el nombre de perfil real ("Hola, hablas con Isa de Espazios...
Tengo el gusto con Yonathan Murillo?") — bug 1 de la ronda anterior
resuelto. Pero aparecieron 3 bugs nuevos, ordenados de mas a menos
grave:

1. **CRITICO, de plataforma, no de prompt — la conversacion pierde todo
   el contexto despues de cada respuesta.** `search_logs`
   (`flow_event`, `execution_ended`) muestra que las 3 conversaciones
   terminaron con `reason: "reached_terminal_node"` justo despues de que
   el agente llamo la herramienta **`complete_task`** (un tool de
   control de flujo del agent node, no uno nuestro) — eso termina la
   ejecucion del Workflow por completo, y el siguiente mensaje del
   cliente arranca una `whatsapp_conversation_id` **nueva**, sin memoria
   de nada (nombre, ciudad, tipo de proyecto, ni siquiera el
   agendamiento ya confirmado). Esto explica toda la frustracion real de
   Yonathan en la prueba ("me haces escribir mucho. Cosas que ya te
   habia escrito", "ya te dije todo eso", "no me hagas repetir") — Isa
   se re-presentaba de cero cada vez a alguien con quien ya llevaba
   media conversacion. **No se puede arreglar solo en el prompt** —
   `complete_task` no es un tool nuestro, no se puede quitar desde
   `docs/isa-v2-system-prompt.md`. Hay que pedirle al asistente de IA de
   Kapso que revise por que el agente llama esa herramienta despues de
   una respuesta normal (o que el Workflow no termine el flujo cuando se
   llama) — mismo mecanismo que resolvio el bug de doble mensaje. Se
   agrego una regla en la seccion 14 del prompt pidiendole a Isa que
   nunca cierre la tarea salvo despedida explicita del cliente, como
   mitigacion parcial mientras se resuelve del lado de Kapso — pero por
   la experiencia con `enter_waiting` (que tampoco se siguio siempre solo
   con texto), es probable que no baste sin el ajuste de plataforma.

   **RESUELTO a nivel de plataforma, 2026-09-05 noche.** Se le paso al
   asistente de IA de Kapso la evidencia exacta (los 3
   `whatsapp_conversation_id`, el `flow_execution_id`, y las citas de
   frustracion de Yonathan), pidiendole analizar y ajustar el Workflow,
   no solo explicar — mismo patron que funciono con el bug de doble
   mensaje. Confirmo la causa exacta: en la ejecucion
   `60daf216-2452-4085-b4b9-beb79d6ff381` las variables si se habian
   guardado bien y `guardar_lead_db` respondio correctamente, pero justo
   despues de la confirmacion de la reunion el agente llamo
   `complete_task`, que **termina la ejecucion completa** (no solo el
   turno) — de ahi que el siguiente mensaje no pudiera reanudarla ni sus
   variables, y el trigger `inbound_message` creara una ejecucion nueva
   de cero. Documentado por Kapso: `complete_task` finaliza/avanza el
   workflow; `enter_waiting` pausa la ejecucion y la reanuda con el
   siguiente mensaje manteniendo el contexto — son mecanismos distintos,
   y el Workflow dejaba que el agente eligiera libremente entre los dos.

   Arreglo aplicado directo en el grafo del Workflow (`lock_version: 82`):
   regla explicita de usar `enter_waiting` despues de cualquier respuesta
   normal/confirmacion/imagen/guardado/agendamiento y nunca
   `complete_task` tras confirmar una cita, y sobre todo, **se retiro
   `complete_task` de `enabled_default_tools`** — el agente ya no puede
   llamarlo ni por accidente (`enter_waiting` y `handoff_to_human` siguen
   habilitados). Es un cambio de plataforma real, no un parche de texto —
   la mitigacion de la seccion 14 del prompt queda redundante pero se
   deja como red de seguridad. **Pendiente confirmar con una prueba real
   de WhatsApp** (Kapso no puede simular una conversacion interactiva
   desde sus propias herramientas): iniciar conversacion, llegar hasta
   confirmar un agendamiento, mandar otro mensaje despues, y verificar
   que la misma ejecucion siga viva (sin `complete_task` ni
   `execution_ended`) con todas las variables y la cita ya confirmada
   disponibles. Tambien se le pregunto por el mensaje suelto "Parece que
   olvidaste responder..." — no encontro coincidencia en los logs, sigue
   sin causa confirmada, prioridad baja.
2. **Bug de datos — el estimado se genero sin presupuesto real, sin
   plazo, sin correo.** El cliente nunca dio un presupuesto en pesos
   (escribio "40m", que es area, dos veces, confundido por la secuencia
   de preguntas) y aun asi el flujo avanzo, saltandose
   presupuesto/plazo/correo, y llamo `generar_estimado_ilustrativo` justo
   despues de `conjunto_o_barrio` — viola la regla de la seccion 6.1 (los
   8 datos completos y con valor real antes del estimado). Arreglo:
   seccion 6.1 ahora pide verificar explicitamente que los 8 datos
   tienen un valor coherente antes de llamar la herramienta, y seccion
   14 agrega la regla de nunca reinterpretar en silencio una respuesta
   que no corresponde a la pregunta hecha (aclarar y volver a preguntar
   en vez de avanzar el dato).
3. **Bug funcional — reunion presencial tratada como llamada, con una
   imagen reciclada como "confirmacion".** El diseno de la seccion 9
   dice que para reunion presencial se comparte la direccion de la
   oficina + el mismo link de Google Calendar Appointment Schedule (el
   cliente agenda el horario ahi, igual que en reunion virtual) — pero
   Isa en la prueba pregunto "que dia te queda bien" por texto (como si
   fuera llamada), y al responder el cliente mando una imagen
   ("Confirmacion: agende la reunion presencial...") que resulto ser la
   **misma imagen ya enviada antes** (el detalle del paquete
   Remodelacion Total) — nunca dio la direccion hasta que el cliente
   reclamo. Arreglo: el paso 4 de la seccion 9 ahora contrasta
   explicitamente presencial contra llamada (no preguntar dia/hora por
   texto, nunca auto-confirmar ni mandar imagen), reforzado tambien en
   la seccion 14 (confirmar agendamiento es siempre texto, nunca una
   imagen reciclada de otro momento).

Tambien se vio (una vez) un mensaje de texto "Parece que olvidaste
responder la ultima pregunta" enviado justo despues de que el cliente si
habia respondido (a otra pregunta) — no aparece en nuestro prompt en
ningun lado; no se pudo confirmar la causa exacta con los logs
disponibles, vale la pena mencionarselo a Kapso junto con el hallazgo #1
si vuelve a aparecer. Y persiste la regresion de puntuacion (el signo de
apertura ¿ sigue apareciendo en varios mensajes de esta prueba pese a la
regla ya explicita en la seccion 10) — igual que el bug de las 2
imagenes de la ronda anterior, la regla existe pero el modelo no la sigue
siempre; no se encontro un arreglo adicional de prompt para esto.

Todos los arreglos de esta entrada son de confiabilidad/validacion de
datos y de la mecanica de agendamiento presencial — no tocan el orden de
variables, los filtros de cobertura/presupuesto, ni los precios. El
hallazgo #1 (perdida de contexto) es, con evidencia, el mas grave de todo
lo visto hasta ahora en pruebas reales — mas que el bug de doble mensaje
ya resuelto — porque hace que **cualquier conversacion de mas de un par
de turnos pueda reiniciarse sola** sin que el cliente haga nada raro.
Pendiente: (a) el usuario debe pegar esta version del prompt en Kapso —
el hallazgo #1 (`complete_task`) ya se resolvio del lado de Kapso (ver
arriba), pero (b) todavia falta una prueba real de WhatsApp que lo
confirme.

**Actualizacion 2026-09-06 — version pegada en Kapso, confirmada por
fidelidad de copia.** El usuario copio las secciones 1-14 completas
desde Kapso y las pego para verificar; se comparo palabra por palabra
contra `docs/isa-v2-system-prompt.md` (diff automatizado, ignorando solo
diferencias de formato markdown que el copiado no conserva): **coincide
al 100%**, sin faltantes — la tabla de proyectos de TikTok (seccion 11)
no vino en la copia pegada al chat por su tamano, no porque falte en
Kapso. Confirma que ya esta en produccion: el saludo con nombre de
perfil real, la verificacion de los 8 datos antes del estimado, el
envio obligatorio de las 2 imagenes sin repetir el paquete ya elegido,
el manejo correcto de reunion presencial, y las 3 reglas nuevas de la
seccion 14. Sigue pendiente solo la prueba real de WhatsApp que
confirme que el contexto ya no se pierde entre mensajes (el arreglo de
`complete_task` en si ya esta confirmado del lado de Kapso, ver arriba
— falta la confirmacion end-to-end).

## Seguimiento automatico por inactividad — ESPECIFICADO, PENDIENTE DE QUE KAPSO LO CONSTRUYA, 2026-09-06

El usuario reporto que hay clientes reales que dejan a Isa esperando una
respuesta por mas de 10 minutos, sin que nadie retome el contacto.
Verificado en vivo revisando `whatsapp_conversations` (estado "active"):
en una sola muestra de 10 conversaciones recientes, **6 estaban esperando
respuesta ahora mismo**, entre 69 y 195 minutos (mas de 3 horas), cada
una en un punto distinto del flujo (presupuesto, correo, confirmar
nombre, tipo de agendamiento, una oferta de video sin retomar) — leads
reales, algunos con presupuesto y tipo de proyecto ya capturados,
enfriandose solos. No es un caso raro — parece ser el patron normal.

Esto es mas amplio que el item 4 del roadmap original ("seguimiento
automatico ~10 min despues de compartir el link/franja de
agendamiento") — el usuario pidio que cubra **cualquier pregunta sin
responder**, no solo el momento de agendar. La razon tecnica del
roadmap original para requerir `kapso-client.ts` + `KAPSO_API_KEY`/
`KAPSO_PHONE_NUMBER_ID` era que "el agent node no puede hacer esto solo
porque solo reacciona cuando el cliente escribe, no puede 'despertar'
solo despues de un tiempo" — pero eso se escribio antes de que se
descubriera `enter_waiting` (el mecanismo de control de flujo que
Kapso agrego para el bug de doble mensaje, y que tambien resolvio el
bug de `complete_task`/perdida de contexto, ver arriba). Como
`enter_waiting` ya deja una ejecucion pausada "esperando" en vez de
terminada, vale la pena preguntarle a Kapso directamente si ese estado
de espera soporta un timeout nativo de inactividad antes de construir
nuestro propio mecanismo.

**Se le mando esta pregunta al asistente de IA de Kapso, con la
evidencia de arriba** (las 6 conversaciones activas y sus minutos de
espera exactos), pidiendo:
1. Si el agent node/Workflow tiene un mecanismo nativo de timeout que
   despierte una ejecucion en `waiting` despues de N minutos sin
   mensaje entrante, y si aplica a cualquier punto de la conversacion
   (no solo tras un link de agendamiento).
2. Como configurarlo si existe (nodo de tipo timer/delay, propiedad del
   agent node, Workflow settings) y si el timeout es parametrizable.
3. Si no existe nada nativo, cual es la forma soportada de detectar
   ejecuciones inactivas — para no reinventar algo que Kapso ya
   resuelve, antes de activar `kapso-client.ts`.
4. La redaccion del mensaje de seguimiento en si ya esta resuelta en el
   prompt (seccion 10, "si retomas el contacto despues de un tiempo sin
   respuesta") — falta solo el disparador.

**Hallazgo aparte, sin resolver:** el mismo `whatsapp_config_id`
(`8d9286a3-4e43-415e-8b85-6b19cab418f6`) tiene conversaciones con el
formato viejo de listas interactivas (botones de WhatsApp — Zuluaga,
Villa Pinn, Yesid Barreto) mezcladas con conversaciones en texto libre
con negrilla tipo Isa v2 (Yonathan Murillo, John Moreno) — no esta
claro si ese numero ya corre ambos Workflows en paralelo o que esta
pasando ahi. Se incluyo como nota aparte en el mensaje a Kapso; no se
investigo mas a fondo por no ser el foco de esta sesion.

**Pendiente:** respuesta de Kapso. Segun lo que digan, el siguiente
paso es o bien configurar el timeout nativo, o activar
`kapso-client.ts` con las credenciales ya guardadas en `.env` local
(`KAPSO_API_KEY`; falta `KAPSO_PHONE_NUMBER_ID`).

**Especificacion final, mismo dia — el usuario definio la logica de
negocio completa y pidio que la construya directamente la IA de
Kapso** (no nuestro propio `kapso-client.ts`). Reemplaza el alcance
amplio de arriba ("cualquier pregunta sin responder") por uno acotado:

- **Alcance, corregido tras una segunda pasada con el usuario (via
  `AskUserQuestion`): cualquier pregunta pendiente desde el saludo
  hasta que la sesion queda agendada, sin excepcion** — no solo
  calificacion (nombre...correo, secciones 5-6.1) y logistica de
  agendamiento (tipo, dia/horario, espera de confirmacion del link),
  sino tambien las 2 preguntas de la seccion 9 que quedaron afuera en
  la primera version de esta especificacion: "tienes alguna duda, o te
  gustaria que agendemos..." y "prefieres una llamada o una reunion?".
  Sigue sin aplicar a momentos que no bloquean el objetivo (invitacion
  a ver detalle de un paquete, respuestas de FAQ) porque ahi no hay un
  dato/decision pendiente que impida llegar a agendar.
- **Secuencia de reintentos:** 1er seguimiento a los 10 min de la
  pregunta/accion sin respuesta; 2do a las 4 horas habiles despues del
  1ro; 3ro a las 8 horas habiles despues del 2do; si sigue sin
  responder tras el 3ro, **cerrar la conversacion** con un mensaje tipo
  "aqui estoy cuando me necesites" (anclado al contexto, reglas de tono
  ya existentes en la seccion 10 del prompt). "Horas habiles" = 7am-7pm
  hora Colombia (America/Bogota, UTC-5) — el conteo se pausa fuera de
  esa ventana y sigue al abrir la siguiente. Cualquier respuesta del
  cliente en cualquier punto cancela la cadena de seguimientos
  pendiente.
- **Requisito no negociable: el cierre debe conservar el contexto.**
  Confirmado con el usuario explicitamente (via `AskUserQuestion`) que
  esto es obligatorio, no opcional — si el cliente escribe dias
  despues de un cierre, Isa debe recordar todo (nombre, ciudad, datos
  ya capturados, en que punto se quedo), nunca volver a preguntar desde
  cero. Se le advirtio explicitamente a Kapso en el mensaje que **no
  use `complete_task` ni equivalente** para este cierre — necesita el
  mismo tipo de estado que `enter_waiting` ya garantiza (pausado con
  contexto intacto), dado el bug real que ya vivimos con exactamente
  este problema (ver "RESUELTO a nivel de plataforma" mas arriba).
- **Requisito de fiabilidad: conteo y disparo deterministicos, no a
  criterio del modelo.** Tambien confirmado explicitamente con el
  usuario (via `AskUserQuestion`) — el Workflow debe controlar cuantos
  intentos van y cuando disparar cada uno, igual que se tuvo que hacer
  con el limite duro del bug de doble mensaje (una instruccion de texto
  sola no basta). Lo unico que se deja al criterio del agente es la
  redaccion de cada mensaje de seguimiento y del mensaje de cierre —
  eso ya lo sabe hacer con las reglas de tono existentes.
- **Recordatorio de negocio incluido en el mensaje a Kapso:** cada
  seguimiento debe seguir empujando hacia el objetivo de agendar (ej.
  si se quedo en presupuesto, el seguimiento invita a responder eso
  para avanzar; si se quedo esperando confirmar el agendamiento por
  link, el seguimiento pregunta directamente si ya lo hizo) — no son
  solo recordatorios pasivos de "sigues ahi?".
- Se le pidio a Kapso ademas que confirme: (1) que mecanismo de
  timer/delay usar en el grafo para disparar esto en los momentos
  exactos, (2) si existe un estado de "cierre amigable pero con
  contexto conservado" distinto de `complete_task` y de `waiting`
  indefinido, y (3) como se maneja la ventana de 24h de mensajes
  salientes de WhatsApp para estos seguimientos (si algun caso cae
  fuera de esa ventana, si hace falta una plantilla pre-aprobada por
  Meta en vez de texto libre).

**Pendiente:** respuesta de Kapso con esta especificacion completa.

**Respuesta de Kapso, mismo dia — plan de arquitectura hibrida
confirmado como viable, aprobado por el usuario para construir
completo.** Kapso confirmo que el timing exacto de horas habiles SI se
puede lograr, pero requiere una arquitectura hibrida (no solo el
Workflow): el Workflow conserva contexto/estado, y un **scheduler
externo** controla el reloj. Sin ese scheduler, la unica alternativa es
una version degradada con `wait_for_response` (10min / 4h / 8h de
**reloj**, no de horas habiles) — el usuario no acepto ese atajo,
confirmo seguir con el plan completo.

Arquitectura propuesta por Kapso:
1. **Workflow**: `enter_waiting` habilitado, `complete_task` fuera;
   variables de estado deterministico
   (`followup_attempt`, `followup_state`, `pending_action`,
   `last_question_at`, `followup_chain_id`) controladas por el
   Workflow, no por criterio del agente — el agente solo redacta texto
   (pregunta, seguimientos, cierre).
2. **Tabla D1 nueva** `conversation_followups` (conversation_id,
   phone_number, execution_id, chain_id, pending_action, attempt,
   status [pending/cancelled/sent/closed], next_due_at,
   business_timezone, last_customer_message_at, timestamps) —
   `conversation_id + chain_id` unico para evitar duplicados.
3. **Funcion de scheduling** (Kapso Function): calcula la proxima fecha
   en `America/Bogota`, cuenta solo lunes-viernes 7am-7pm, programa los
   3 intentos, idempotente por `chain_id`.
4. **Scheduler externo** — **decision del usuario: Cloudflare Workers
   Cron/Queues**, mismo stack que ya usa `guardar-lead-isa-v2` (D1), en
   vez de agregar un proveedor nuevo (n8n u otro) sin necesidad clara.
   Revisa D1 cada minuto, busca cadenas `pending` vencidas, valida que
   el cliente no haya respondido y que el `chain_id` siga vigente, y
   reanuda la ejecucion via
   `POST /platform/v1/workflow_executions/{execution_id}/resume` —
   maneja `409` (solo una reanudacion pendiente por ejecucion a la
   vez).
5. **Respuesta del cliente en cualquier punto** cancela la cadena
   (`status: cancelled`) — la ejecucion en `waiting` se reanuda normal,
   sin enviar seguimientos pendientes.
6. **Ventana de 24h de WhatsApp**: si el ultimo mensaje del cliente
   tiene mas de 24h, hace falta una plantilla pre-aprobada por Meta en
   vez de texto libre — si no hay plantilla adecuada, el seguimiento
   queda bloqueado y visible para revision manual, nunca se manda texto
   libre fuera de la ventana. **Decision del usuario: iniciar el
   proceso de aprobacion de la plantilla en Meta YA, en paralelo a la
   construccion del resto** — la revision de Meta puede tardar dias y
   no debe quedar como el ultimo paso bloqueando el lanzamiento.

Orden de construccion de Kapso (7 pasos): confirmar scheduler (ya
decidido: Cloudflare) → tabla D1 + funcion → cambios al Workflow →
worker/endpoint que reanuda cadenas vencidas → aprobar plantilla de
WhatsApp → pruebas en staging (respuesta antes/despues de cada
seguimiento, los 3 timeouts, cruce 19:00→7:00, fin de semana, ventana
de 24h vencida, respuesta dias despues del cierre) → produccion con
limite de seguridad y logs por cadena.

**Confirmado con el usuario (via `AskUserQuestion`) y comunicado a
Kapso:** (1) scheduler = Cloudflare Workers Cron/Queues; (2) arrancar
la aprobacion de la plantilla de Meta desde ya, no al final; (3)
proceder con el plan completo, sin la version degradada de
`wait_for_response`.

**Pendiente:** que Kapso proponga un borrador de texto para la
plantilla de WhatsApp (para revisar antes de someterla a Meta), que
confirme si las pruebas de staging las corre solo o necesita
participacion nuestra simulando mensajes reales, y que reporte avance
por etapas del plan de 7 pasos (no todo de un solo golpe, dado que
toca infraestructura nueva).

**Avance de Kapso, paso 2 de 7 — bloqueo real encontrado + resuelto con
un cambio de enfoque, mismo dia.** Kapso completo: verifico que
Cloudflare Workers + D1 es compatible con el stack, confirmo el
endpoint de resume
(`POST /platform/v1/workflow_executions/{execution_id}/resume`,
header `x-api-key`), confirmo que `enter_waiting` conserva contexto, y
**creo la tabla `conversation_followups`** (estado+intento, `chain_id`
idempotente, execution/conversation, `next_due_at`, timezone,
timestamps de cliente/envio/cierre, indices para vencimientos).

**Bloqueo real:** las herramientas de Kapso permiten crear y desplegar
Kapso Functions individuales y editar el grafo del Workflow, pero **no
exponen** configurar un Worker independiente con `scheduled()` para
Cron, ni crear/bindear Cloudflare Queues, ni desplegar un scheduler
externo que corra cada minuto. Kapso fue explicito en no simular un
Cron con una funcion normal (quedaria desplegada pero nunca se
ejecutaria sola) ni en dejar el Workflow a medias fingiendo que la
cadena de seguimiento es fiable si no lo es.

**Resuelto con un cambio de enfoque, no con infraestructura nueva:**
en vez de que Kapso necesite un Cron/Queue de Cloudflare, se decidio
usar el servidor que **ya corre 24/7 en Railway** (`tools-server.ts`,
el mismo que atiende `/tools/estimado-ilustrativo`) como el
"scheduler externo". Kapso construye **una sola Kapso Function nueva**
(`process-followups`, protegida por un secret compartido tipo
`X-API-Key`, mismo patron que `REPORT_TOKEN` en
`leads-reporte-isa-v2`) que, al recibir un POST, hace todo lo que ya
describio en el paso 4 de su plan (buscar cadenas vencidas, validar,
llamar al endpoint de resume, marcar estado). El disparo cada minuto
no viene de un Cron de Cloudflare — viene de un scheduler interno
simple que se agrega a `tools-server.ts` en Railway, que le hace un
POST a `process-followups` una vez por minuto. Cero infraestructura
nueva que crear o mantener, y evita por completo el bloqueo de
Cron/Queues.

**Confirmado con el usuario (via `AskUserQuestion`):** (1) scheduler =
Railway/`tools-server.ts` en vez de un Worker de Cloudflare nuevo; (2)
plantilla de WhatsApp aprobada tal cual, categoria `utility`, nombre
`isa_seguimiento_agendamiento` — Kapso puede someterla a revision de
Meta ya.

**Pendiente:**
1. Confirmacion de Kapso de que el enfoque de Railway como scheduler
   funciona de su lado, y que despliegue `process-followups` con la
   URL publica de invocacion y el contrato exacto (que mandar en el
   POST, que devuelve).
2. Una vez tengamos eso: agregar el scheduler interno a
   `tools-server.ts` (llamada HTTP cada minuto a `process-followups`
   con el secret) y guardar ese secret como variable de entorno nueva
   en Railway.
3. Que Kapso someta la plantilla `isa_seguimiento_agendamiento` a
   revision de Meta (categoria `utility`).
4. Ronda de pruebas reales de WhatsApp (confirmado que participamos):
   entrega del mensaje, cancelacion de cadena al responder, retencion
   de contexto tras el cierre.

**Avance de Kapso, paso 4 de 7 — funciones desplegadas + plantilla
sometida a Meta, mismo dia.** Kapso completo:

- **`register-followup`** — Kapso Function nueva, ya agregada como tool
  del agent node ("la herramienta ya está agregada al agente"). Registra
  una cadena de seguimiento nueva (cancela la anterior de esa
  conversacion si habia una), agenda el primer intento a los 10 minutos.
- **`process-followups`** — la funcion "scheduler tick": autentica por
  header compartido, busca filas vencidas en `conversation_followups` de
  forma idempotente, valida que el cliente no haya respondido, reanuda
  la ejecucion via el endpoint de resume de la plataforma, avanza el
  intento o cierra la cadena tras el tercero, calculando la siguiente
  fecha dentro de horas habiles.
- **Tabla D1 `conversation_followups`**: confirmada existente y con el
  esquema descrito en el paso 2 (conversation_id, phone_number,
  execution_id, chain_id, pending_action, attempt, status, next_due_at,
  business_timezone, last_customer_message_at, timestamps).
- **Contrato HTTP exacto de `process-followups`** (invocable
  publicamente):
  ```
  POST https://api.kapso.ai/platform/v1/functions/476eba19-0c54-4d0c-9b3d-2ddb65306aa6/invoke
  x-api-key: <FOLLOWUPS_PROCESS_TOKEN>
  content-type: application/json

  {"limit": 50, "source": "railway_scheduler", "scheduler_run_id": "<ISO timestamp>"}
  ```
  Respuesta de exito: `{"ok": true, "now": ..., "scanned": N, "processed": [...], "skipped": [...]}`.
  Errores: `401` (secret invalido), `405` (metodo incorrecto), `500
  missing_kapso_api_key` (falta configurar `KAPSO_API_KEY` en la
  funcion). **Header es `x-api-key`, no `authorization`** — aclarado
  explicitamente por Kapso.
- **Secrets nuevos requeridos**: `FOLLOWUPS_PROCESS_TOKEN` (el mismo
  valor debe quedar configurado en Kapso, en la funcion
  `process-followups`, Y en Railway, como env var de `tools-server.ts`)
  + `KAPSO_API_KEY` (solo en la funcion de Kapso, ya la tienen). Kapso
  pidio generarlo sin compartirlo con su chat — se genero localmente
  (`openssl rand -hex 32`) y quedo solo en `.env` local (no committeado)
  y pendiente de pegar en Railway y en la funcion de Kapso.
- **Plantilla de WhatsApp sometida a Meta**: `isa_seguimiento_agendamiento`,
  categoria `utility`, idioma `es_CO`, ID de plantilla en el dashboard de
  Kapso `2320766545443667`, estado `submitted` (revision de Meta puede
  tardar dias). Cuerpo: "hola {{1}}, retomamos tu proceso de cotización
  para {{2}}. nos falta {{3}} para poder avanzar y agendar tu sesión con
  el equipo de espazios. cuando puedas, respóndeme por este medio." —
  parametros: 1) nombre del cliente, 2) referencia del proyecto, 3) dato
  o accion pendiente.
- **2 validaciones pendientes que Kapso pidio antes de considerar la
  integracion completa**: (a) que el scheduler de Railway quede
  configurado y activo (para eso pidio avisar con "scheduler activo"
  una vez lo confirmemos), y (b) que el prompt real de Isa instruya
  llamar `register-followup` en los momentos correctos, antes de
  `enter_waiting`.

**Hecho en esta sesion, mismo dia, en respuesta a lo anterior:**
- **`tools-server.ts`**: agregado el scheduler interno (`setInterval`
  cada 60s) que le pega a `FOLLOWUPS_PROCESS_URL` con header `x-api-key:
  FOLLOWUPS_PROCESS_TOKEN` y el body recomendado por Kapso. Si cualquiera
  de las 2 variables de entorno esta vacia, el scheduler queda
  deshabilitado con un log de warning en vez de romper el servidor (asi
  no bloquea el resto de `tools-server.ts` mientras se termina de
  configurar en Railway).
- **`.env.example`**: documentadas `FOLLOWUPS_PROCESS_URL` y
  `FOLLOWUPS_PROCESS_TOKEN`.
- **`docs/isa-v2-system-prompt.md`**: agregada una regla nueva a la
  seccion 14 instruyendo llamar `register-followup` despues de
  cualquier pregunta pendiente de calificacion (secciones 5-6.1) o de
  agendamiento (seccion 9), justo antes de terminar el turno —
  redactada de forma generica (el "cuando" y el "para que", no los
  nombres de campos exactos) porque todavia no tenemos el schema
  preciso de parametros de la herramienta tal como Kapso la registro en
  el agent node. Marcada explicitamente en el banner del archivo como
  **pendiente de pegar en Kapso** — no pegar hasta confirmar el schema
  exacto de `register-followup` y que el scheduler de Railway este
  activo.
- **Hecho por el usuario, mismo dia:** `FOLLOWUPS_PROCESS_TOKEN`
  (`4fdc2f9e...53d`, ver `.env` local) ya quedo pegado en las variables
  de entorno de Railway y en la funcion `process-followups` de Kapso —
  mismo valor en los dos lados.
- **Verificado en logs de Railway, mismo dia (captura de pantalla del
  usuario):** el scheduler si arranco — aparece la linea "Scheduler de
  seguimientos activo (process-followups cada 1 min)" justo despues de
  "Server listening", y esta llamando cada minuto sin caerse (confirmado
  con 2 intentos seguidos, 18:17:03 y 18:18:04).
- **Pero la funcion no existe en esa URL — `404 Function not found`,
  no es problema de secret.** Cuerpo completo del error:
  `{"error":"Function not found"}`, status `404`, en ambos intentos.
  No es un problema de `FOLLOWUPS_PROCESS_TOKEN` (eso daria `401`) — el
  endpoint mismo
  `https://api.kapso.ai/platform/v1/functions/476eba19-0c54-4d0c-9b3d-2ddb65306aa6/invoke`
  no resuelve a ninguna funcion real. Posibles causas: el ID de funcion
  que dio Kapso esta mal, `process-followups` no quedo realmente
  publicada/deployada bajo ese ID, o el deploy esta en un estado
  distinto (borrador, otro ambiente). **Pendiente: devolverle esto a
  Kapso** — no es algo que se pueda arreglar del lado de Railway/repo,
  necesitan confirmar el ID/URL real de la funcion desplegada.
- **Mandado a Kapso en un solo mensaje, mismo dia:** el hallazgo del 404
  de arriba, JUNTO con la peticion de agregar `register-followup`
  directo en el prompt real (ver "Cambio de plan" abajo) y la pregunta
  sobre si la cancelacion de cadena es automatica — se combinaron en un
  solo mensaje en vez de mandarlos por separado.

**Cambio de plan, mismo dia — la instruccion de `register-followup` la
agrega Kapso directo en el prompt real, no nosotros.** En vez de que
esta sesion le adivine el schema de parametros a `register-followup` y
el usuario tenga que volver a pegar las 14 secciones en Kapso, se le
pidio a Kapso que agregue esa instruccion **directamente en el prompt
real del agent node** — mismo patron que ya usaron para la regla de
`enter_waiting`/`complete_task` (ver "RESUELTO a nivel de plataforma"
mas arriba, tambien fue un cambio que Kapso aplico directo en la
plataforma, no una instruccion nuestra de texto). Kapso ya conoce el
schema real de la herramienta porque la construyeron, asi que no hay
riesgo de que Isa la llame con campos inventados. La regla que se
escribio en la seccion 14 de `docs/isa-v2-system-prompt.md` queda
marcada como **borrador de referencia, no autoritativa** — no se pega
en Kapso. Cuando Kapso confirme el cambio aplicado, hace falta repetir
el proceso de verificacion por fidelidad de copia (copiar el prompt
real de Kapso y compararlo palabra por palabra) para sincronizar este
archivo con lo que quedo en produccion.

**Respuesta de Kapso, mismo dia — 404 explicado + instruccion aplicada
al prompt real, lock version 91.**

1. **404 de `process-followups`:** Kapso confirmo que la funcion existe
   (`id: 476eba19-0c54-4d0c-9b3d-2ddb65306aa6`, `status: deployed`), que
   la URL que nos dieron es la correcta segun su propia documentacion
   (`/platform/v1/functions/{function_id}/invoke`), y forzo un
   redeploy. Su hipotesis: los primeros requests cayeron durante la
   ventana de publicacion asincrona antes de que el runtime quedara
   disponible — consistente con que la funcion no registraba ninguna
   invocacion (ni exitosa ni fallida) de los intentos que si vio
   Railway, o sea esos requests nunca llegaron al worker. **Pendiente:
   volver a revisar los logs de Railway** para confirmar si el 404 ya
   desaparecio tras el redeploy; si persiste, guardar el `request_id`
   de Railway para escalarlo como inconsistencia de su runtime.
2. **Instruccion `register-followup` ya aplicada directo en el
   `system_prompt` del agent node** (Workflow `Isa v2 (IA generativa)`,
   id `9144e40d-cd55-4d3b-a2f2-4a019db39fa6`, `lock_version: 91`) — no
   la escribimos nosotros, como se decidio arriba. Cubre las mismas 12
   preguntas/momentos que pedimos (calificacion completa + dudas-o-
   agendar + tipo de agendamiento + dia/horario de llamada +
   confirmacion de agendamiento por link) y explicitamente EXCLUYE
   invitar a ver detalle de paquetes, FAQ, y contenido informativo.
   Secuencia obligatoria que quedo en el prompt:
   `send_notification_to_user → register-followup → enter_waiting`.
   El payload de creacion es `{"pending_action": "<texto libre>"}`.
3. **Cancelacion NO es automatica** — es una llamada explicita mas que
   Isa debe hacer con `{"action": "cancel"}` ante *cualquier* respuesta
   del cliente (incluida una respuesta a un seguimiento ya enviado); la
   funcion cancela las cadenas en estado `pending`, `processing` y
   `sent` de esa conversacion, y responde sin error si no hay cadena
   activa. **Ojo:** el mensaje de Kapso no deja del todo claro si esta
   instruccion de cancelar tambien quedo escrita en el `system_prompt`
   (lock version 91) junto con la de crear, o si solo describe el
   diseno de la funcion — hay que confirmarlo al leer el prompt real
   (paso siguiente) y, si falta, pedirselo a Kapso en una vuelta mas.
4. **Plantilla de WhatsApp:** sigue en `submitted`, sin cambios,
   pendiente de Meta.

**Pendiente inmediato:**
- Revisar logs de Railway para confirmar que el 404 se resolvio.
- El usuario debe copiar el prompt completo del agent node (secciones
  1-14) y pegarlo aca para el proceso de verificacion por fidelidad de
  copia de siempre — con eso se confirma si la regla de cancelacion
  quedo incluida y se sincroniza `docs/isa-v2-system-prompt.md` con lo
  que Kapso realmente escribio (en vez de con el borrador que
  redactamos nosotros).

**El 404 PERSISTE despues del redeploy de Kapso, descartando su
hipotesis — confirmado con logs de Railway, mismo dia.** Captura de
pantalla del usuario en un deploy nuevo (`d17c71e0`, iniciado
18:35:51): 5 intentos consecutivos del scheduler, uno por minuto,
**todos 404 `{"error":"Function not found"}`** — 18:37:01, 18:37:52,
18:38:52, 18:39:52, 18:40:52. Esto es bastante despues de que Kapso
dijera haber forzado un redeploy de `process-followups`, asi que la
teoria de "ventana de publicacion asincrona" (los primeros requests
cayeron antes de que el runtime quedara listo) queda descartada — el
problema es persistente, no transitorio. **Pendiente: escalar esto de
vuelta a Kapso** con los timestamps de arriba (no hay un campo
`request_id` explicito en nuestro log, solo epoch ms + hostname del
contenedor de Railway — suficiente para que ellos crucen con sus
propios logs del lado de la funcion).
- Confirmar a Kapso "scheduler activo" una vez el 404 este resuelto.

## Pendiente de informacion (bloquea partes del flujo)

**Estimado ilustrativo: COMPLETO y probado end-to-end** (autenticacion +
tarifas + render de imagen). Falta conectarlo al agent node de Kapso como
webhook tool (desplegar `tools-server.ts` en una URL publica) — ver abajo.

- [ ] `sync_hubspot`: falta construir. Cuando se haga, mapear `presupuesto`
      (numero exacto, ej. "$15") al rango que espera la propiedad
      `rango_presupuesto` de HubSpot (ej. "Entre $15 y $30 millones").
- [ ] Seguimiento automatico por inactividad (ver seccion arriba):
      `FOLLOWUPS_PROCESS_TOKEN` ya pegado en Railway y Kapso; Kapso ya
      aplico la instruccion de `register-followup` directo en el
      prompt real (lock version 91) y forzo un redeploy de
      `process-followups` para el 404 — falta (a) revisar logs de
      Railway para confirmar que el 404 desaparecio, (b) pegar el
      prompt real aca para verificar por fidelidad de copia si la
      regla de cancelacion (`{"action":"cancel"}`) quedo incluida, (c)
      confirmar a Kapso "scheduler activo", (d) esperar aprobacion de
      Meta de la plantilla
      `isa_seguimiento_agendamiento`; ronda de pruebas reales de WhatsApp.
- [x] ~~Confirmar si la franja horaria de "llamada" en el prompt deberia
      capturar tambien el dia, no solo el horario~~ — resuelto 2026-09-04,
      ver seccion "Base de datos de leads de Isa v2" arriba. Pendiente
      solo el deploy manual de las Kapso Functions.
- [x] ~~`KAPSO_API_KEY`~~ — ya se genero y esta guardada en `.env` local
      (no committeada). Sirve para probar `kapso-functions/*` desde una
      maquina con salida de red a `api.kapso.ai` (esta sesion no la
      tiene). `KAPSO_PHONE_NUMBER_ID` sigue pendiente para cuando se
      construya el envio de seguimientos programados (`kapso-client.ts`).
      **Pendiente: el usuario tambien debe guardar `KAPSO_API_KEY` en
      Railway** si algun dia `tools-server.ts` la necesita.
- [x] ~~Desplegar `kapso-functions/guardar-lead.js` y
      `kapso-functions/leads-reporte.js` en el dashboard de Kapso, y
      declarar `guardar_lead` como tool del agent node de Isa v2~~ —
      hecho y confirmado end-to-end 2026-09-05 (ver "RESUELTO" en la
      seccion "Base de datos de leads de Isa v2" arriba). El bug real
      era conectar `guardar_lead` como "Webhook Tool" en vez de
      "Function Tool" nativo — lo diagnostico y corrigio el propio
      asistente de IA de Kapso, confirmado con 2 invocaciones reales
      exitosas (`function_invocation_event`, status 200) guardando y
      actualizando el mismo lead por telefono, incluida la fecha/hora
      de la llamada agendada.
- [x] ~~Desplegar `src/tools-server.ts` en una URL publica real~~ — hecho,
      corre en Railway (ver arriba).
- [x] ~~Conectar `generar_estimado_ilustrativo` y `ver_detalle_paquete`
      como webhook tools en el agent node de Kapso~~ — confirmado con
      evidencia real 2026-08-31: se vio a Isa recolectar todos los datos
      (incluido `banos`) y llamar la herramienta en una conversacion de
      WhatsApp real con Yonathan Murillo (fallo por el token de Google
      vencido, no por falta de conexion — ver bug critico #2 arriba).
- [x] ~~**Urgente:** renovar el refresh token de Google~~ — hecho
      2026-08-31, confirmado con prueba real por WhatsApp (ver bug
      critico #2 arriba, incluye el paso a paso que si funciono en
      Windows local).
- [x] ~~Decidir y ejecutar la solucion durable para que el token no
      vuelva a vencer cada ~7 dias~~ — hecho 2026-09-03: app OAuth movida
      a Externo + "En produccion" (scope de Drive removido antes,
      pagina de inicio y politica de privacidad agregadas), token nuevo
      generado y confirmado sin fallos en una conversacion real de
      WhatsApp (ver "Solucion durable" arriba). Pendiente solo verificar
      con el tiempo que efectivamente no vuelva a expirar a los 7 dias.
- [ ] Migrar la politica de privacidad del Claude Artifact a una pagina
      real en `espazios.com.co`, y actualizar la URL en Google Auth
      Platform — pospuesto a pedido del usuario ("por ahora garanticemos
      produccion de Isa V2") hasta que tenga quien la publique.
- [x] ~~Fotos por zona (`assets/zonas/*.jpg`, 8 archivos)~~ — cargadas
      2026-09-04. El usuario las subio a una carpeta de Google Drive
      (nombradas ya con el slug correcto de cada zona); se descargaron
      con el conector de Drive y se convirtieron de PNG a JPG con
      `sharp`. Cubren las 8 zonas. **Nota:** `habitacion-2.jpg` y
      `habitacion-3.jpg` son el mismo archivo (byte a byte) — el usuario
      subio la misma foto para ambas zonas, asi que hoy las dos tarjetas
      se ven con la misma foto generica de habitacion vacia. Funciona
      bien igual (no rompe nada), pero si consigue una foto distinta
      para una de las dos, reemplazar el archivo correspondiente.
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
