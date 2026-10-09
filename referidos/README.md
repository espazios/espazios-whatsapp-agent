# Canal de referidos · Kapso

Formulario de WhatsApp para que alguien recomiende a un cliente potencial a Espazios.
Está **separado de Isa**: no toca su workflow, sus funciones, sus triggers ni sus tablas.

## Cómo funciona

```
La persona saluda (cualquier mensaje)
        │
Bienvenida: canal exclusivo para referir clientes + 2 botones
        ├─ "Referir" ──────────► formulario ─► referidos-guardar ─► agradecimiento
        │                         (espera 1 h)                     (llamada al referido
        │                                                           en < 8 horas hábiles)
        ├─ "No voy a referir" ─► despedida y fin
        ├─ escribe otra cosa ──► recordatorio de tocar un botón (vuelve a esperar)
        └─ 24 h sin respuesta ─► fin, sin enviar nada
```

`referidos-opcion` (decide node) lee el botón tocado; `referidos-guardar` valida y
guarda el formulario y arma el mensaje de agradecimiento.

## Qué hay en Kapso (proyecto 1908f12d-3ac4-407f-b8f0-b79f954ed1d2)

| Pieza | Nombre | ID |
| --- | --- | --- |
| Formulario (WhatsApp Flow, borrador) | Referidos Espazios | Kapso `6994691e-d0d5-4e7d-9664-4cac3cb06d7a`, Meta `1445759314153131` |
| Workflow (borrador, **sin trigger**) | Referidos Espazios (`referidos-espazios`) | `15f58e38-f2b7-445c-a7f6-3520061f54a6` |
| Función (decide node) | `referidos-opcion` | `20895dd0-6e8d-48e0-a566-91aeb3be33c8` |
| Función (function node) | `referidos-guardar` | `770b2e81-086d-4eac-b1a7-1d6999fe959c` |

Código fuente: `formulario-referido.flow.json` y `functions/`. Kapso no se actualiza
solo con un push a este repo: los cambios se suben con el MCP de Kapso o el dashboard.

## Campos del formulario

Tu nombre, nombre de la persona, celular (10 dígitos), ciudad y barrio o conjunto,
qué necesita (Solo Obra Blanca / Intermedio / Remodelación Total / Carpintería / No
estoy seguro), comentario opcional y el consentimiento de que Espazios la contacte
(obligatorio, Ley 1581 de 2012).

Se guarda en la tabla D1 `referidos_formulario` (se crea sola en el primer registro).
Sin reglas de atribución ni de 90 días.

## Pendiente para ponerlo a funcionar

El Sandbox de Kapso no soporta WhatsApp Flows, y el único número de producción es el
de Isa (+57 310 8708467). Por eso el formulario se creó en la cuenta de WhatsApp de
Espazios (WABA `2058859495045331`) y el workflow quedó **sin trigger**.

1. Conectar en Kapso un número propio para referidos, en la misma cuenta de WhatsApp
   de Espazios (así puede enviar este mismo formulario).
2. Publicar el formulario (`whatsapp_flows` → `publish`, irreversible en Meta).
3. Crear el trigger `inbound_message` del workflow sobre ese número nuevo y publicar
   el workflow.

**Nunca** crear el trigger sobre el número de Isa (`1015963018277835`).
