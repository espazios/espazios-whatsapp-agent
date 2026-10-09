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
        │                                                           + los mismos 2 botones,
        │                                                           para referir a alguien más
        ├─ "No voy a referir" ─► despedida y fin
        ├─ escribe otra cosa ──► recordatorio de tocar un botón (vuelve a esperar)
        └─ 24 h sin respuesta ─► fin, sin enviar nada
```

`referidos-opcion` (decide node) lee el botón tocado; `referidos-guardar` valida y
guarda el formulario y arma el mensaje de agradecimiento.

## Qué hay en Kapso (proyecto 1908f12d-3ac4-407f-b8f0-b79f954ed1d2)

| Pieza | Nombre | ID |
| --- | --- | --- |
| Formulario (WhatsApp Flow, publicado) | Referidos Espazios v2 | Kapso `b3548d34-b3b5-4e1f-82bc-ae7699e0f53a`, Meta `2687227798403049` |
| Formulario v1 (ya no se usa) | Referidos Espazios | Kapso `6994691e-d0d5-4e7d-9664-4cac3cb06d7a`, Meta `1445759314153131` |
| Workflow (activo) | Referidos Espazios (`referidos-espazios`) | `15f58e38-f2b7-445c-a7f6-3520061f54a6` |
| Función (decide node) | `referidos-opcion` | `20895dd0-6e8d-48e0-a566-91aeb3be33c8` |
| Función (function node) | `referidos-guardar` | `770b2e81-086d-4eac-b1a7-1d6999fe959c` |

Código fuente: `formulario-referido.flow.json` y `functions/`. Kapso no se actualiza
solo con un push a este repo: los cambios se suben con el MCP de Kapso o el dashboard.

## Campos del formulario

Tu nombre, nombre de la persona, indicativo del país (lista, Colombia +57 por defecto),
celular (sin indicativo), correo (opcional, formato de correo), ciudad (lista con las
mismas 9 ciudades de cobertura de Isa: Bogotá, Soacha, Mosquera, Madrid, Chía, Cota,
Zipaquirá, Cajicá, La Calera), barrio o conjunto, qué necesita (Solo Obra Blanca /
Intermedio / Remodelación Total / Carpintería / No estoy seguro), comentario opcional y
el consentimiento de que Espazios la contacte (obligatorio, Ley 1581 de 2012).

Se guarda en la tabla D1 `referidos_formulario` (se crea sola). `celular_referido` queda
con indicativo (ej. `573001234567`). Las columnas `correo_referido` y `barrio_conjunto`
se agregan solas a la tabla existente. Sin reglas de atribución ni de 90 días.

Un formulario publicado en Meta no se puede editar: para cambiarlo hay que crear uno
nuevo y apuntar el nodo `enviar_formulario` del workflow a su ID de Meta.

## En producción (2026-10-09)

- Número del canal: **+57 313 875 6205** (`phone_number_id 1416714448186897`), en la
  misma cuenta de WhatsApp de Espazios (WABA `2058859495045331`) que Isa.
- Formulario **publicado** en Meta.
- Workflow **activo y publicado**, con un único trigger `inbound_message` sobre
  `1416714448186897`.

Isa no cambió: su workflow sigue escuchando solo `1015963018277835`. **Nunca** crear
un trigger de este workflow sobre el número de Isa.
