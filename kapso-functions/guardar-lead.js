// Kapso Function — codigo fuente del tool "guardar_lead" de Isa v2.
//
// El nombre de la funcion en el dashboard de Kapso NO tiene que ser
// "guardar_lead" (de hecho no puede — los nombres de funcion solo
// aceptan guiones, no guion bajo; ver kapso-functions/README.md, que
// usa "guardar-lead-isa-v2" para no chocar con una funcion existente de
// la Isa vieja). El nombre que SI debe ser exactamente "guardar_lead" es
// el del *tool* del agent node (paso 3 del README) — eso es lo que
// llama `docs/isa-v2-system-prompt.md`.
//
// Tool que llama el agent node de Isa v2 para guardar (crear o
// actualizar) el lead en la base de datos D1 del proyecto de Kapso.
// Se llama DOS veces en la misma conversacion:
//   1. Justo despues de generar el estimado ilustrativo (seccion 6.1 del
//      system prompt) — ya tiene los 8 datos de calificacion.
//   2. Justo despues de confirmar el agendamiento (seccion 9) — agrega
//      tipo_agendamiento / fecha_llamada / hora_llamada / notas.
//
// El telefono del contacto NUNCA lo manda Isa como argumento — Kapso lo
// inyecta solo en `execution_context.context.phone_number` en cada
// invocacion de tool (ver docs/flows/step-types/agent-node.mdx,
// "Payload structure"). Se usa como llave primaria para no duplicar
// leads entre la llamada 1 y la llamada 2.
//
// Bug real encontrado 2026-09-11 y confirmado en produccion 2026-09-17
// (8 de 10 invocaciones recientes fallando con 400): los leads que
// llegan por un anuncio de clic-a-WhatsApp de Instagram/Messenger no
// traen `phone_number` ni `contact.wa_id` — Meta no comparte el numero
// real en ese flujo. Kapso SI manda en esos casos un identificador
// estable por contacto, `context.contact.business_scoped_user_id`
// (duplicado tambien en `context.whatsapp_business_scoped_user_id`),
// confirmado via `search_logs` (`function_invocation_event`) en un caso
// real (Yesid Pintor, `phone_number` y `contact.wa_id` ambos null,
// `business_scoped_user_id: "CO.2184210032444768"`). Sin este fallback,
// esos leads nunca se guardaban — perdida de datos silenciosa para todo
// un segmento (leads de anuncios de Instagram/Messenger), no un caso
// raro aislado. El formato distingue solo: un `business_scoped_user_id`
// se ve como "CO.xxxxxxxxxxxx" (no es un numero marcable), a diferencia
// de un telefono real ("57xxxxxxxxxx") — quien lea `leads-reporte-isa-v2`
// debe confirmar el numero real con el cliente antes de llamar si la
// columna `telefono` tiene ese formato.
//
// Deploy: Kapso dashboard -> Functions -> New function -> pegar este
// archivo completo -> Runtime: Cloudflare Workers -> Deploy.
// No necesita Secrets ni bindings adicionales — env.DB (D1) esta
// disponible automaticamente en todo function del proyecto.

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const input = body.input || {};
  const executionContext = body.execution_context || {};
  const context = executionContext.context || {};
  const whatsappContext = body.whatsapp_context || {};

  const telefono =
    context.phone_number ||
    whatsappContext.phone_number ||
    (context.contact && context.contact.wa_id) ||
    (context.contact && context.contact.business_scoped_user_id) ||
    context.whatsapp_business_scoped_user_id ||
    null;

  if (!telefono) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "No se pudo identificar el contacto (phone_number, contact.wa_id y business_scoped_user_id vacios).",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS leads_isa_v2 (
      telefono TEXT PRIMARY KEY,
      nombre TEXT,
      ciudad TEXT,
      tipo_proyecto TEXT,
      presupuesto TEXT,
      conjunto_o_barrio TEXT,
      m2 REAL,
      banos INTEGER,
      plazo TEXT,
      correo TEXT,
      tipo_agendamiento TEXT,
      fecha_llamada TEXT,
      hora_llamada TEXT,
      notas_agendamiento TEXT,
      conversation_id TEXT,
      creado_en TEXT,
      actualizado_en TEXT
    )`
  ).run();

  // Solo estas columnas se pueden escribir — cualquier otra cosa que
  // venga en `input` (o venga vacia/null) se ignora, nunca se inserta
  // texto libre sin validar en el SET/INSERT dinamico de abajo.
  const camposPermitidos = [
    "nombre",
    "ciudad",
    "tipo_proyecto",
    "presupuesto",
    "conjunto_o_barrio",
    "m2",
    "banos",
    "plazo",
    "correo",
    "tipo_agendamiento",
    "fecha_llamada",
    "hora_llamada",
    "notas_agendamiento",
  ];

  const camposPresentes = camposPermitidos.filter(
    (campo) => input[campo] !== undefined && input[campo] !== null && input[campo] !== ""
  );

  const ahora = new Date().toISOString();
  const conversationId = context.conversation_id || null;

  const existente = await env.DB.prepare("SELECT telefono FROM leads_isa_v2 WHERE telefono = ?")
    .bind(telefono)
    .first();

  if (existente) {
    if (camposPresentes.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, telefono, mensaje: "Lead ya existia, sin campos nuevos que actualizar." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    const setClause = camposPresentes.map((campo) => `${campo} = ?`).join(", ");
    const valores = camposPresentes.map((campo) => input[campo]);
    await env.DB.prepare(
      `UPDATE leads_isa_v2 SET ${setClause}, actualizado_en = ?, conversation_id = ? WHERE telefono = ?`
    )
      .bind(...valores, ahora, conversationId, telefono)
      .run();
  } else {
    const columnas = ["telefono", ...camposPresentes, "conversation_id", "creado_en", "actualizado_en"];
    const marcadores = columnas.map(() => "?").join(", ");
    const valores = [telefono, ...camposPresentes.map((campo) => input[campo]), conversationId, ahora, ahora];
    await env.DB.prepare(`INSERT INTO leads_isa_v2 (${columnas.join(", ")}) VALUES (${marcadores})`)
      .bind(...valores)
      .run();
  }

  return new Response(
    JSON.stringify({ ok: true, telefono, campos_guardados: camposPresentes }),
    { headers: { "Content-Type": "application/json" } }
  );
}
