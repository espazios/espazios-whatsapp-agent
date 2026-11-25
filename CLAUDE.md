# Espazios — Isa, agente de ventas por WhatsApp

Isa atiende por WhatsApp a quienes quieren remodelar o hacer carpintería a
medida con Espazios (Bogotá, Colombia). Hace estas cosas:
- califica al cliente;
- le muestra un estimado ilustrativo en imagen;
- agenda una sesión con un Ejecutivo Comercial;
- le hace seguimiento si deja de responder.

La historia completa de Isa v1/v2 (bugs, decisiones, pruebas) está en
`docs/archivo/historial-isa-v1-v2.md`. Este archivo describe solo lo vigente.

## Reglas de negocio no negociables

- Los precios **nunca** los redacta un modelo de lenguaje. Siempre salen de la
  hoja de tarifas, calculados por código; el LLM, cuando interviene, solo
  explica.
- Todo estimado es **ilustrativo y preliminar**, sujeto a visita técnica y a la
  cotización formal del Ejecutivo Comercial. Las imágenes lo dicen
  explícitamente, junto con el aviso de que no es una oferta comercial en firme.
- Los datos personales solo se capturan después del aviso de tratamiento de
  datos (Ley 1581 de 2012 / Habeas Data Colombia).
- Isa no menciona la sesión ni al Ejecutivo Comercial antes de entregar el
  estimado, salvo que el cliente pregunte por el proceso.

## Arquitectura vigente: Isa v3 (en producción desde 2026-11-24)

El flujo es determinístico y la IA solo atiende desvíos. Diseño completo en
`docs/isa-v3-diseno.md`.

| Pieza | Dónde | Qué hace |
|---|---|---|
| Workflow "Isa v3 (flujo determinístico + IA)" | Kapso, id `1d9761cc-4333-413a-870d-654fefdeeaec` | Recibe los mensajes y llama al motor |
| `isa3-motor` | Kapso Function `6a64ffed-b18c-4568-bc13-913ce136f6c8`; fuente en `kapso-functions/isa-v3/motor.js` | Máquina de estados: saludo, 8 datos, filtros de cobertura y presupuesto, estimado, agendamiento. Manda todos los mensajes, guarda los leads en D1 y programa los seguimientos |
| Intérprete | Nodo decide AI (`claude-haiku-5-5`) | Solo clasifica respuestas de opción mal escritas, con una lista cerrada de etiquetas |
| Agente de desvíos | Nodo agent, `tool_only`; prompt en `docs/isa-v3-prompt-agente.md` | Responde preguntas fuera del flujo y devuelve el control |
| `isa3-seguimientos` | Kapso Function pública `d781d5ab-70c8-4230-ae40-5dd2c1791b21`; se genera desde `motor.js` con `kapso-functions/isa-v3/build-seguimientos.mjs` | Envía los seguimientos vencidos: 10 min, 4 h y 8 h hábiles; texto dentro de 24 h, plantilla aprobada fuera |
| Servidor de herramientas | Railway, `src/tools-server.ts`, se despliega con cada push a `master` | Genera las imágenes del estimado y del detalle (lee la hoja de Google) y despierta `isa3-seguimientos` cada minuto |

**Números y disparadores:**
- Producción: +57 310 8708467 (`phone_number_id 1015963018277835`). Disparador
  de v3 `20d5294a-…` activo; el de v2 `e4bf6ded-…` está apagado. Para volver a
  v2, invertir esos dos disparadores.
- Pruebas: +57 313 8756205. Hoy tiene v3 (`66cfed6f-…`); el disparador de
  Referidos (`cd472fbd-…`) está pausado.

**Tablas D1** (base compartida del proyecto en Kapso):
- `leads_tibios_isa_v2`: nombre, ciudad, tipo y presupuesto.
- `leads_isa_v2`: los 8 datos y el agendamiento.
- `isa3_seguimientos`: cadena de seguimiento por lead. Por decisión del usuario
  (2026-11-25), por ahora no se borran filas de las tablas activas.

La columna `version` vale `"v3"` en filas escritas por v3.

**Otros workflows del proyecto:**
- "Referidos Espazios": usa `referidos-guardar` y `referidos-opcion`.
- "Isa v2" y "Precalificación Leads EZ" (Isa vieja): disparadores apagados.

## Cómo trabajar en Isa v3

- Pruebas: `node --test kapso-functions/isa-v3/`. Deben pasar todas antes de
  desplegar.
- Deploy del motor: el código desplegado es `motor.js` sin líneas en blanco ni
  comentarios de línea completa, con un comentario de cabecera. Después de
  `update_function` se compara lo subido contra el build (0 diferencias) y se
  hace `deploy_function`.
- Deploy de `isa3-seguimientos`: se genera con
  `node kapso-functions/isa-v3/build-seguimientos.mjs <motor-build> <salida>`
  y se sube igual.
- Cambios al prompt del agente o al grafo del Workflow: con
  `update_workflow` + `publish_workflow`, y se sincronizan en `docs/`.
- Cualquier cambio que pueda afectar el funcionamiento de v3 en producción
  (motor, seguimientos, Workflow, o un deploy de Railway) se avisa al usuario
  **antes** de aplicarlo.

## Google

`GOOGLE_SERVICE_ACCOUNT_JSON` en Railway es un token de usuario OAuth
(`espazios.co@gmail.com`), no una cuenta de servicio: la política del
proyecto de Google Cloud bloquea las llaves de cuenta de servicio. La app
OAuth está en "En producción", así que el token no vence a los 7 días. Si
vuelve a fallar con `invalid_grant`, el paso a paso para renovarlo está en
el historial, sección "Autenticacion con Google".

Hoja de tarifas: "Tarifas Ilustrativas - Isa", pestañas "Tarifas" (una fila
por m²) e "Incluye" (paquete, zona, item).

## Pendientes

- `sync_hubspot`: sin construir.
- Calendar API para agendar sin el link estático (roadmap).
- Cerrar las ejecuciones de Isa v2 que siguen en espera. Después, archivar v2 y
  la Isa vieja y borrar sus funciones.
- Migrar la política de privacidad del Claude Artifact a `espazios.com.co`.

## Convenciones de código

- TypeScript con módulos ES y sin paso de build; se ejecuta con `tsx`.
- Las Kapso Functions son un solo archivo JS con `async function handler(request, env)` global.
- Credenciales solo por variables de entorno o secrets de Kapso, nunca en el
  repo. `.env.example` documenta cada variable.
- Sin dependencias nuevas sin necesidad clara.
