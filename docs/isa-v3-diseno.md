# Isa v3 — diseño: flujo determinístico + IA solo para desvíos

Estado: **construido en Kapso como borrador, sin trigger** (2026-11-24). Isa v2
no se tocó. Ver la sección 7 para lo implementado y los pasos pendientes antes
de probarlo en el número de pruebas.

## 1. Diagnóstico de Isa v2 (revisado en vivo vía MCP de Kapso)

Workflow `9144e40d-…` ("Isa v2 (IA generativa)", `lock_version 874`): un solo
nodo `agent` que hace **todo** — saludo, las 9 preguntas, filtros, estimado,
detalle, agendamiento, seguimientos.

Configuración real hoy:

| Parámetro | Valor | Problema |
|---|---|---|
| Modelo | `gpt-5-mini`, `reasoning_effort: low` | Modelo chico siguiendo un prompt de ~54.000 caracteres |
| `message_delivery_mode` | `auto_send_assistant_text` | Cualquier texto que genere el modelo sale al cliente → fugas tipo `[Espera de respuesta]` |
| `enabled_default_tools` | incluye **`complete_task`** | Se volvió a habilitar (se había quitado el 2026-09-05). Termina la ejecución y se pierde el contexto |
| Tokens por llamada al modelo | ~19.000 de entrada | 3–4 llamadas por turno, incluso para preguntar "en qué ciudad?" |

Muestra: últimas 100 ejecuciones (12–24 nov): 55 `waiting`, 31 `handoff`
(un humano tuvo que tomar la conversación), 14 `ended`.

Evidencia concreta de cada síntoma:

1. **Conversación frenada sin pregunta** — ejecución `32b06856-…` (Dago, 23-nov):
   el cliente confirma su nombre ("Si"); Isa guarda `nombre`, registra el
   seguimiento `"confirmar la ciudad"` y entra en espera **sin enviar nunca
   la pregunta de ciudad**. El cliente queda esperando; 35 min después un
   humano tomó la conversación.
2. **`complete_task` a mitad de flujo** — ejecución `1d586aa0-…` (23-nov):
   Isa se vuelve a presentar desde cero y llama `complete_task`; la ejecución
   termina (`reached_terminal_node`).
3. **El detalle del paquete no llega — causa raíz técnica, no de prompt.**
   Los esquemas de las herramientas en Kapso no coinciden con el servidor:
   - `generar_estimado_ilustrativo` solo expone `nombre, ciudad, proyecto, m2`.
     **No tiene `banos` ni `tipoProyecto`**, así que el modelo no puede
     mandarlos: nunca se destaca "tu elección", nunca viene el detalle
     automático en la respuesta, y en 31–44 m² el precio sale con la tarifa
     de 1 baño.
   - `ver_detalle_paquete` solo expone `paquete, m2`, pero
     `/tools/detalle-paquete` exige además `nombre, ciudad, proyecto` →
     responde **400** cuando el modelo respeta el esquema.
   - Ejemplo real (23-nov, conv. `fbc4388c-…`): "Luego te muestro el detalle
     del paquete Intermedio si quieres" — y nunca llega.

Conclusión: no es un problema de redacción del prompt. Es arquitectura —
un modelo chico controlando un flujo que debería ser fijo.

## 2. Principio de v3

> **El flujo lo maneja el Workflow, no el modelo.** La IA solo entra cuando
> el cliente se sale del guion, responde la duda, y devuelve el control al
> mismo punto del flujo.

| Fase | ¿Quién la maneja? | ¿Consume IA? |
|---|---|---|
| Saludo (igual al de hoy) | Function + send_text | No |
| Las 9 preguntas de perfilamiento + filtros | Nodos fijos + Function que interpreta | No (salvo respuesta ambigua) |
| Guardar lead tibio / lead completo | Function node | No |
| Estimado + detalle del paquete elegido | Webhook node + send_interactive con imagen | No |
| Ver detalle de otros paquetes | Botones | No |
| Agendamiento (tipo, día, franja, link) | Botones / listas | No |
| Desvío: pregunta, objeción, foto, duda, charla | Agente IA | **Sí** |
| Después de agendar: dudas, calentar | Agente IA | **Sí** |

## 3. Arquitectura del grafo

```
start
  └─ fn preparar_saludo ── send_text {{vars.saludo}}
        └─▶ ROUTER (decide, modo function: isa3-router)
              ├─ preguntar_<campo>  ─▶ send_text / send_interactive
              │                          └─ wait_for_response
              │                               └─ INTERPRETAR (decide function: isa3-interpretar)
              │                                    ├─ "ok"          ─▶ ROUTER
              │                                    └─ "desvio"      ─▶ AGENTE_DESVIO ─(complete_task)─▶ ROUTER
              ├─ cerrar_cobertura / cerrar_presupuesto ─▶ send_text (cierre cálido)
              ├─ objecion_etapa_1 / objecion_etapa_2   ─▶ send_text / botones
              ├─ guardar_tibio / guardar_lead          ─▶ function ─▶ ROUTER
              ├─ estimado ─▶ webhook Railway ─▶ interactive(imagen general)
              │                              ─▶ interactive(imagen detalle elegido + botones)
              ├─ agendar  ─▶ botones Llamada / Reunión virtual / Reunión presencial ...
              └─ post_agendado ─▶ AGENTE_CONVERSACION (dudas, calentar)
```

### 3.1 Saludo (sin IA)

`isa3-preparar-saludo` (Kapso Function) lee el nombre de perfil del contexto
de WhatsApp, decide si es un nombre real (no emojis, no negocio, no vacío) y
arma el texto exacto de hoy:

- con nombre: `Hola! hablas con Isa de Espazios — te acompañamos con los acabados y remodelación de tu vivienda. Aquí podemos avanzar con una cotización ilustrativa. Hablo con {nombre}?`
- sin nombre: mismo texto terminando en `Con quién tengo el gusto?`

Lead caliente (el primer mensaje ya trae conjunto/barrio u otros datos): la
misma función extrae lo que pueda con reglas y lo guarda; el ROUTER se salta
lo que ya está.

### 3.2 ROUTER — una sola función, máquina de estados

`isa3-router` mira `vars` y devuelve el siguiente paso. Toda la lógica de
negocio de las secciones 5–6 queda **en código**, no en el prompt:

- orden: `nombre → ciudad → tipo_proyecto → presupuesto → conjunto_o_barrio → m2 → banos (solo 31–44) → plazo → correo`
- filtro de cobertura (Bogotá/Soacha completo; Mosquera, Madrid, Chía, Cota,
  Zipaquirá, Cajicá, La Calera solo Carpintería)
- mínimos de presupuesto ($15M / $10M Carpintería) y las 2 etapas de objeción
- dispara `guardar_tibio` apenas hay nombre+ciudad+tipo+presupuesto
- dispara `estimado` + `guardar_lead` cuando están los 8 datos
- el aviso de Ley 1581 va pegado a la pregunta de ciudad, una sola vez

Se puede probar con tests unitarios en este repo — algo imposible hoy con un
prompt.

### 3.3 INTERPRETAR — reglas primero, IA solo si no entiende

`isa3-interpretar` recibe la respuesta y el campo pendiente:

| Campo | Regla determinística |
|---|---|
| nombre | botones "Sí, soy yo" / "No"; si escribe un nombre, se normaliza (mayúsculas) |
| ciudad | coincidencia sin tildes contra la lista + alias ("bta", "bogota dc"…) |
| tipo_proyecto | lista interactiva de 4 opciones, o número 1–4 / palabra clave |
| presupuesto | número en "30", "30 millones", "30M", "30.000.000"; si dice "m2"/"metros" → aclarar |
| conjunto_o_barrio | texto libre (si no es una pregunta) |
| m2 | número entre 15 y 300 |
| banos | botones 1 / 2 |
| plazo | texto libre normalizado |
| correo | expresión regular |

Si la regla no logra extraer el dato (o el mensaje es una pregunta, una
foto, una queja…) → arista `desvio`. Opcional intermedio: un `decide` en
modo IA con un prompt de 5 líneas (cientos de tokens, no 19.000) para
clasificar "es el dato / es otra cosa" antes de llamar al agente.

### 3.4 AGENTE_DESVIO — la IA que devuelve al flujo

- Prompt corto: rol + tono (sec. 1, 10) + Espazios, proceso, FAQ, TikTok,
  reglas que no se rompen (sec. 3, 4, 7, 8, 12, 14, 15). **Sin** reglas de
  orden, filtros ni herramientas de estimado — eso ya no es su trabajo.
- Recibe `{{vars.campo_pendiente}}` para saber dónde quedó el flujo.
- `message_delivery_mode: tool_only` + `send_notification_to_user`: el texto
  interno **nunca** sale al cliente (protección estructural contra fugas).
- Herramientas: `send_notification_to_user`, `complete_task`,
  `handoff_to_human`. Sin `enter_waiting`: responde **una vez** y llama
  `complete_task` → ROUTER vuelve a hacer la pregunta pendiente.
- Aquí `complete_task` es correcto: en v3 significa "devolver al flujo",
  no "terminar la conversación", porque tiene una arista de salida.

### 3.5 Estimado y detalle — sin IA

1. `webhook` node → `POST /tools/estimado-ilustrativo` con **todos** los
   campos desde `vars` (`nombre, ciudad, proyecto, m2, banos, tipoProyecto`)
   → `save_response_to: estimado`.
2. `send_interactive` con `header_type: image`,
   `header_media_url: {{vars.estimado.imageUrl}}` y texto corto.
3. Si eligió uno de los 3 paquetes: segundo `send_interactive` con la imagen
   `{{vars.estimado.paqueteElegido.imageUrl}}` y botones con **solo los 2
   paquetes que faltan** + "Agendar sesión" (WhatsApp permite máx. 3
   botones — encaja exacto).
4. Botón "Ver Intermedio" → webhook `/tools/detalle-paquete` → imagen con
   los botones restantes. Si el cliente escribe en vez de tocar un botón →
   INTERPRETAR → desvío si hace falta.

El envío de las dos imágenes deja de depender de que el modelo "se acuerde".

### 3.6 Agendamiento — sin IA

- Botones: `Llamada` / `Reunión virtual` / `Reunión presencial`.
- Llamada: lista con los próximos 6 días hábiles (función, sin domingos ni
  festivos de Colombia) → lista de franjas horarias → `guardar_lead` con
  `fecha_llamada`/`hora_llamada` → confirmación en texto.
- Reunión: `send_interactive` tipo `cta_url` con el link de Calendar (+
  dirección si es presencial) → `guardar_lead` → botones "Ya agendé" /
  "Tengo una duda".
- Después: AGENTE_CONVERSACION (dudas, calentar, prueba social).

### 3.7 Seguimientos por inactividad

Dos opciones (decisión pendiente):
- **A — nativo:** `wait_for_response` con `timeout` (ej. 10 min) → rama
  `timeout` → recordatorio fijo anclado al campo pendiente. Simple y sin IA,
  pero cuenta horas de reloj, no horas hábiles.
- **B — conservar `register_followup`** pero llamado desde un Function node
  del flujo (determinístico), no desde el modelo.

## 4. Impacto esperado

- Perfilamiento completo (~10 turnos) con **0 llamadas al modelo** si el
  cliente responde lo que se le pregunta. Hoy son ~3–4 llamadas × ~19k
  tokens por turno.
- Imposible que una pregunta del flujo "no se envíe": la envía un nodo fijo.
- Imposible que el flujo se pierda con `complete_task`.
- Las fugas de texto interno solo podrían pasar en el agente de desvío, y
  `tool_only` las bloquea.

## 5. Cambios necesarios en este repo

- `kapso-functions/isa3-preparar-saludo.js`, `isa3-router.js`,
  `isa3-interpretar.js` (+ tests de las reglas de negocio).
- `guardar-lead.js` / `guardar-lead-tibio.js` reutilizables desde Function
  node (leen de `vars` en vez de argumentos del modelo).
- `tools-server.ts`: confirmar que las imágenes sirven como header de
  mensaje interactivo (PNG ~170 KB, URL pública — OK) y considerar que el
  caché en memoria sobreviva lo suficiente.
- Prompts cortos de los 2 agentes en `docs/isa-v3-prompts.md`.

## 6. Arreglos urgentes para Isa v2 (mientras v3 se construye)

Independientes de v3, en producción, pendientes de aprobación:
1. Quitar `complete_task` de `enabled_default_tools`.
2. Agregar `banos` y `tipoProyecto` al esquema de `generar_estimado_ilustrativo`,
   y `nombre`, `ciudad`, `proyecto`, `banos` al de `ver_detalle_paquete`.
   Esto debería arreglar por sí solo el detalle que no llega.

## 7. Implementado (2026-11-24)

La implementación final simplificó el grafo de la sección 3: en vez de un
nodo por pregunta, **un solo motor** decide y además **envía todos los
mensajes** (texto, botones, listas, imágenes, link de Calendar) por la API de
Kapso. Así los títulos de los botones pueden ser dinámicos (por ejemplo, solo
los 2 paquetes que faltan por ver) y la lógica completa queda en código con
tests.

```
start -> motor (decide, función isa3-motor)
           |- esperar -> wait_for_response -> motor
           |- desvio  -> agente_desvio (IA, tool_only) --complete_task--> motor
           '- humano  -> handoff
```

| Pieza | Dónde |
|---|---|
| Motor (máquina de estados, reglas, envíos, D1, Railway) | `kapso-functions/isa-v3/motor.js` → Kapso Function `isa3-motor` (`6a64ffed-b18c-4568-bc13-913ce136f6c8`), desplegada |
| Tests (24 escenarios, sin red) | `kapso-functions/isa-v3/motor.test.mjs` — `node --test kapso-functions/isa-v3/motor.test.mjs` |
| Prompt del agente de desvíos | `docs/isa-v3-prompt-agente.md` (21K caracteres vs 54K de v2; ~2/3 es la tabla de TikTok) |
| Workflow | "Isa v3 (flujo determinístico + IA)", id `1d9761cc-4333-413a-870d-654fefdeeaec`, **draft, sin triggers** |

Detalles que vale la pena saber:
- El motor lee los mensajes nuevos de `whatsapp_context.messages` (incluye el
  id del botón/lista tocado) y recuerda hasta dónde procesó con
  `vars.ultimo_inbound_at`.
- Envía con `to` (teléfono) y `recipient` (business_scoped_user_id), así que
  funciona también con leads de anuncios de Instagram con teléfono oculto.
- Guarda en las mismas tablas de v2 (`leads_tibios_isa_v2`, `leads_isa_v2`),
  así los reportes existentes siguen sirviendo.
- Llama a Railway con **todos** los campos (`banos`, `tipoProyecto`,
  `nombre`, `ciudad`, `proyecto`) — corrige de raíz el bug del detalle que
  no llegaba.
- El agente usa `tool_only`: cualquier texto que no pase por
  `send_notification_to_user` nunca llega al cliente. Kapso exige tener
  `enter_waiting` habilitado en ese modo; el prompt prohíbe usarlo.
- Lista de días para llamada: próximos 6 días hábiles (sin domingos ni
  festivos de Colombia, calculados con la Ley Emiliani, probados contra 2026).

### Pendiente antes de probar
1. **Pegar `KAPSO_API_KEY` como secret de `isa3-motor`** (Kapso → Functions →
   isa3-motor → Secrets). Sin eso el motor no puede enviar mensajes (la
   prueba de humo lo confirmó: corre bien pero el envío falla).
2. Conectar un trigger del Workflow al **número de pruebas** (no al de
   producción) y hacer una conversación completa: saludo → 8 datos →
   estimado + detalle → ver otro paquete → agendar llamada.
3. Verificar en esa prueba que WhatsApp acepta la imagen de Railway como
   encabezado de un mensaje con botones (es lo único que no se pudo probar
   sin red).
4. Seguimientos por inactividad: no están en v3 todavía (fase 2).

### Criterios de cobertura (confirmados por el usuario 2026-11-24)

| Tipo de proyecto | Bogotá y Soacha | Chía, Mosquera, Madrid, Cota, Zipaquirá, Cajicá, La Calera, Funza, Facatativá, Sopó | Otras |
|---|---|---|---|
| Carpintería | Sí | Sí | No |
| Solo Obra Blanca, Intermedio, Remodelación Total | Sí | No | No |

Funza, Facatativá y Sopó se agregaron ese día. Están cubiertos por la prueba
"criterios de cobertura por ciudad y tipo de proyecto" en `motor.test.mjs`.
Como WhatsApp permite máximo 10 filas por lista, cuando no se reconoce la
ciudad escrita la lista es de 2 pasos: Bogotá / Soacha / Municipio cercano /
Otra ciudad, y "Municipio cercano" abre la lista de los 10 municipios.
**Diferencia con Isa v2:** el prompt de v2 solo tiene 7 municipios (sin
Funza, Facatativá ni Sopó).

### Primera prueba real (2026-11-24, +57 313 8756205) y arreglos

Funcionó sin IA: saludo, nombre, ciudad con lista, tipo de proyecto, presupuesto,
conjunto, m², baños con botones, plazo, correo, **estimado + detalle del paquete
elegido con botones** (confirmado: WhatsApp acepta la imagen de Railway como
encabezado del mensaje con botones), botones de agendamiento y link de Calendar.

Fallas encontradas y corregidas:
1. Después de compartir el link, "mejor virtual", "dónde agendo?" y "prefiero
   llamada" se iban a la IA, que inventó que "un Ejecutivo se comunicará para
   confirmar día y hora". Ahora el motor los resuelve: reenvía el link o arranca
   la lista de días de la llamada.
2. Si llegaba un mensaje mientras la IA respondía, la IA contestaba el mensaje
   anterior (respuesta duplicada). Ahora el motor pasa `mensaje_cliente` y
   `last_user_input` al agente con el mensaje correcto.
3. La IA terminaba respuestas con preguntas y mencionó "opciones de pago".
   Reglas nuevas en el prompt.
4. Reconoce "Bgta" como Bogotá y "Quiero blanca" como Solo Obra Blanca.

### Intérprete IA para respuestas que el motor no entiende (Opción A, 2026-11-24)

Autorizado por el usuario. Cuando las reglas del motor no reconocen una
respuesta de opción (ciudad, tipo de proyecto, paquete/agendar, tipo de
agendamiento) y el texto no es una pregunta, el motor no aclara ni manda
a la IA conversacional: devuelve el edge `interpretar` con
`interpretacion_pendiente`, `campo_interpretar` e `interpretar_desde`.

- Nodo `interprete` (decide en modo AI, `claude-haiku-5-5`, temperatura 0,
  historial de 4 mensajes, variables `campo_interpretar` y
  `mensaje_cliente`). Solo **clasifica**: 25 condiciones
  (`no_es_respuesta` primero, porque Kapso cae a la primera si la IA
  falla), todas vuelven al motor. Nunca le escribe al cliente.
- El motor lee la etiqueta elegida del evento de decisión en
  `flow_events` (`resultadoInterpreteDe`) y la valida contra el campo
  preguntado (`opcionDesdeEtiqueta`): una etiqueta de otro campo se
  ignora. Si no hay etiqueta, o es `ciudad_otra`, muestra la lista de
  opciones (degradación segura); `no_es_respuesta` va al desvío.
- Si el cliente manda un mensaje nuevo mientras tanto, ese mensaje manda.
- Presupuesto, m², baños, plazo y correo siguen sin intérprete: ahí las
  reglas + aclaración bastan.

Pendiente: en la primera prueba real, revisar el `console.log("interprete", ...)`
de `isa3-motor` para confirmar la forma real del evento de decisión y
ajustar `resultadoInterpreteDe` si la etiqueta viene en otro campo.
Workflow publicado (lock 9) e `isa3-motor` desplegado (lock 10).
