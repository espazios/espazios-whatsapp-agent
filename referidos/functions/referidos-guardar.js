// referidos-guardar · Kapso Function (function node del workflow "Referidos Espazios")
// Guarda la respuesta del formulario en la tabla propia `referidos_formulario`.
// Sin reglas de atribución y sin tocar tablas de Isa.
// Devuelve vars.referido_estado y vars.referido_mensaje (el workflow envía el mensaje).

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const r = respuestaFormulario(body);
  if (!r) return salida("sin_respuesta", "No recibimos el formulario. Cuando quieras recomendar a alguien, escribe REFERIR.");

  const nombre = limpiar(r.nombre_referido, 60);
  const celular = celularColombia(r.celular_referido);
  if (!nombre || !celular) {
    return salida("celular_invalido",
      `El celular "${r.celular_referido || ""}" no parece un celular colombiano de 10 dígitos. Escribe REFERIR para enviarlo de nuevo.`);
  }
  if (!(r.consentimiento === true || r.consentimiento === "true")) {
    return salida("sin_consentimiento", "Necesitamos que la persona haya aceptado que Espazios la contacte. Escribe REFERIR cuando lo tengas.");
  }

  const ctx = body.execution_context?.context || {};
  const telefonoReferidor = String(ctx.phone_number || ctx.contact?.wa_id ||
    body.whatsapp_context?.conversation?.phone_number || "").replace(/\D/g, "") || null;
  const id = crypto.randomUUID();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS referidos_formulario (
    id TEXT PRIMARY KEY, telefono_referidor TEXT, nombre_referidor TEXT,
    nombre_referido TEXT NOT NULL, celular_referido TEXT NOT NULL, ciudad TEXT,
    tipo_proyecto TEXT, comentario TEXT, creado_en TEXT NOT NULL)`).run();
  await env.DB.prepare(
    `INSERT INTO referidos_formulario (id, telefono_referidor, nombre_referidor, nombre_referido,
       celular_referido, ciudad, tipo_proyecto, comentario, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, telefonoReferidor, limpiar(r.nombre_referidor, 60), nombre, celular, limpiar(r.ciudad, 80),
    limpiar(r.tipo_proyecto, 40), limpiar(r.comentario, 300), new Date().toISOString()).run();

  return salida("registrado", `Listo, recibimos a ${nombre}. Un asesor de Espazios lo contactará pronto. Gracias por recomendarnos.`,
    { referido_id: id });
}

// La respuesta del Flow llega en el último mensaje entrante (nfm_reply).
function respuestaFormulario(body) {
  const mensajes = body.whatsapp_context?.messages || [];
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.direction !== "inbound") continue;
    const d = parsear(m.interactive_data) || {};
    const c = parsear(d.kapso?.flow_response) || parsear(d.nfm_reply?.response_json) ||
      parsear(d.interactive?.nfm_reply?.response_json) || parsear(d.response_json);
    return c && c.celular_referido ? c : null;
  }
  return null;
}

function parsear(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch (_) { return null; }
}

function celularColombia(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return /^573\d{9}$/.test(d) ? d : null;
}

function limpiar(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function salida(estado, mensaje, extra = {}) {
  return new Response(JSON.stringify({ vars: { referido_estado: estado, referido_mensaje: mensaje, ...extra } }),
    { headers: { "Content-Type": "application/json" } });
}
