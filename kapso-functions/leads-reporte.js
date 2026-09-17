// Kapso Function — codigo fuente del endpoint "leads_reporte" de Isa v2.
//
// Igual que guardar-lead.js: el nombre de la funcion en el dashboard de
// Kapso puede ser cualquier cosa (ver kapso-functions/README.md, usa
// "leads-reporte-isa-v2") — esta no es un tool del agent node, asi que
// ni siquiera hace falta que el nombre coincida con nada del prompt.
//
// NO es un tool del agent node — es un endpoint de solo lectura para que
// el equipo comercial vea los leads que guardaron `guardar-lead.js` y
// `guardar-lead-tibio.js` en la base de datos D1 del proyecto. Se abre
// directo en el navegador con la URL de invoke de esta funcion (Kapso
// dashboard -> Functions -> esta funcion -> "Invoke URL").
//
// Actualizado 2026-09-17: muestra las DOS tablas de leads en la misma
// pagina — `leads_isa_v2` (calificacion completa, los 8 datos hasta
// correo) y `leads_tibios_isa_v2` (captura temprana: nombre, ciudad,
// tipo_proyecto, presupuesto, sin importar si paso el filtro o si la
// conversacion siguio). Ambas incluyen `username` (el "@usuario" de
// WhatsApp). Si la columna `telefono` de cualquiera de las dos tablas
// tiene formato "CO.xxxxxxxxxxxx" en vez de un numero real
// ("57xxxxxxxxxx"), es un lead que llego sin numero compartido (anuncio
// de clic-a-WhatsApp de Instagram/Messenger) — confirmar el numero real
// con el cliente antes de llamar.
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
// Uso: abrir la Invoke URL en el navegador para las tablas HTML, o
// agregar `?format=json` para consumirlo desde otro sistema (json trae
// ambas tablas: `{ok, leads: {total, rows}, leads_tibios: {total, rows}}`).

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
      username TEXT,
      conversation_id TEXT,
      creado_en TEXT,
      actualizado_en TEXT
    )`
  ).run();
  // Migracion idempotente — ver la misma nota en guardar-lead.js.
  try {
    await env.DB.prepare(`ALTER TABLE leads_isa_v2 ADD COLUMN username TEXT`).run();
  } catch (err) {
    if (!String(err && err.message).toLowerCase().includes("duplicate column")) throw err;
  }

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

  const [leadsRows, tibiosRows] = await Promise.all([
    env.DB.prepare("SELECT * FROM leads_isa_v2 ORDER BY actualizado_en DESC").all(),
    env.DB.prepare("SELECT * FROM leads_tibios_isa_v2 ORDER BY actualizado_en DESC").all(),
  ]);
  const leads = leadsRows.results || [];
  const tibios = tibiosRows.results || [];

  if (url.searchParams.get("format") === "json") {
    return new Response(
      JSON.stringify({
        ok: true,
        leads: { total: leads.length, rows: leads },
        leads_tibios: { total: tibios.length, rows: tibios },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const columnasLeads = [
    "telefono",
    "username",
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

  const columnasTibios = [
    "telefono",
    "username",
    "nombre",
    "ciudad",
    "tipo_proyecto",
    "presupuesto",
    "creado_en",
    "actualizado_en",
  ];

  const escapeHtml = (valor) =>
    String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const tabla = (titulo, columnas, filas) => `
  <h2>${titulo}</h2>
  <p class="meta">${filas.length} lead(s) — actualizado al cargar esta pagina</p>
  <div style="overflow-x:auto">
    <table>
      <thead><tr>${columnas.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${filas
        .map((lead) => `<tr>${columnas.map((c) => `<td>${escapeHtml(lead[c])}</td>`).join("")}</tr>`)
        .join("")}</tbody>
    </table>
  </div>`;

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Leads Isa v2 — Espazios</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; background: #F6FAF8; color: #123B38; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin-top: 32px; margin-bottom: 4px; }
    p.meta { color: #4F6B67; margin-top: 0; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; background: #fff; }
    th, td { border: 1px solid #DCEAE1; padding: 6px 10px; text-align: left; white-space: nowrap; }
    th { background: #EAF6EF; position: sticky; top: 0; }
    tr:nth-child(even) { background: #FAFCFB; }
  </style>
</head>
<body>
  <h1>Leads Isa v2</h1>
  ${tabla("Leads calificados (hasta correo)", columnasLeads, leads)}
  ${tabla("Leads tibios (nombre + ciudad + tipo_proyecto + presupuesto)", columnasTibios, tibios)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
