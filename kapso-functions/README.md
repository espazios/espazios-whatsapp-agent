# Kapso Functions — base de datos de leads de Isa v2

Estas dos funciones corren en Cloudflare Workers, dentro del proyecto de
Kapso — no en Railway ni en este repo. Cada función del proyecto tiene
acceso automático a `env.DB`, una base de datos SQL (Cloudflare D1)
compartida por todo el proyecto — es la "base de datos dentro de Kapso".

Esta sesión de Claude Code no tiene salida de red hacia `api.kapso.ai`
(bloqueada por el sandbox), así que el deploy es manual, siguiendo estos
pasos en el dashboard de Kapso (`app.kapso.ai`).

**Nombres de las funciones en Kapso:** el slug de una función solo acepta
minúsculas, números y guiones (`-`) — nada de guion bajo (`_`). Además,
el proyecto **ya tiene una función existente usada por la Isa vieja**
que guarda leads (la que aparece en sus logs como
`resultado_guardar_lead`) — **no la toques ni la borres**, sigue en
producción real. Por eso las funciones nuevas de esta guía usan el
sufijo `-isa-v2`, para no chocar con nombres existentes:
`guardar-lead-isa-v2` y `leads-reporte-isa-v2`. Si en tu proyecto esos
nombres también chocan con algo, usa cualquier otro sufijo — el nombre
de la función en Kapso es independiente del nombre del *tool* que Isa
llama (ese se define aparte en el paso 3, y sí debe ser exactamente
`guardar_lead_db` porque es el nombre que usa
`docs/isa-v2-system-prompt.md` — el tool se renombró de `guardar_lead` a
`guardar_lead_db` el 2026-09-05, confirmado en el dashboard real).

## 1. Desplegar `guardar-lead.js`

1. Kapso dashboard → **Functions** → **New function**.
2. Nombre: `guardar-lead-isa-v2`. Runtime: **Cloudflare Workers**.
3. Pega el contenido completo de `guardar-lead.js` en el editor de código
   (el contenido del archivo no cambia, solo el nombre de la función en
   el dashboard).
4. **NO** actives "Public endpoint" — solo la llama el agent node de Isa
   internamente, no necesita URL pública.
5. **Deploy**. Espera a que el estado pase de `draft` a `deployed`
   (10-60 segundos).
6. No hace falta configurar Secrets ni bindings — `env.DB` ya está
   disponible automáticamente.

## 2. Desplegar `leads-reporte.js`

1. **New function** de nuevo. Nombre: `leads-reporte-isa-v2`. Runtime:
   **Cloudflare Workers**.
2. Pega el contenido completo de `leads-reporte.js`.
3. Esta vez **sí activa "Public endpoint"** — así se puede abrir
   directo en el navegador sin necesitar una API key.
4. **Deploy**.
5. (Recomendado) Pestaña **Secrets** de esta función → agrega
   `REPORT_TOKEN` con un valor que solo tú conozcas (cualquier texto
   largo). Sin esto, cualquiera con el link ve los leads.
6. Copia la **Invoke URL** que muestra el dashboard.

**Importante — no pegues esa URL directo en la barra de direcciones del
navegador.** El endpoint `/invoke` de Kapso solo acepta peticiones
`POST`; pegar la URL y darle Enter manda un `GET`, que responde
"Page not found" (no es un error de la función, el "Test" del dashboard
sí usa `POST` y por eso ahí funciona). Usa en cambio
**`ver-leads.template.html`** de esta misma carpeta:

1. Copia ese archivo a algo como `ver-leads.html` (fuera del repo, no lo
   commitees con el token real adentro).
2. Reemplaza `REEMPLAZA-CON-EL-ID-DE-leads-reporte` por el ID de tu
   función `leads-reporte-isa-v2`, y `REEMPLAZA-CON-TU-REPORT_TOKEN` por
   el valor real de tu `REPORT_TOKEN`.
3. Guarda el archivo en tu computador y ábrelo con doble clic cada vez
   que quieras ver el informe — tiene un botón "Ver leads" que sí manda
   el `POST` correcto.

## 3. Conectar `guardar_lead_db` como tool del agent node de Isa v2

En el Workflow "Isa v2 (IA generativa)" → el nodo del agente → agregar
tool nuevo (igual que ya están `generar_estimado_ilustrativo` y
`ver_detalle_paquete`, pero apuntando a esta función de Kapso en vez de
a un webhook externo):

- **Nombre del tool**: `guardar_lead_db` (con guion bajo — este es el
  nombre que el system prompt usa para llamarlo, no tiene que coincidir
  con el nombre de la función de Kapso del paso 1).
- **Descripción** (para que el modelo sepa cuándo llamarlo): "Guarda o
  actualiza el lead en la base de datos. Llámalo silenciosamente (sin
  avisarle al cliente) en dos momentos: justo después de generar el
  estimado ilustrativo, con los datos de calificación ya recolectados; y
  justo después de confirmar el agendamiento, con los datos de esa
  logística."
- **Function**: selecciona la función `guardar-lead-isa-v2` que acabas
  de desplegar.
- **Parámetros / input schema**:

```json
{
  "type": "object",
  "properties": {
    "nombre": { "type": "string" },
    "ciudad": { "type": "string" },
    "tipo_proyecto": { "type": "string" },
    "presupuesto": { "type": "string" },
    "conjunto_o_barrio": { "type": "string" },
    "m2": { "type": "number" },
    "banos": { "type": "integer" },
    "plazo": { "type": "string" },
    "correo": { "type": "string" },
    "tipo_agendamiento": {
      "type": "string",
      "enum": ["llamada", "reunion_virtual", "reunion_presencial"]
    },
    "fecha_llamada": {
      "type": "string",
      "description": "Fecha elegida para la llamada, formato YYYY-MM-DD"
    },
    "hora_llamada": {
      "type": "string",
      "description": "Horario elegido para la llamada, ej. '3:00 pm' o 'entre 2 y 4 pm'"
    },
    "notas_agendamiento": { "type": "string" }
  }
}
```

Ningún campo es `required` — el tool se llama dos veces con subconjuntos
distintos de estos campos (ver `docs/isa-v2-system-prompt.md`, secciones
6.1 y 9).

## Verificar que funciona

Después de una conversación de prueba con Isa v2 que llegue hasta el
estimado (o hasta agendar), abre la Invoke URL de `leads-reporte-isa-v2`
— debe aparecer una fila con los datos de esa conversación de prueba.

## Notas

- La tabla `leads` se crea sola (`CREATE TABLE IF NOT EXISTS`) la primera
  vez que corre cualquiera de las dos funciones — no hace falta correr
  ninguna migración a mano.
- La llave para no duplicar filas es el número de WhatsApp del contacto
  (`telefono`), que Kapso inyecta automáticamente en cada llamada al
  tool — Isa nunca lo pasa como argumento.
- Para reuniones (virtual/presencial), el reporte solo puede decir que
  el cliente **eligió** ese tipo de agendamiento — no la fecha/hora real,
  porque esa la define el cliente directamente en el link estático de
  Google Calendar Appointment Schedule, fuera del alcance de Isa. Eso
  cambia cuando se construya la Prioridad 2 del roadmap (Calendar API
  real, ver `CLAUDE.md`).
