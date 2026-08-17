# Espazios — Agente de ventas IA para WhatsApp

Este repositorio implementa el agente conversacional de WhatsApp para Espazios
(remodelacion de hogar y carpinteria a medida, Colombia). El diseno completo
de arquitectura vive en el documento de arquitectura compartido con el equipo;
este archivo contiene las reglas de negocio y convenciones que el codigo debe
respetar, para que tanto Claude Code (en desarrollo) como el agente en
produccion trabajen con la misma informacion.

## Estado del proyecto

Fase actual: cotizador (Drive -> Sheets -> PDF) construido y pendiente de
credenciales reales; canal de WhatsApp (`src/channel/`) construido sobre
**Kapso** y pendiente de que exista un proyecto/API key de Kapso. Aun no hay
orquestador (Agente Supervisor) ni conexion con HubSpot ni Calendar.

**Canal de WhatsApp = Kapso, no Meta Cloud API directo.** Kapso es un BSP
("WhatsApp for developers") que se encarga de conectar el numero de negocio,
plantillas y onboarding, y expone el mismo SDK tipado de la Cloud API
enrutado por su proxy con un solo API key — evita que nosotros construyamos
cliente HTTP, manejo de plantillas y verificacion de numero desde cero.
Tambien ofrece un servidor MCP para que un agente (Claude) opere WhatsApp
directamente como herramientas, ademas del SDK que ya usamos en
`src/channel/kapso-client.ts`. Doc: https://docs.kapso.ai/docs/introduction

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

- [ ] Cuenta y proyecto de Kapso creados (requiere Meta Business Manager
      del lado de Espazios) + `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`,
      `KAPSO_WEBHOOK_SECRET`. Para pruebas se puede usar la opcion "Instant
      Setup" de Kapso (numero de prueba pre-verificado, sin tocar el numero
      real de Espazios todavia).
- [ ] Confirmar en el dashboard de Kapso el nombre exacto de la cabecera y
      el secreto de firma de los webhooks reenviados (ver TODO en
      `src/channel/webhook.ts`).
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
