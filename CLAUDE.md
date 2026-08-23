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
formas/colores bien pero **sin texto visible**. Causa: el SVG dependia de
`font-family: 'Segoe UI'` (solo existe en Windows) — Railway corre Linux
sin esa fuente ni fallback instalado, asi que el texto se renderizaba
invisible aunque las formas si (esas no dependen de fuentes). Arreglo:
se empaca la fuente Inter (descargada de Google Fonts, licencia OFL)
directo en cada SVG via `@font-face` + base64
(`assets/fonts/Inter-Regular.ttf`, `assets/fonts/Inter-Bold.ttf`) — ya no
depende de que el sistema operativo tenga ninguna fuente instalada.
**Pendiente confirmar** que se vea bien en produccion despues de este fix
(probado local en Windows, falta la prueba real en Railway/Linux).

**Espacio para logo y fotos, agregado 2026-08-23.** `render.ts` busca
archivos en `assets/` (`logo.png`, `paquetes/<slug>.jpg`) y los compone
sobre la tarjeta si existen — si no, deja el espacio reservado con un
placeholder discreto (nunca cambia el layout despues, solo se cubre).
**Pendiente: el usuario va a cargar `assets/logo.png` y las 3 fotos por
paquete** — ver `assets/README.md` para nombres/tamanos exactos.
- `src/tools/estimado-ilustrativo/contenido.ts` — lee esa pestana.
- `renderDetalle()` en `render.ts` — tarjeta de un solo paquete: nombre,
  precio, lista de items, mismo aviso de "ilustrativo". Si no hay items
  cargados, muestra un texto de respaldo en vez de una lista vacia.
- `POST /tools/detalle-paquete` (input: `paquete`, `m2`) en
  `tools-server.ts` — mismo cache en memoria que el estimado general.

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
