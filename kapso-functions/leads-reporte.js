// Kapso Function — "leads_reporte"
//
// NO es un tool del agent node — es un endpoint de solo lectura para que
// el equipo comercial vea los leads que guardo `guardar_lead.js` en la
// base de datos D1 del proyecto. Se abre directo en el navegador con la
// URL de invoke de esta funcion (Kapso dashboard -> Functions -> esta
// funcion -> "Invoke URL").
//
// Seguridad: si defines el Secret `REPORT_TOKEN` en esta funcion (tab
// "Secrets" del dashboard), el reporte exige `?token=ese-valor` en la
// URL para mostrar los datos. Si NO lo defines, el reporte queda abierto
// para cualquiera con el link (la URL de invoke ya es larga/no listada,
// pero no es una contrasena real) — se recomienda configurar el token,
// sobre todo si `public_endpoint` queda en true.
//
// Deploy: Kapso dashboard -> Functions -> New function -> pegar este
// archivo completo -> Runtime: Cloudflare Workers -> marcar
// "Public endpoint" (para poder abrirlo en el navegador sin X-API-Key)
// -> Deploy. Luego, opcional, Secrets -> agregar REPORT_TOKEN.
//
// Uso: abrir la Invoke URL en el navegador para la tabla HTML, o agregar
// `?format=json` para consumirlo desde otro sistema.

async function handler(request, env) {
  const url = new URL(request.url);

  if (env.REPORT_TOKEN) {
    const token = url.searchParams.get("token");
    if (token !== env.REPORT_TOKEN) {
      return new Response("No autorizado. Agrega ?token=... a la URL (pide el valor a quien administra el proyecto de Kapso).", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
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

  const rows = await env.DB.prepare("SELECT * FROM leads ORDER BY actualizado_en DESC").all();
  const leads = rows.results || [];

  if (url.searchParams.get("format") === "json") {
    return new Response(JSON.stringify({ ok: true, total: leads.length, leads }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const columnas = [
    "telefono",
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
    "creado_en",
    "actualizado_en",
  ];

  const escapeHtml = (valor) =>
    String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const filas = leads
    .map((lead) => `<tr>${columnas.map((c) => `<td>${escapeHtml(lead[c])}</td>`).join("")}</tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Leads Isa v2 — Espazios</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; background: #F6FAF8; color: #123B38; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    p.meta { color: #4F6B67; margin-top: 0; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; background: #fff; }
    th, td { border: 1px solid #DCEAE1; padding: 6px 10px; text-align: left; white-space: nowrap; }
    th { background: #EAF6EF; position: sticky; top: 0; }
    tr:nth-child(even) { background: #FAFCFB; }
  </style>
</head>
<body>
  <h1>Leads Isa v2</h1>
  <p class="meta">${leads.length} lead(s) — actualizado al cargar esta pagina</p>
  <div style="overflow-x:auto">
    <table>
      <thead><tr>${columnas.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
