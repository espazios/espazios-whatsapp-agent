// referidos-palabra-clave · Kapso Function (decide node del workflow "Referidos Espazios")
// Canal de referidos, separado de Isa: no lee ni escribe ninguna tabla de Isa.
//   referir -> el mensaje empieza con REFERIR: se envía el formulario
//   otro    -> cualquier otro mensaje: el workflow termina sin responder

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const edges = Array.isArray(body.available_edges) ? body.available_edges : [];
  const pick = (label) => (edges.length === 0 || edges.includes(label) ? label : edges[0]);

  const mensajes = body.whatsapp_context?.messages || [];
  let texto = body.execution_context?.vars?.last_user_input || "";
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].direction === "inbound") {
      texto = typeof mensajes[i].content === "string" ? mensajes[i].content : "";
      break;
    }
  }
  const edge = /^\s*referir\b/i.test(texto) ? "referir" : "otro";
  return new Response(JSON.stringify({ next_edge: pick(edge) }), { headers: { "Content-Type": "application/json" } });
}
