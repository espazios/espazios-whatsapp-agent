# Espazios — Agente de ventas IA para WhatsApp

Este repositorio implementa el agente conversacional de WhatsApp para Espazios
(remodelacion de hogar y carpinteria a medida, Colombia). El diseno completo
de arquitectura vive en el documento de arquitectura compartido con el equipo;
este archivo contiene las reglas de negocio y convenciones que el codigo debe
respetar, para que tanto Claude Code (en desarrollo) como el agente en
produccion trabajen con la misma informacion.

## Estado del proyecto

Fase actual: cotizador (Drive -> Sheets -> PDF) construido y pendiente de
credenciales reales; servidor de herramientas (`src/tools-server.ts`)
expone `/tools/generar-cotizacion` para que lo llame el agent node de
Kapso. Aun no hay Workflow nuevo creado en Kapso, ni herramientas de
agendamiento (Calendar) o CRM (HubSpot).

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

## Pendiente de informacion (bloquea partes del flujo)

- [ ] Servidor de herramientas desplegado en una URL publica (o tunel de
      desarrollo) para que el agent node de Kapso pueda llamarlo —
      `PUBLIC_BASE_URL` en `.env`.
- [ ] Crear el Workflow nuevo en el dashboard de Kapso (agent node, system
      prompt, conectar `/tools/generar-cotizacion` como webhook tool) sin
      tocar el Workflow de la Isa actual.
- [ ] `KAPSO_API_KEY` / `KAPSO_PHONE_NUMBER_ID` para cuando se construya el
      envio de seguimientos programados (`kapso-client.ts`).
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
