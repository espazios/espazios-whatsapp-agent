// Kapso Function — "guardar_lead"
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
    null;

  if (!telefono) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "No se pudo identificar el telefono del contacto (execution_context.context.phone_number vacio).",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
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

  const existente = await env.DB.prepare("SELECT telefono FROM leads WHERE telefono = ?")
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
      `UPDATE leads SET ${setClause}, actualizado_en = ?, conversation_id = ? WHERE telefono = ?`
    )
      .bind(...valores, ahora, conversationId, telefono)
      .run();
  } else {
    const columnas = ["telefono", ...camposPresentes, "conversation_id", "creado_en", "actualizado_en"];
    const marcadores = columnas.map(() => "?").join(", ");
    const valores = [telefono, ...camposPresentes.map((campo) => input[campo]), conversationId, ahora, ahora];
    await env.DB.prepare(`INSERT INTO leads (${columnas.join(", ")}) VALUES (${marcadores})`)
      .bind(...valores)
      .run();
  }

  return new Response(
    JSON.stringify({ ok: true, telefono, campos_guardados: camposPresentes }),
    { headers: { "Content-Type": "application/json" } }
  );
}
