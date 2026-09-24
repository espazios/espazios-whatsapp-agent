// Kapso Function — codigo fuente del tool "guardar_lead_tibio" de Isa v2.
//
// El nombre de la funcion en el dashboard de Kapso puede ser cualquier
// slug valido (minusculas, numeros, guiones) — se recomienda
// "guardar-lead-tibio-isa-v2" para seguir el mismo patron que
// "guardar-lead-isa-v2" (ver kapso-functions/README.md).
//
// Guarda un "lead tibio": alguien que ya dio nombre, ciudad,
// tipo_proyecto y presupuesto, sin importar si el presupuesto paso el
// filtro de la seccion 6 del prompt ni si la conversacion sigue despues
// de eso. Es una captura temprana, independiente y mas amplia que
// `guardar_lead_db` (que solo guarda hasta que el cliente completa los
// 8 datos y llega al estimado) — sirve para no perder contacto de
// alguien que se cerro por presupuesto/cobertura pero que podria volver
// mas adelante.
//
// El telefono y el username de WhatsApp NUNCA los manda Isa como
// argumento — se identifican solos por el contexto de la conversacion,
// igual que en `guardar-lead.js` (ver ese archivo para el detalle de
// por que hace falta el fallback a `business_scoped_user_id`: leads que
// llegan por anuncios de clic-a-WhatsApp de Instagram/Messenger no
// traen `phone_number` ni `contact.wa_id`).
//
// Deploy: Kapso dashboard -> Functions -> New function -> pegar este
// archivo completo -> Runtime: Cloudflare Workers -> Deploy.
// No necesita Secrets ni bindings adicionales — env.DB (D1) esta
// disponible automaticamente en todo function del proyecto (es la
// MISMA base D1 que usa `guardar-lead.js`, solo una tabla nueva
// separada dentro de ella).

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

  // El "@usuario" de WhatsApp (funcionalidad de handles) — puede venir
  // vacio si el contacto no configuro uno; nunca bloquea el guardado.
  const username =
    (context.contact && context.contact.username) || context.whatsapp_username || null;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS leads_tibios_isa_v2 (
      telefono TEXT PRIMARY KEY,
      nombre TEXT,
      ciudad TEXT,
      tipo_proyecto TEXT,
      presupuesto TEXT,
      username TEXT,
      conversation_id TEXT,
      creado_en TEXT,
      actualizado_en TEXT
    )`
  ).run();

  const camposPermitidos = ["nombre", "ciudad", "tipo_proyecto", "presupuesto"];
  const camposPresentes = camposPermitidos.filter(
    (campo) => input[campo] !== undefined && input[campo] !== null && input[campo] !== ""
  );

  const ahora = new Date().toISOString();
  const conversationId = context.conversation_id || null;

  const existente = await env.DB.prepare("SELECT telefono FROM leads_tibios_isa_v2 WHERE telefono = ?")
    .bind(telefono)
    .first();

  // Nunca pisa un `username` ya guardado con null solo porque esta
  // invocacion puntual no logro derivarlo del contexto.
  const camposAActualizar = username ? [...camposPresentes, "username"] : camposPresentes;

  if (existente) {
    if (camposAActualizar.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, telefono, mensaje: "Lead ya existia, sin campos nuevos que actualizar." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    const setClause = camposAActualizar.map((campo) => `${campo} = ?`).join(", ");
    const valores = camposAActualizar.map((campo) => (campo === "username" ? username : input[campo]));
    await env.DB.prepare(
      `UPDATE leads_tibios_isa_v2 SET ${setClause}, actualizado_en = ?, conversation_id = ? WHERE telefono = ?`
    )
      .bind(...valores, ahora, conversationId, telefono)
      .run();
  } else {
    const columnas = ["telefono", ...camposPresentes, "username", "conversation_id", "creado_en", "actualizado_en"];
    const marcadores = columnas.map(() => "?").join(", ");
    const valores = [
      telefono,
      ...camposPresentes.map((campo) => input[campo]),
      username,
      conversationId,
      ahora,
      ahora,
    ];
    await env.DB.prepare(`INSERT INTO leads_tibios_isa_v2 (${columnas.join(", ")}) VALUES (${marcadores})`)
      .bind(...valores)
      .run();
  }

  return new Response(
    JSON.stringify({ ok: true, telefono, campos_guardados: camposAActualizar }),
    { headers: { "Content-Type": "application/json" } }
  );
}
