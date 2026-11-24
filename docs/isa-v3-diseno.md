# Isa v3 — diseño: flujo determinístico + IA solo para desvíos

Estado: **propuesta, pendiente de aprobación** (2026-11-24). Isa v2 no se toca;
v3 se construye como Workflow nuevo en Kapso y se prueba en el número de
pruebas antes de cualquier corte.

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
