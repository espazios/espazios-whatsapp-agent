// referidos-opcion · Kapso Function (decide node del workflow "Referidos Espazios")
// Lee qué botón tocó la persona en el mensaje de bienvenida.
// Canal de referidos, separado de Isa: no lee ni escribe ninguna tabla de Isa.
//   referir    -> botón "Referir" (o escribió "referir"): se envía el formulario
//   no_referir -> botón "No voy a referir": despedida y fin
//   expirado   -> pasaron 24 h sin respuesta: termina sin enviar nada
//   otro       -> escribió algo distinto: se le recuerda tocar un botón

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const edges = Array.isArray(body.available_edges) ? body.available_edges : [];
  const pick = (label) => (edges.length === 0 || edges.includes(label) ? label : edges[0]);

  if (body.execution_context?.system?.last_resume?.reason === "timeout") return responder(pick("expirado"));

  const mensajes = body.whatsapp_context?.messages || [];
  let ultimo = null;
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].direction === "inbound") { ultimo = mensajes[i]; break; }
  }
  const boton = String(ultimo?.reply_option_id || "").toLowerCase();
  const texto = String(ultimo?.reply_option_title || (typeof ultimo?.content === "string" ? ultimo.content : "") || "")
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  if (boton === "no_referir" || /^no\b/.test(texto)) return responder(pick("no_referir"));
  if (boton === "referir" || /^referir\b/.test(texto)) return responder(pick("referir"));
  return responder(pick("otro"));
}

function responder(edge) {
  return new Response(JSON.stringify({ next_edge: edge }), { headers: { "Content-Type": "application/json" } });
}
