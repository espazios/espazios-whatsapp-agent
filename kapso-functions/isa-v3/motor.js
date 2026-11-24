// Kapso Function — motor de Isa v3 ("isa3-motor").
//
// Va conectado como nodo `decide` (modo function) del Workflow "Isa v3".
// Es el cerebro DETERMINISTICO de la conversacion: lleva la maquina de
// estados del perfilamiento, interpreta las respuestas con reglas, aplica
// los filtros de cobertura/presupuesto, guarda los leads en D1, pide el
// estimado a Railway y manda TODOS los mensajes al cliente via la API de
// Kapso (texto, botones, listas, imagenes). No usa ningun modelo de IA.
//
// Devuelve `next_edge`:
//   - "esperar" -> nodo wait_for_response -> vuelve a este motor
//   - "desvio"  -> agente IA (responde UNA vez, complete_task) -> vuelve aqui
//   - "humano"  -> nodo handoff
//
// Ver docs/isa-v3-diseno.md para la arquitectura completa.
//
// Secrets requeridos: KAPSO_API_KEY. Binding automatico: env.DB (D1 del proyecto).
// Formato: archivo unico con `async function handler(request, env)` global,
// igual que el resto de kapso-functions/. Los tests (motor.test.mjs) cargan
// este archivo con node:vm y prueban `procesar()` sin red.

const RAILWAY_BASE = "https://espazios-whatsapp-agent-production.up.railway.app";
const KAPSO_META_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";
const CALENDAR_URL =
  "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ2JoOnboCFBDmNXuAjfh7hXLnAO2dqw9dMteg9N1iZLpHxoVL0ODnFWU2zIrfQN9vOKKxPyaQMT";
const DIRECCION_OFICINA = "Carrera 73 Bis # 49A - 73, Normandía, Bogotá";
const AVISO_DATOS = "Al continuar esta conversación, autorizas el tratamiento de tus datos personales conforme a la Ley 1581 de 2012.";

// ---------------------------------------------------------------------------
// Catalogos de negocio
// ---------------------------------------------------------------------------

const COBERTURA_COMPLETA = ["Bogotá", "Soacha"];
const COBERTURA_SOLO_CARPINTERIA = ["Mosquera", "Madrid", "Chía", "Cota", "Zipaquirá", "Cajicá", "La Calera", "Funza", "Facatativá", "Sopó"];

// alias normalizado (sin tildes, minusculas) -> ciudad canonica
const ALIAS_CIUDAD = {
  bogota: "Bogotá", "bogota dc": "Bogotá", "bogota d c": "Bogotá", bta: "Bogotá", bgta: "Bogotá", bogta: "Bogotá", bogot: "Bogotá", bog: "Bogotá",
  // localidades y sectores de Bogota que la gente da como "ciudad"
  usaquen: "Bogotá", chapinero: "Bogotá", "san cristobal": "Bogotá", usme: "Bogotá", tunjuelito: "Bogotá",
  bosa: "Bogotá", kennedy: "Bogotá", fontibon: "Bogotá", engativa: "Bogotá", suba: "Bogotá",
  "barrios unidos": "Bogotá", teusaquillo: "Bogotá", "puente aranda": "Bogotá", "ciudad bolivar": "Bogotá",
  "rafael uribe": "Bogotá", hayuelos: "Bogotá", modelia: "Bogotá", salitre: "Bogotá", cedritos: "Bogotá",
  normandia: "Bogotá", castilla: "Bogotá", tintal: "Bogotá", madelena: "Bogotá", "ciudad salitre": "Bogotá",
  "la felicidad": "Bogotá", "cuatro vientos": "Bogotá", "4 vientos": "Bogotá", "ciudad la salle": "Bogotá",
  soacha: "Soacha", "ciudad verde": "Soacha",
  mosquera: "Mosquera", madrid: "Madrid", chia: "Chía", cota: "Cota", zipaquira: "Zipaquirá", zipa: "Zipaquirá",
  cajica: "Cajicá", "la calera": "La Calera", calera: "La Calera",
  // fuera de cobertura conocidas (se reconocen para cerrar sin preguntar de nuevo)
  funza: "Funza", facatativa: "Facatativá", faca: "Facatativá", fusagasuga: "Fusagasugá", girardot: "Girardot", sibate: "Sibaté",
  tocancipa: "Tocancipá", sopo: "Sopó", tenjo: "Tenjo", tabio: "Tabio", gachancipa: "Gachancipá",
  "el rosal": "El Rosal", subachoque: "Subachoque", medellin: "Medellín", cali: "Cali",
  barranquilla: "Barranquilla", cartagena: "Cartagena", bucaramanga: "Bucaramanga",
  villavicencio: "Villavicencio", ibague: "Ibagué", tunja: "Tunja", pereira: "Pereira", manizales: "Manizales",
  armenia: "Armenia", neiva: "Neiva", "santa marta": "Santa Marta", cucuta: "Cúcuta", pasto: "Pasto",
};

const TIPOS = {
  tp_obra: "Solo Obra Blanca",
  tp_intermedio: "Intermedio",
  tp_total: "Remodelación Total",
  tp_carpinteria: "Carpintería",
};

// Paquetes del estimado. `clave` es lo que exige /tools/detalle-paquete.
const PAQUETES = [
  { id: "obra", clave: "Solo Obra Blanca", visible: "Solo Obra Blanca", boton: "Ver Obra Blanca" },
  { id: "intermedio", clave: "Intermedio", visible: "Intermedio", boton: "Ver Intermedio" },
  { id: "total", clave: "Remodelacion completa", visible: "Remodelación Total", boton: "Ver Remod. Total" },
];

const FRANJAS = [
  { id: "f_8", titulo: "8 a 10 am", desde: 8, hasta: 10 },
  { id: "f_10", titulo: "10 am a 12 m", desde: 10, hasta: 12 },
  { id: "f_12", titulo: "12 m a 2 pm", desde: 12, hasta: 14 },
  { id: "f_14", titulo: "2 a 4 pm", desde: 14, hasta: 16 },
  { id: "f_16", titulo: "4 a 6 pm", desde: 16, hasta: 18 },
];

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tieneUnaPalabra(n, palabras) {
  return palabras.some((p) => new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(n));
}

function esPregunta(texto) {
  const t = String(texto || "");
  if (t.includes("?") || t.includes("¿")) return true;
  const n = norm(t);
  return /^(que|como|cuanto|cuantos|cuanta|cuando|donde|cual|cuales|tienen|hacen|manejan|ofrecen|incluye|puedo|pueden|me pueden|me podrias|podrian|quisiera saber|quiero saber|hay )\b/.test(n);
}

function pideHumano(texto) {
  const n = norm(texto);
  return /(hablar|comunicar|pasar|contactar)(me)? con (un|una)? ?(persona|humano|asesor|asesora|agente|ejecutivo)/.test(n) ||
    /\b(quiero|necesito) (un|una) (asesor|asesora|persona|humano)\b/.test(n) ||
    /\bno (quiero|me gusta) (hablar con )?(un )?(bot|robot|maquina)\b/.test(n);
}

function esAfirmacion(texto) {
  const n = norm(texto).replace(/[.!,]/g, "");
  return /^(si+|s|sip|sii|claro|correcto|exacto|asi es|afirmativo|dale|de una|ok|okay|okey|listo|por supuesto|obvio|yes|ese soy yo|esa soy yo|soy yo|el mismo|la misma|con el|con ella)\b/.test(n);
}

function esNegacion(texto) {
  const n = norm(texto).replace(/[.!,]/g, "");
  return /^(no|nop|nel|negativo|para nada|todavia no|aun no|ahorita no|no gracias)\b/.test(n);
}

function titulo(s) {
  return String(s)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const PALABRAS_NEGOCIO = ["sas", "s.a.s", "ltda", "inmobiliaria", "constructora", "tienda", "store", "shop", "espazios", "empresa", "ventas", "servicios", "oficial"];

function nombrePerfilValido(nombre) {
  if (!nombre) return null;
  const limpio = String(nombre).replace(/[^\p{L}\s'.-]/gu, " ").replace(/\s+/g, " ").trim();
  if (limpio.length < 2 || limpio.length > 40) return null;
  const n = norm(limpio);
  if (PALABRAS_NEGOCIO.some((p) => n.split(" ").includes(p))) return null;
  const palabras = limpio.split(" ").filter((p) => p.replace(/[.'-]/g, "").length >= 1);
  if (palabras.length === 0 || palabras.length > 4 || palabras[0].replace(/[.'-]/g, "").length < 2) return null;
  // Debe parecer nombre: al menos la primera palabra con 2+ letras
  return titulo(palabras.slice(0, 3).join(" "));
}

function extraerNombreDeTexto(texto) {
  const original = String(texto || "");
  const m = original.match(/(?:me llamo|mi nombre es|soy|habla|hablas con|te habla|le habla)\s+([\p{L}][\p{L}' ]{1,40})/iu);
  if (m) {
    const candidato = m[1].split(/\s+(?:y|me|estoy|tengo|quiero|de|del|desde|con|para)\s+/i)[0];
    const valido = nombrePerfilValido(candidato);
    if (valido && !/^(el|la|un|una|interesad[oa]|nuev[oa])$/i.test(norm(candidato).split(" ")[0])) return valido;
  }
  return null;
}

function interpretarNombreLibre(texto) {
  const desdeFrase = extraerNombreDeTexto(texto);
  if (desdeFrase) return desdeFrase;
  const t = String(texto || "").trim().replace(/[.!]+$/, "");
  if (esPregunta(t)) return null;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(t)) return null;
  const palabras = t.split(/\s+/);
  if (palabras.length > 4) return null;
  const n = norm(t);
  if (esAfirmacion(n) || esNegacion(n) || /^(hola|buenas|buenos dias|buenas tardes|buenas noches|gracias)\b/.test(n)) return null;
  return nombrePerfilValido(t);
}

function buscarCiudad(texto) {
  const n = norm(texto).replace(/[.,;:()!]/g, " ");
  // primero alias de varias palabras
  const alias = Object.keys(ALIAS_CIUDAD).sort((a, b) => b.length - a.length);
  for (const a of alias) {
    if (tieneUnaPalabra(n, [a.replace(/ /g, "\\s+")])) return ALIAS_CIUDAD[a];
  }
  return null;
}

function coberturaDe(ciudad) {
  if (COBERTURA_COMPLETA.includes(ciudad)) return "completa";
  if (COBERTURA_SOLO_CARPINTERIA.includes(ciudad)) return "carpinteria";
  return "fuera";
}

function interpretarTipo(texto, opcionId) {
  if (opcionId && TIPOS[opcionId]) return TIPOS[opcionId];
  const n = norm(texto).replace(/[.!]/g, "");
  const num = n.match(/^(?:opcion|la|el|numero)?\s*([1-4])\b/);
  if (num) return Object.values(TIPOS)[Number(num[1]) - 1];
  if (/obra blanca|\bblanca\b|solo acabados|acabados fijos|solo obra/.test(n)) return "Solo Obra Blanca";
  if (/intermedi/.test(n)) return "Intermedio";
  if (/total|completa|completo|todo|full|integral/.test(n)) return "Remodelación Total";
  if (/carpinter|closet|cocina|mueble|puertas/.test(n)) return "Carpintería";
  return null;
}

// --- numeros -----------------------------------------------------------------

const UNIDADES = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const ESPECIALES = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, cien: 100, ciento: 100,
};
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

function numeroEnPalabras(n) {
  const m = n.match(/\b(veinti(un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))\b/);
  if (m) return 20 + UNIDADES[m[2]];
  const d = n.match(/\b(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)(?: y (un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))?\b/);
  if (d) return DECENAS[d[1]] + (d[2] ? UNIDADES[d[2]] : 0);
  for (const [k, v] of Object.entries(ESPECIALES)) if (new RegExp(`\\b${k}\\b`).test(n)) return v;
  for (const [k, v] of Object.entries(UNIDADES)) if (new RegExp(`\\b${k}\\b`).test(n)) return v;
  return null;
}

// Extrae numeros "15", "15.000.000", "15'000.000", "37,78", "37.5"
function numerosEn(texto) {
  const out = [];
  const re = /\d{1,3}(?:[.'´ ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(texto))) {
    let raw = m[0];
    let valor;
    if (/^\d{1,3}(?:[.'´ ]\d{3})+/.test(raw)) {
      valor = Number(raw.replace(/,\d+$/, "").replace(/[.'´ ]/g, ""));
    } else {
      valor = Number(raw.replace(",", "."));
    }
    if (!Number.isNaN(valor)) out.push({ valor, index: m.index, fin: m.index + raw.length });
  }
  return out;
}

function aMillones(valor, n) {
  if (valor >= 100000) return valor / 1e6;
  if (/\bmil\b/.test(n) && !/millon/.test(n) && valor < 1000) return valor / 1000; // "15 mil" = 0.015M
  return valor;
}

function formatoMillones(m) {
  const r = Math.round(m * 10) / 10;
  return "$" + (Number.isInteger(r) ? String(r) : String(r).replace(".", ","));
}

function interpretarPresupuesto(texto) {
  const n = norm(texto);
  if (/(\bm2\b|\bmt2\b|\bmts\b|\bmetros\b|m²|\bmt\b)/.test(n) && !/millon|mill|palo|\$|pesos/.test(n)) {
    return { aclarar: "area" };
  }
  const nums = numerosEn(n);
  if (nums.length >= 2 && /\b(a|y|-|hasta|entre|o)\b/.test(n.slice(nums[0].fin, nums[1].index + 1))) {
    const a = aMillones(nums[0].valor, n);
    const b = aMillones(nums[1].valor, n);
    if (a > 0 && b > 0) return { rango: [Math.min(a, b), Math.max(a, b)] };
  }
  if (nums.length >= 1) {
    const v = aMillones(nums[0].valor, n);
    if (v > 0) return { valor: v };
  }
  const palabras = numeroEnPalabras(n);
  if (palabras && /millon|mill|palo|\$/.test(n)) return { valor: palabras };
  if (palabras && n.split(" ").length <= 3) return { valor: palabras };
  return null;
}

function interpretarM2(texto) {
  const n = norm(texto);
  const nums = numerosEn(n).filter((x) => x.valor >= 1 && x.valor <= 2000);
  if (nums.length === 0) {
    const p = numeroEnPalabras(n);
    return p ? { valor: p } : null;
  }
  let elegido = nums[0];
  if (nums.length > 1) {
    const iPriv = n.indexOf("privad");
    if (iPriv >= 0) {
      elegido = nums.reduce((best, x) => (Math.abs(x.index - iPriv) < Math.abs(best.index - iPriv) ? x : best));
    } else {
      elegido = nums.reduce((min, x) => (x.valor < min.valor ? x : min));
    }
  }
  const v = Math.round(elegido.valor);
  if (v < 15 || v > 400) return { fueraDeRango: v };
  return { valor: v };
}

function interpretarBanos(texto, opcionId) {
  if (opcionId === "b_1") return 1;
  if (opcionId === "b_2") return 2;
  const n = norm(texto);
  if (/^\s*(1|uno|un)\b/.test(n) || /\bun bano\b|\b1 bano/.test(n)) return 1;
  if (/^\s*(2|dos)\b/.test(n) || /\bdos banos\b|\b2 banos/.test(n)) return 2;
  return null;
}

function interpretarPlazo(texto) {
  const t = String(texto || "").trim();
  const n = norm(t);
  if (!t) return null;
  if (/\b(ya|inmediat|de una|lo antes|cuanto antes|lo mas pronto|ahora mismo|pronto|urgente|esta semana)\b/.test(n)) return "Inmediato";
  const meses = n.match(/(\d+|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s*(a\s*\d+\s*)?mes/);
  if (meses) {
    const base = /\d/.test(meses[1]) ? Number(meses[1]) : numeroEnPalabras(meses[1]);
    const hasta = meses[2] ? Number(meses[2].replace(/\D/g, "")) : null;
    if (hasta) return `${base} a ${hasta} meses`;
    return base === 1 ? "1 mes" : `${base} meses`;
  }
  if (/medio ano|seis meses/.test(n)) return "6 meses";
  if (/\bano\b|\banos\b/.test(n)) {
    const a = n.match(/(\d+)\s*anos?/);
    return a ? `${a[1]} años` : "1 año";
  }
  if (/semana/.test(n)) return "Inmediato";
  if (/no se|no tengo fecha|todavia no|aun no se|no estoy segur|depende/.test(n)) return "Sin definir";
  if (t.length <= 60) return t.charAt(0).toUpperCase() + t.slice(1);
  return null;
}

function interpretarCorreo(texto) {
  const m = String(texto || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// --- fechas (America/Bogota, UTC-5 sin horario de verano) ------------------

function fechaBogota(date) {
  const d = new Date(date.getTime() - 5 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours() };
}

function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31) - 1, dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, mes, dia);
}

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Festivos de Colombia (Ley 18 de 1983, "Ley Emiliani")
function festivosColombia(y) {
  const DIA = 86400000;
  const lunesSiguiente = (ms) => {
    const dow = new Date(ms).getUTCDay();
    return dow === 1 ? ms : ms + ((8 - dow) % 7) * DIA;
  };
  const fijos = [[0, 1], [4, 1], [6, 20], [7, 7], [11, 8], [11, 25]].map(([m, d]) => Date.UTC(y, m, d));
  const trasladables = [[0, 6], [2, 19], [5, 29], [7, 15], [9, 12], [10, 1], [10, 11]].map(([m, d]) => lunesSiguiente(Date.UTC(y, m, d)));
  const p = pascua(y);
  const moviles = [p - 3 * DIA, p - 2 * DIA, lunesSiguiente(p + 39 * DIA), lunesSiguiente(p + 60 * DIA), lunesSiguiente(p + 68 * DIA)];
  return new Set([...fijos, ...trasladables, ...moviles].map(iso));
}

function diasDisponibles(ahora, cantidad = 6) {
  const hoy = fechaBogota(ahora);
  const out = [];
  let ms = Date.UTC(hoy.y, hoy.m, hoy.d) + 86400000; // desde mañana
  const festivos = new Set([...festivosColombia(hoy.y), ...festivosColombia(hoy.y + 1)]);
  while (out.length < cantidad) {
    const d = new Date(ms);
    const clave = iso(ms);
    if (d.getUTCDay() !== 0 && !festivos.has(clave)) {
      const etiqueta = `${DIAS_SEMANA[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
      out.push({ id: `d_${clave}`, fecha: clave, titulo: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) });
    }
    ms += 86400000;
  }
  return out;
}

function interpretarDia(texto, opcionId, dias) {
  if (opcionId && opcionId.startsWith("d_")) return dias.find((d) => d.id === opcionId) || { id: opcionId, fecha: opcionId.slice(2), titulo: opcionId.slice(2) };
  const n = norm(texto);
  if (/pasado manana/.test(n)) return dias[1] || null;
  if (/\bmanana\b/.test(n) && !/en la manana|por la manana/.test(n)) return dias[0] || null;
  const idx = DIAS_SEMANA.map((d) => norm(d)).findIndex((d) => n.includes(d));
  if (idx >= 0) return dias.find((d) => norm(d.titulo).startsWith(norm(DIAS_SEMANA[idx]))) || null;
  const fecha = n.match(/\b(\d{1,2})\s*(?:\/|-|de)\s*(\d{1,2}|[a-z]{3,})/);
  if (fecha) {
    const dia = Number(fecha[1]);
    return dias.find((d) => Number(d.fecha.slice(8, 10)) === dia) || null;
  }
  return null;
}

function interpretarFranja(texto, opcionId) {
  if (opcionId) {
    const f = FRANJAS.find((x) => x.id === opcionId);
    if (f) return f;
  }
  const n = norm(texto);
  const h = n.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm|a\.?m|p\.?m|de la tarde|de la manana|m)?\b/);
  if (h) {
    let hora = Number(h[1]);
    const suf = h[2] || "";
    if ((/p/.test(suf) || /tarde/.test(suf) || /tarde/.test(n)) && hora < 12) hora += 12;
    else if (!suf && hora >= 1 && hora <= 6) hora += 12; // "a las 3" = 3 pm
    const f = FRANJAS.find((x) => hora >= x.desde && hora < x.hasta);
    if (f) return f;
  }
  if (/en la manana|por la manana|temprano/.test(n)) return FRANJAS[0];
  if (/medio ?dia|almuerzo/.test(n)) return FRANJAS[2];
  if (/en la tarde|por la tarde/.test(n)) return FRANJAS[3];
  return null;
}

// ---------------------------------------------------------------------------
// Redaccion
// ---------------------------------------------------------------------------

const CONECTORES = ["listo", "genial", "claro que sí", "con gusto", "", "de una", "perfecto", ""];

function conector(vars, conNombre) {
  const i = Number(vars.turno || 0) % CONECTORES.length;
  const base = CONECTORES[i];
  const nombre = conNombre && vars.nombre ? vars.nombre.split(" ")[0] : "";
  if (!base && !nombre) return "";
  if (!base) return `gracias ${nombre}.`;
  return nombre ? `${base}, gracias ${nombre}.` : `${base}.`;
}

function bloque(intro, pregunta) {
  return intro ? `${intro}\n\n*${pregunta}*` : `*${pregunta}*`;
}

const OPCIONES_TIPO = [
  { id: "tp_obra", title: "Solo Obra Blanca", description: "Pisos, muros, pintura, acabados fijos" },
  { id: "tp_intermedio", title: "Intermedio", description: "Obra blanca + cocina y closets" },
  { id: "tp_total", title: "Remodelación Total", description: "Obra blanca + carpintería completa" },
  { id: "tp_carpinteria", title: "Carpintería", description: "Cocina, closets, muebles a medida" },
];

// WhatsApp permite maximo 10 filas por lista: primero Bogota/Soacha/municipio/otra,
// y si elige "Municipio cercano", una segunda lista con los 10 municipios (solo carpinteria).
const filaCiudad = (c) => ({ id: `c_${norm(c).replace(/ /g, "_")}`, title: c });
const CIUDADES_LISTA = [
  filaCiudad("Bogotá"),
  filaCiudad("Soacha"),
  { id: "c_municipio", title: "Municipio cercano", description: "Chía, Mosquera, Funza, Cajicá..." },
  { id: "c_otra", title: "Otra ciudad" },
];
const MUNICIPIOS_LISTA = COBERTURA_SOLO_CARPINTERIA.map(filaCiudad);

// ---------------------------------------------------------------------------
// Interprete IA (nodo `interprete`, decide en modo IA, en el Workflow).
// Solo se usa cuando las reglas no entienden una respuesta de OPCION. Elige
// una etiqueta cerrada; el motor la traduce a la opcion que ya sabe procesar.
// La etiqueta "no_es_respuesta" es la PRIMERA condicion del nodo: si la IA
// falla, Kapso cae en ella y el mensaje va al agente de desvios.
// ---------------------------------------------------------------------------
const ETIQUETAS_INTERPRETE = {
  no_es_respuesta: "__no_es__",
  ciudad_otra: "__otra_ciudad__",
  ...Object.fromEntries([...CIUDADES_LISTA, ...MUNICIPIOS_LISTA]
    .filter((f) => !["c_municipio", "c_otra"].includes(f.id))
    .map((f) => ["ciudad_" + f.id.slice(2), f.id])),
  tipo_obra_blanca: "tp_obra",
  tipo_intermedio: "tp_intermedio",
  tipo_remodelacion_total: "tp_total",
  tipo_carpinteria: "tp_carpinteria",
  ver_obra_blanca: "ver_obra",
  ver_intermedio: "ver_intermedio",
  ver_remodelacion_total: "ver_total",
  quiere_agendar: "agendar",
  agenda_llamada: "ag_llamada",
  agenda_virtual: "ag_virtual",
  agenda_presencial: "ag_presencial",
};

// Que etiquetas son validas para cada campo (la IA podria elegir una de otro campo).
const PREFIJOS_CAMPO = {
  ciudad: ["ciudad_"],
  tipo_proyecto: ["tipo_"],
  paquete_o_agendar: ["ver_", "quiere_agendar"],
  tipo_agendamiento: ["agenda_"],
};

function opcionDesdeEtiqueta(campo, etiqueta) {
  if (!etiqueta || !(etiqueta in ETIQUETAS_INTERPRETE)) return null;
  if (etiqueta === "no_es_respuesta") return "__no_es__";
  const validos = PREFIJOS_CAMPO[campo] || [];
  if (!validos.some((p) => etiqueta.startsWith(p))) return null;
  return ETIQUETAS_INTERPRETE[etiqueta];
}

// Busca en los eventos recientes del flujo la decision del nodo interprete.
// Solo mira campos explicitos de la decision (no el prompt, que lista todas
// las etiquetas). Si no encuentra nada, devuelve null y el motor muestra la
// lista de opciones: degradacion segura.
function resultadoInterpreteDe(flowEvents, desde) {
  const evs = (Array.isArray(flowEvents) ? flowEvents : [])
    .filter((e) => /decision/.test(String(e.event_type || e.eventType || "")))
    .sort((a, b) => Date.parse(b.created_at || b.createdAt || 0) - Date.parse(a.created_at || a.createdAt || 0));
  const limite = desde ? Date.parse(desde) - 2000 : 0;
  for (const e of evs) {
    if (limite && Date.parse(e.created_at || e.createdAt || 0) < limite) continue;
    const p = e.payload || {};
    const candidatos = [e.edge_label, e.edgeLabel, p.edge_label, p.edgeLabel, p.next_edge, p.selected_edge,
      p.selected_condition, p.decision, p.label, p.result, p.condition, p.chosen, p.response];
    for (const c of candidatos) {
      const t = typeof c === "string" ? c.trim() : c && typeof c === "object" ? (c.label || c.edge_label || "") : "";
      if (t && t in ETIQUETAS_INTERPRETE) return t;
    }
  }
  return null;
}

function saludo(vars, nombrePerfil, nombreDicho) {
  const gancho = "hablas con Isa de Espazios — te acompañamos con los acabados y remodelación de tu vivienda. Aquí podemos avanzar con una cotización ilustrativa.";
  if (nombreDicho) return `Hola ${nombreDicho.split(" ")[0]}! ${gancho}`;
  if (nombrePerfil) return `Hola! ${gancho} Hablo con ${nombrePerfil}?`;
  return `Hola! ${gancho} Con quién tengo el gusto?`;
}

// Mensaje(s) que hacen la pregunta del paso actual.
function preguntar(paso, vars, intro, ctx) {
  const t = (cuerpo) => ({ tipo: "texto", body: cuerpo });
  switch (paso) {
    case "nombre_confirmar":
      return [t(bloque(intro, `Hablo con ${vars.nombre_perfil}?`))];
    case "nombre":
      return [t(bloque(intro, "Con quién tengo el gusto?"))];
    case "ciudad":
      return [t(bloque(intro, "En qué ciudad está ubicada tu vivienda?"))];
    case "ciudad_lista":
      return [{ tipo: "lista", body: bloque(intro, "En qué ciudad está la vivienda?"), boton: "Ver ciudades", filas: CIUDADES_LISTA }];
    case "ciudad_municipio":
      return [{ tipo: "lista", body: bloque(intro, "En qué municipio está la vivienda?"), boton: "Ver municipios", filas: MUNICIPIOS_LISTA }];
    case "tipo_proyecto":
      return [{ tipo: "lista", body: bloque(intro, "Qué te gustaría hacer en tu proyecto?"), boton: "Ver opciones", filas: OPCIONES_TIPO }];
    case "presupuesto":
      return [t(bloque(intro, "Cuál es tu presupuesto aproximado para el proyecto?"))];
    case "presupuesto_confirmar":
      return [{ tipo: "botones", body: bloque(intro, `Entonces estamos hablando de un presupuesto alrededor de ${vars.presupuesto_tentativo} millones, cierto?`), botones: [{ id: "pc_si", title: "Sí, correcto" }, { id: "pc_no", title: "No" }] }];
    case "objecion1":
      return [{
        tipo: "botones",
        body: bloque(
          [intro, `entiendo ${vars.nombre ? vars.nombre.split(" ")[0] : ""}, gracias por contarme.`.replace(" ,", ","), "Como es la vivienda en la que vas a vivir, vale la pena hacerla bien desde el inicio — y hacer el proyecto completo de una vez suele salir más práctico que ir por partes. Nuestros proyectos de este tipo arrancan desde $15 millones."].filter(Boolean).join(" "),
          "Sería posible completar el presupuesto hasta ese valor, con recursos propios o buscando financiación por tu cuenta?"
        ),
        botones: [{ id: "ob1_si", title: "Sí, puedo" }, { id: "ob1_no", title: "No por ahora" }],
      }];
    case "objecion2":
      return [{
        tipo: "botones",
        body: bloque(
          [intro, "te entiendo, gracias por la sinceridad. Te propongo dos caminos: cotizar Carpintería (cocina, closets, muebles a medida), que arranca desde $10 millones, o guardar tu contacto para retomarlo si más adelante ajustas el presupuesto."].filter(Boolean).join(" "),
          "Cuál prefieres?"
        ),
        botones: [{ id: "ob2_carp", title: "Cotizar carpintería" }, { id: "ob2_guardar", title: "Guardar contacto" }],
      }];
    case "conjunto_o_barrio":
      return [t(bloque(intro, "En qué conjunto o barrio está la vivienda?"))];
    case "m2":
      return [t(bloque(intro, "Cuántos metros cuadrados tiene el área privada del apartamento?"))];
    case "banos":
      return [{ tipo: "botones", body: bloque(intro, "Cuántos baños tiene el apartamento?"), botones: [{ id: "b_1", title: "1 baño" }, { id: "b_2", title: "2 baños" }] }];
    case "plazo":
      return [t(bloque(intro, "En cuánto tiempo te gustaría arrancar la obra?"))];
    case "correo":
      return [t(bloque([intro, "ya casi terminamos 😊 para guardar tus datos y porque ya te voy a compartir un valor ilustrativo de tu cotización por este mismo chat,"].filter(Boolean).join(" "), "Me confirmas tu correo?"))];
    case "post_estimado":
    case "duda_o_agendar":
      return [{ tipo: "botones", body: bloque(intro, "Tienes alguna duda, o te gustaría que agendemos una cotización personalizada con un Ejecutivo Comercial?"), botones: [{ id: "agendar", title: "Agendar sesión" }, { id: "duda", title: "Tengo una duda" }] }];
    case "tipo_agendamiento":
      return [{ tipo: "botones", body: bloque(intro, "Prefieres una llamada o una reunión (virtual o presencial)?"), botones: [{ id: "ag_llamada", title: "Llamada" }, { id: "ag_virtual", title: "Reunión virtual" }, { id: "ag_presencial", title: "Reunión presencial" }] }];
    case "llamada_dia":
      return [{ tipo: "lista", body: bloque(intro, "Qué día te queda bien para la llamada?"), boton: "Ver días", filas: diasDisponibles(ctx.ahora).map((d) => ({ id: d.id, title: d.titulo })) }];
    case "llamada_franja":
      return [{ tipo: "lista", body: bloque(intro, `En qué horario podemos llamarte el ${vars.fecha_llamada_texto}?`), boton: "Ver horarios", filas: FRANJAS.map((f) => ({ id: f.id, title: f.titulo })) }];
    default:
      return [];
  }
}

const ACLARACIONES = {
  nombre: "no te entendí bien el nombre 🙈",
  ciudad: "no logré identificar la ciudad, me ayudas eligiendo de la lista 👇",
  tipo_proyecto: "para no confundirme, elige una de estas opciones 👇",
  presupuesto: "para tenerlo claro, me lo puedes escribir en millones de pesos? (por ejemplo 20 o 35)",
  area: "ese número parece el área en m², no el presupuesto 🙂 me lo escribes en millones de pesos? (por ejemplo 20 o 35)",
  m2: "me lo puedes escribir solo con el número de metros? (por ejemplo 45)",
  m2_rango: "ese valor de metros se me hace raro 🤔 me confirmas el área privada en m²? (por ejemplo 45)",
  banos: "elige una de las dos opciones 👇",
  correo: "parece que el correo quedó incompleto, me lo escribes de nuevo? (por ejemplo nombre@gmail.com)",
  llamada_dia: "elige uno de estos días 👇",
  llamada_franja: "elige una de estas franjas 👇",
  opciones: "para no confundirme, elige una de estas opciones 👇",
};

// ---------------------------------------------------------------------------
// Logica de negocio: cual es el siguiente paso del perfilamiento
// ---------------------------------------------------------------------------

function siguientePaso(v) {
  if (v.cerrado) return "cerrado";
  if (!v.nombre) return v.nombre_perfil && !v.nombre_rechazado ? "nombre_confirmar" : "nombre";
  if (!v.ciudad) return v.ciudad_municipio ? "ciudad_municipio" : v.ciudad_intentos >= 1 ? "ciudad_lista" : "ciudad";
  const cob = coberturaDe(v.ciudad);
  if (cob === "fuera") return "cerrar_cobertura";
  if (!v.tipo_proyecto) return "tipo_proyecto";
  if (cob === "carpinteria" && v.tipo_proyecto !== "Carpintería") return "cerrar_cobertura_tipo";
  if (!v.presupuesto) return v.presupuesto_tentativo ? "presupuesto_confirmar" : "presupuesto";
  const monto = Number(String(v.presupuesto).replace("$", "").replace(",", "."));
  const minimo = v.tipo_proyecto === "Carpintería" ? 10 : 15;
  if (monto < minimo) {
    if (v.tipo_proyecto === "Carpintería") return "cerrar_presupuesto_carp";
    if (!v.objecion_etapa) return "objecion1";
    if (v.objecion_etapa === 1) return "objecion1";
    if (v.objecion_etapa === 2) return "objecion2";
    return "cerrar_presupuesto";
  }
  if (!v.conjunto_o_barrio) return "conjunto_o_barrio";
  if (!v.m2) return "m2";
  if (v.m2 >= 31 && v.m2 <= 44 && !v.banos) return "banos";
  if (!v.plazo) return "plazo";
  if (!v.correo) return "correo";
  if (!v.estimado_enviado) return "estimado";
  return v.paso_agenda || "post_estimado";
}

function mensajeCierre(tipo, v) {
  const nombre = v.nombre ? v.nombre.split(" ")[0] : "";
  switch (tipo) {
    case "cerrar_cobertura":
      return `muchas gracias por escribirnos${nombre ? ", " + nombre : ""} 🙏 por ahora no estamos llegando a ${v.ciudad === "Otra" ? "tu ciudad" : v.ciudad} — trabajamos en Bogotá, Soacha y, solo para carpintería, en algunos municipios de la Sabana. Ojalá podamos acompañarte más adelante, que estés muy bien!`;
    case "cerrar_cobertura_tipo":
      return `gracias por contarme${nombre ? ", " + nombre : ""}. En ${v.ciudad} por ahora solo estamos haciendo proyectos de carpintería (cocina, closets, muebles a medida), así que para ${v.tipo_proyecto} no tenemos cobertura allá todavía. Si en algún momento quieres cotizar carpintería, aquí estoy 😊`;
    case "cerrar_presupuesto_carp":
      return `gracias por la sinceridad${nombre ? ", " + nombre : ""}. Para ese presupuesto hoy no tenemos una opción de carpintería que encaje (arranca desde $10 millones). Si más adelante cambia el panorama, con gusto te acompañamos 😊`;
    case "cerrar_presupuesto":
      return `listo${nombre ? " " + nombre : ""}, dejé guardado tu contacto. Cuando quieras retomar tu proyecto me escribes por aquí y seguimos donde quedamos 😊`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// procesar(): funcion pura. Recibe el estado (vars), la entrada nueva del
// cliente (o null si se vuelve de un desvio) y devuelve vars a actualizar,
// acciones a ejecutar y el siguiente edge.
// ---------------------------------------------------------------------------

function procesar(varsIn, entrada, ctx) {
  const v = { ...varsIn };
  const set = {};
  const acciones = [];
  const asignar = (k, val) => { v[k] = val; set[k] = val; };
  asignar("turno", Number(v.turno || 0) + 1);

  // ---- 1) Primer mensaje de la conversacion: saludo ------------------------
  if (!v.paso) {
    const nombrePerfil = nombrePerfilValido(ctx.perfil);
    const nombreDicho = entrada ? extraerNombreDeTexto(entrada.texto) : null;
    if (nombrePerfil) asignar("nombre_perfil", nombrePerfil);
    if (nombreDicho) asignar("nombre", nombreDicho);
    const ciudadDicha = entrada ? buscarCiudad(entrada.texto) : null;
    if (ciudadDicha) asignar("ciudad", ciudadDicha);
    acciones.push({ tipo: "texto", body: saludo(v, nombrePerfil, nombreDicho) });
    if (nombreDicho) {
      // Ya dijo su nombre: el saludo no lleva pregunta, se sigue al siguiente dato
      return finalizar(v, set, acciones, ctx, { intro: "" });
    }
    asignar("paso", nombrePerfil ? "nombre_confirmar" : "nombre");
    return { vars: set, acciones, edge: "esperar" };
  }

  // ---- 2) Volviendo del agente IA (sin mensaje nuevo): retomar el flujo -----
  // Vuelve del interprete IA (sin mensaje nuevo): aplica su resultado.
  if (v.interpretacion_pendiente) {
    asignar("interpretacion_pendiente", false);
    if (!entrada) {
      const campo = v.campo_interpretar;
      const etiqueta = ctx.resultadoInterprete || null;
      asignar("ultima_interpretacion", `${campo}:${etiqueta || "sin_resultado"}`);
      const opcion = opcionDesdeEtiqueta(campo, etiqueta);
      if (opcion === "__no_es__") {
        asignar("pregunta_pendiente", textoPregunta(v.paso, v, ctx));
        return { vars: set, acciones, edge: "desvio" };
      }
      if (!opcion || opcion === "__otra_ciudad__") {
        // No hubo resultado util: se muestran las opciones. Para "otra ciudad"
        // se pide confirmar en la lista, porque cerrar por cobertura es definitivo.
        let pasoLista = v.paso;
        if (campo === "ciudad") {
          pasoLista = v.paso === "ciudad_municipio" ? "ciudad_municipio" : "ciudad_lista";
          asignar("ciudad_intentos", 1);
        }
        acciones.push(...preguntar(pasoLista, v, ACLARACIONES[campo === "ciudad" ? "ciudad" : "opciones"], ctx));
        asignar("paso", pasoLista);
        return { vars: set, acciones, edge: "esperar" };
      }
      entrada = { texto: v.mensaje_cliente || "", opcionId: opcion, tieneMedia: false, interpretada: true };
    }
    // Si llego un mensaje nuevo mientras interpretaba, se procesa ese.
  }

  if (!entrada) {
    const p = siguientePaso(v);
    if (p === "cerrado" || p === "agendado" || p === "agendado_link" || p === "estimado") {
      if (p === "estimado") return finalizar(v, set, acciones, ctx, { intro: "" });
      return { vars: set, acciones, edge: "esperar" };
    }
    if (p === "post_estimado") {
      asignar("paso_agenda", "duda_o_agendar");
      acciones.push(...preguntar("duda_o_agendar", v, "", ctx));
      asignar("paso", "duda_o_agendar");
      return { vars: set, acciones, edge: "esperar" };
    }
    return finalizar(v, set, acciones, ctx, { intro: "para seguir con tu cotización 👇", forzarPregunta: true });
  }

  // ---- 3) Hay mensaje nuevo del cliente ------------------------------------
  const texto = entrada.texto || "";
  const opcion = entrada.opcionId || null;
  // El agente de desvios responde a ESTE mensaje. Si un mensaje llega mientras
  // el agente corre, el motor lo lee directo y last_user_input quedaria viejo
  // (bug visto en la primera prueba real: la IA respondio dos veces lo mismo).
  asignar("last_user_input", texto);
  asignar("mensaje_cliente", texto);

  if (!opcion && pideHumano(texto)) {
    acciones.push({ tipo: "texto", body: "claro que sí, ya le aviso a una persona del equipo para que continúe contigo por aquí 😊" });
    asignar("handoff", true);
    return { vars: set, acciones, edge: "humano" };
  }

  // Conversacion ya cerrada o agendada: todo lo que escriba lo atiende la IA
  if (["cerrado", "agendado"].includes(v.paso)) {
    asignar("pregunta_pendiente", "");
    return { vars: set, acciones, edge: "desvio" };
  }

  if (v.paso === "estimado_reintento") {
    if (esPregunta(texto) || entrada.tieneMedia) return { vars: set, acciones, edge: "desvio" };
    return finalizar(v, set, acciones, ctx, { intro: "" });
  }

  const r = interpretar(v.paso, texto, opcion, entrada, v, ctx);
  for (const [k, val] of Object.entries(r.set || {})) asignar(k, val);

  if (r.interpretar) {
    if (!entrada.interpretada) {
      asignar("interpretacion_pendiente", true);
      asignar("campo_interpretar", r.interpretar);
      asignar("interpretar_desde", ctx.ahora.toISOString());
      return { vars: set, acciones, edge: "interpretar" };
    }
    acciones.push(...preguntar(v.paso, v, ACLARACIONES.opciones, ctx));
    return { vars: set, acciones, edge: "esperar" };
  }

  if (r.aclarar) {
    const intentos = Number((v.intentos && v.intentos[v.paso]) || 0) + 1;
    asignar("intentos", { ...(v.intentos || {}), [v.paso]: intentos });
    if (intentos >= 2 || esPregunta(texto) || entrada.tieneMedia) {
      asignar("pregunta_pendiente", textoPregunta(v.paso, v, ctx));
      return { vars: set, acciones, edge: "desvio" };
    }
    const msgs = preguntar(r.pasoAclaracion || v.paso, v, ACLARACIONES[r.aclarar] || "", ctx);
    if (r.pasoAclaracion) asignar("paso", r.pasoAclaracion);
    acciones.push(...msgs);
    return { vars: set, acciones, edge: "esperar" };
  }

  if (r.desvio) {
    asignar("pregunta_pendiente", textoPregunta(v.paso, v, ctx));
    return { vars: set, acciones, edge: "desvio" };
  }

  // Dato tomado pero ademas trae una pregunta o foto: la IA responde y luego
  // el motor sigue con el siguiente dato (no se vuelve a preguntar lo ya dado).
  const desviarDespues = !!r.ok && (esPregunta(texto) || entrada.tieneMedia) && !opcion;
  if (v.intentos && v.intentos[v.paso]) asignar("intentos", { ...v.intentos, [v.paso]: 0 });

  acciones.push(...(r.acciones || []));
  if (r.edge) return { vars: set, acciones, edge: r.edge };

  if (desviarDespues) {
    asignar("pregunta_pendiente", "");
    return { vars: set, acciones, edge: "desvio" };
  }
  return finalizar(v, set, acciones, ctx, { intro: r.intro !== undefined ? r.intro : conector(v, Number(v.turno) % 3 === 0) });
}

function textoPregunta(paso, v, ctx) {
  const msgs = preguntar(paso, v, "", ctx);
  return msgs.length ? msgs[0].body.replace(/\*/g, "") : "";
}

// Despues de interpretar: guarda leads si corresponde, calcula el siguiente
// paso y arma los mensajes. `opts.intro` va antes de la pregunta.
function finalizar(v, set, acciones, ctx, opts) {
  const asignar = (k, val) => { v[k] = val; set[k] = val; };

  // lead tibio: nombre + ciudad + tipo + presupuesto
  if (v.nombre && v.ciudad && v.tipo_proyecto && v.presupuesto) {
    const firma = [v.nombre, v.ciudad, v.tipo_proyecto, v.presupuesto].join("|");
    if (v.tibio_firma !== firma) {
      acciones.push({ op: "guardar_tibio" });
      asignar("tibio_firma", firma);
    }
  }

  const p = siguientePaso(v);

  if (p.startsWith("cerrar_")) {
    acciones.push({ tipo: "texto", body: mensajeCierre(p, v) });
    asignar("cerrado", p);
    asignar("paso", "cerrado");
    return { vars: set, acciones, edge: "esperar" };
  }

  if (p === "estimado") {
    acciones.push({ tipo: "texto", body: `${opts.intro ? opts.intro + " " : ""}gracias! dame un momento mientras preparo tu estimado ilustrativo ⏳`.trim() });
    acciones.push({ op: "guardar_lead" });
    acciones.push({ op: "estimado" });
    asignar("paso", "post_estimado");
    return { vars: set, acciones, edge: "esperar" };
  }

  let intro = opts.intro;
  if (!v.aviso_datos && p !== "nombre" && p !== "nombre_confirmar") {
    intro = [intro, AVISO_DATOS].filter(Boolean).join(" ");
    asignar("aviso_datos", true);
  }
  acciones.push(...preguntar(p, v, intro, ctx));
  asignar("paso", p);
  return { vars: set, acciones, edge: "esperar" };
}

// Interpreta la respuesta segun el paso. Devuelve:
//   { ok, set, intro?, acciones?, edge? } | { aclarar, pasoAclaracion? } | { desvio: true }
function interpretar(paso, texto, opcion, entrada, v, ctx) {
  const pregunta = esPregunta(texto);
  switch (paso) {
    case "nombre_confirmar": {
      const dicho = extraerNombreDeTexto(texto);
      if (dicho) return { ok: true, set: { nombre: dicho }, intro: `un gusto, ${dicho.split(" ")[0]}!` };
      if (esAfirmacion(texto)) return { ok: true, set: { nombre: v.nombre_perfil }, intro: `un gusto, ${v.nombre_perfil.split(" ")[0]}!` };
      if (esNegacion(texto)) {
        const resto = String(texto).replace(/^\s*no\b[\s,.!]*/i, "");
        const nombre = interpretarNombreLibre(resto);
        if (nombre) return { ok: true, set: { nombre }, intro: `uy, disculpa! un gusto, ${nombre.split(" ")[0]}.` };
        return { ok: true, set: { nombre_rechazado: true }, intro: "uy, disculpa!" };
      }
      const libre = !pregunta ? interpretarNombreLibre(texto) : null;
      if (libre) return { ok: true, set: { nombre: libre }, intro: `un gusto, ${libre.split(" ")[0]}!` };
      return { desvio: true };
    }
    case "nombre": {
      const nombre = interpretarNombreLibre(texto);
      if (nombre) return { ok: true, set: { nombre }, intro: `un gusto, ${nombre.split(" ")[0]}!` };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { aclarar: "nombre" };
    }
    case "ciudad":
    case "ciudad_lista":
    case "ciudad_municipio": {
      if (opcion === "c_otra") return { ok: true, set: { ciudad: "Otra" } };
      if (opcion === "c_municipio") return { ok: true, set: { ciudad_municipio: true }, intro: "" };
      if (opcion && opcion.startsWith("c_")) {
        const fila = [...CIUDADES_LISTA, ...MUNICIPIOS_LISTA].find((c) => c.id === opcion);
        if (fila) return { ok: true, set: { ciudad: fila.title } };
      }
      const ciudad = buscarCiudad(texto);
      if (ciudad) return { ok: true, set: { ciudad } };
      if (pregunta || entrada.tieneMedia || norm(texto).split(" ").length > 8) return { desvio: true };
      return { interpretar: "ciudad" };
    }
    case "tipo_proyecto": {
      const tipo = interpretarTipo(texto, opcion);
      if (tipo) return { ok: true, set: { tipo_proyecto: tipo } };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { interpretar: "tipo_proyecto" };
    }
    case "presupuesto": {
      const p = interpretarPresupuesto(texto);
      if (!p) return pregunta || entrada.tieneMedia || norm(texto).length > 0 && !/\d/.test(texto) ? { desvio: true } : { aclarar: "presupuesto" };
      if (p.aclarar) return { aclarar: p.aclarar };
      if (p.rango) return { ok: true, set: { presupuesto_tentativo: formatoMillones(p.rango[0]).replace("$", "") } };
      return { ok: true, set: { presupuesto: formatoMillones(p.valor) } };
    }
    case "presupuesto_confirmar": {
      if (opcion === "pc_si" || esAfirmacion(texto)) return { ok: true, set: { presupuesto: "$" + v.presupuesto_tentativo, presupuesto_tentativo: null } };
      const p = interpretarPresupuesto(texto);
      if (p && p.valor) return { ok: true, set: { presupuesto: formatoMillones(p.valor), presupuesto_tentativo: null } };
      if (opcion === "pc_no" || esNegacion(texto)) return { ok: true, set: { presupuesto_tentativo: null } };
      return { desvio: true };
    }
    case "objecion1": {
      const p = interpretarPresupuesto(texto);
      if (p && p.valor && !opcion) {
        if (p.valor >= 15) return { ok: true, set: { presupuesto: formatoMillones(p.valor), objecion_etapa: 3 } };
        return { ok: true, set: { presupuesto: formatoMillones(p.valor), objecion_etapa: 2 } };
      }
      if (opcion === "ob1_si" || esAfirmacion(texto)) return { ok: true, set: { presupuesto: "$15", objecion_etapa: 3 }, intro: "qué bien!" };
      if (opcion === "ob1_no" || esNegacion(texto)) return { ok: true, set: { objecion_etapa: 2 }, intro: "" };
      return { desvio: true };
    }
    case "objecion2": {
      const n = norm(texto);
      if (opcion === "ob2_carp" || /carpinter/.test(n)) return { ok: true, set: { tipo_proyecto: "Carpintería", objecion_etapa: 3 }, intro: "de una!" };
      if (opcion === "ob2_guardar" || /guard|contacto|despues|luego|mas adelante/.test(n)) return { ok: true, set: { objecion_etapa: 4 } };
      return { desvio: true };
    }
    case "conjunto_o_barrio": {
      const t = String(texto).trim().replace(/[.!]+$/, "");
      if (!t || pregunta || entrada.tieneMedia) return { desvio: true };
      return { ok: true, set: { conjunto_o_barrio: t.slice(0, 120) } };
    }
    case "m2": {
      const m = interpretarM2(texto);
      if (m && m.valor) return { ok: true, set: { m2: m.valor } };
      if (m && m.fueraDeRango) return { aclarar: "m2_rango" };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { aclarar: "m2" };
    }
    case "banos": {
      const b = interpretarBanos(texto, opcion);
      if (b) return { ok: true, set: { banos: b } };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { aclarar: "banos" };
    }
    case "plazo": {
      if (pregunta || entrada.tieneMedia) return { desvio: true };
      const p = interpretarPlazo(texto);
      return p ? { ok: true, set: { plazo: p } } : { desvio: true };
    }
    case "correo": {
      const c = interpretarCorreo(texto);
      if (c) return { ok: true, set: { correo: c }, intro: "" };
      if (/@/.test(texto)) return { aclarar: "correo" };
      return { desvio: true };
    }
    case "post_estimado":
    case "duda_o_agendar":
      return interpretarPostEstimado(texto, opcion, v);
    case "tipo_agendamiento": {
      const n = norm(texto);
      if (opcion === "ag_llamada" || /llamad|llamen|llamame|telefon/.test(n)) {
        return { ok: true, set: { tipo_agendamiento: "llamada", paso_agenda: "llamada_dia" }, intro: "" };
      }
      if (opcion === "ag_virtual" || /virtual|meet|video|zoom|online/.test(n)) return agendarReunion("reunion_virtual", v);
      if (opcion === "ag_presencial" || /presencial|oficina|en persona|personal/.test(n)) return agendarReunion("reunion_presencial", v);
      if (/reunion/.test(n)) return { aclarar: "tipo_agendamiento" };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { interpretar: "tipo_agendamiento" };
    }
    case "llamada_dia": {
      const dias = diasDisponibles(ctx.ahora);
      const d = interpretarDia(texto, opcion, dias);
      if (d) return { ok: true, set: { fecha_llamada: d.fecha, fecha_llamada_texto: d.titulo.toLowerCase(), paso_agenda: "llamada_franja" }, intro: "" };
      return pregunta || entrada.tieneMedia ? { desvio: true } : { aclarar: "llamada_dia" };
    }
    case "llamada_franja": {
      const f = interpretarFranja(texto, opcion);
      if (!f) return pregunta || entrada.tieneMedia ? { desvio: true } : { aclarar: "llamada_franja" };
      const nombre = v.nombre ? " " + v.nombre.split(" ")[0] : "";
      return {
        ok: true,
        set: { hora_llamada: f.titulo, paso_agenda: "agendado", paso: "agendado" },
        acciones: [
          { op: "guardar_lead", extra: { tipo_agendamiento: "llamada", fecha_llamada: v.fecha_llamada, hora_llamada: f.titulo } },
          { tipo: "texto", body: `listo${nombre}! quedó agendada tu llamada para el *${v.fecha_llamada_texto}* entre *${f.titulo}* 📞\n\nUn Ejecutivo Comercial de Espazios te va a llamar en ese horario para armar tu cotización personalizada. Si te surge cualquier duda antes, me escribes por aquí 😊` },
        ],
        edge: "esperar",
      };
    }
    case "agendado_link": {
      const n = norm(texto);
      // Cambia de opinion o pide el link de nuevo: se resuelve sin IA.
      if (/llamad|llamen|llamame|telefon/.test(n)) {
        return { ok: true, set: { tipo_agendamiento: "llamada", paso_agenda: "llamada_dia" }, intro: "de una, mejor te agendo una llamada." };
      }
      const confirma = /\b(ya|listo|agende|agendado|hecho|separe|reserve|quedo)\b/.test(n) && !pregunta && !/\bya no\b/.test(n);
      if (!confirma) {
        if (/virtual|meet|video|zoom|online/.test(n)) return agendarReunion("reunion_virtual", v);
        if (/presencial|oficina|en persona/.test(n)) return agendarReunion("reunion_presencial", v);
        if (/donde|link|enlace|agendar|agendo|no me (llego|aparece|sale)|no veo|no encuentro/.test(n)) {
          return agendarReunion(v.tipo_agendamiento === "reunion_presencial" ? "reunion_presencial" : "reunion_virtual", v);
        }
      }
      if (confirma) {
        return {
          ok: true,
          set: { paso: "agendado", paso_agenda: "agendado" },
          acciones: [{ tipo: "texto", body: `qué bien${v.nombre ? " " + v.nombre.split(" ")[0] : ""}! ahí nos vemos con un Ejecutivo Comercial para armar tu cotización personalizada. Si te surge cualquier duda antes, me escribes por aquí 😊` }],
          edge: "esperar",
        };
      }
      return { desvio: true };
    }
    default:
      return { desvio: true };
  }
}

function agendarReunion(tipo, v) {
  const presencial = tipo === "reunion_presencial";
  const body = presencial
    ? `genial! nuestra oficina queda en *${DIRECCION_OFICINA}*. Agenda aquí directamente el día y la hora que más te convengan para tu reunión con un Ejecutivo Comercial 👇`
    : "genial! agenda aquí directamente el día y la hora que más te convengan para tu reunión virtual con un Ejecutivo Comercial 👇";
  return {
    ok: true,
    set: { tipo_agendamiento: tipo, paso_agenda: "agendado_link", paso: "agendado_link" },
    acciones: [
      { op: "guardar_lead", extra: { tipo_agendamiento: tipo } },
      { tipo: "cta", body, display: "Agendar reunión", url: CALENDAR_URL },
    ],
    edge: "esperar",
  };
}

function paqueteDesdeTexto(n) {
  if (/obra blanca|obra/.test(n)) return PAQUETES[0];
  if (/intermedi/.test(n)) return PAQUETES[1];
  if (/total|completa/.test(n)) return PAQUETES[2];
  return null;
}

function interpretarPostEstimado(texto, opcion, v) {
  const n = norm(texto);
  if (opcion && opcion.startsWith("ver_")) {
    const p = PAQUETES.find((x) => x.id === opcion.slice(4));
    if (p) return { ok: true, set: {}, acciones: [{ op: "detalle", paquete: p.id }], edge: "esperar" };
  }
  if (opcion === "agendar" || (!opcion && /agend|cita|reunion|llamad|cotizacion personalizada|ejecutivo/.test(n) && !esPregunta(texto))) {
    return { ok: true, set: { paso_agenda: "tipo_agendamiento" }, intro: "" };
  }
  if (opcion === "duda") return { desvio: true };
  const p = !esPregunta(texto) ? paqueteDesdeTexto(n) : null;
  if (p) return { ok: true, set: {}, acciones: [{ op: "detalle", paquete: p.id }], edge: "esperar" };
  if (esAfirmacion(texto) && v.paso === "duda_o_agendar") return { ok: true, set: { paso_agenda: "tipo_agendamiento" }, intro: "" };
  if ((esNegacion(texto) || /^(gracias|ok|listo|vale)\b/.test(n)) && v.paso === "post_estimado") {
    return { ok: true, set: { paso_agenda: "duda_o_agendar" }, intro: "" };
  }
  return esPregunta(texto) ? { desvio: true } : { interpretar: "paquete_o_agendar" };
}

// Mensajes despues de recibir la respuesta de Railway
function mensajesEstimado(v, resp) {
  const nombre = v.nombre ? v.nombre.split(" ")[0] : "";
  const out = [{ tipo: "imagen", link: resp.imageUrl, caption: `${nombre ? nombre + ", a" : "A"}quí tienes tu estimado ilustrativo para ${v.m2} m² 👇` }];
  const elegido = PAQUETES.find((p) => p.visible === v.tipo_proyecto);
  if (elegido && resp.paqueteElegido && resp.paqueteElegido.imageUrl) {
    const vistos = [elegido.id];
    out.push(mensajeDetalle(elegido, resp.paqueteElegido.imageUrl, vistos, true));
    return { mensajes: out, vistos };
  }
  out.push({
    tipo: "lista",
    body: "*Te gustaría ver en detalle qué incluye alguno de estos paquetes?*",
    boton: "Ver opciones",
    filas: [
      ...PAQUETES.map((p) => ({ id: `ver_${p.id}`, title: p.visible })),
      { id: "agendar", title: "Agendar sesión", description: "Con un Ejecutivo Comercial" },
    ],
  });
  return { mensajes: out, vistos: [] };
}

function mensajeDetalle(paquete, imageUrl, vistos, esElegido) {
  const faltan = PAQUETES.filter((p) => !vistos.includes(p.id));
  const intro = esElegido
    ? `y este es el detalle de *${paquete.visible}*, el paquete que elegiste 😊`
    : `este es el detalle de *${paquete.visible}* 😊`;
  const pregunta = faltan.length
    ? `Te gustaría ver también ${faltan.map((p) => p.visible).join(" o ")}, o agendamos tu sesión con un Ejecutivo Comercial?`
    : "Te gustaría que agendemos tu cotización personalizada con un Ejecutivo Comercial?";
  return {
    tipo: "botones",
    headerImage: imageUrl,
    body: `${intro}\n\n*${pregunta}*`,
    botones: [...faltan.map((p) => ({ id: `ver_${p.id}`, title: p.boton })), { id: "agendar", title: "Agendar sesión" }],
  };
}

// ---------------------------------------------------------------------------
// Entrada: mensajes nuevos del cliente desde whatsapp_context
// ---------------------------------------------------------------------------

function extraerEntrada(mensajes, varsIn) {
  const lista = Array.isArray(mensajes) ? mensajes : [];
  let desde = varsIn.ultimo_inbound_at ? Date.parse(varsIn.ultimo_inbound_at) : null;
  if (desde === null) {
    // Primera vez: solo lo que llego despues del ultimo mensaje nuestro
    const salientes = lista.filter((m) => m.direction === "outbound");
    desde = salientes.length ? Date.parse(salientes[salientes.length - 1].created_at) : 0;
  }
  const nuevos = lista.filter((m) => m.direction === "inbound" && Date.parse(m.created_at) > desde);
  if (nuevos.length === 0) return { entrada: null, ultimoAt: varsIn.ultimo_inbound_at || null };
  const ultimo = nuevos[nuevos.length - 1];
  const conOpcion = [...nuevos].reverse().find((m) => m.reply_option_id);
  const texto = nuevos
    .map((m) => m.reply_option_title || m.content || m.caption || "")
    .filter((t) => t && !/^\[(image|video|audio|document) attached\]$/i.test(t))
    .join("\n");
  return {
    entrada: {
      texto,
      opcionId: conOpcion ? conOpcion.reply_option_id : null,
      tieneMedia: nuevos.some((m) => m.has_media || ["image", "video", "document", "audio"].includes(m.message_type)),
    },
    ultimoAt: ultimo.created_at,
  };
}

// ---------------------------------------------------------------------------
// IO: envio de mensajes, Railway y D1
// ---------------------------------------------------------------------------

function payloadMensaje(a) {
  if (a.tipo === "texto") return { type: "text", text: { body: a.body, preview_url: false } };
  if (a.tipo === "imagen") return { type: "image", image: { link: a.link, caption: a.caption } };
  if (a.tipo === "botones") {
    const interactive = {
      type: "button",
      body: { text: a.body },
      action: { buttons: a.botones.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    };
    if (a.headerImage) interactive.header = { type: "image", image: { link: a.headerImage } };
    return { type: "interactive", interactive };
  }
  if (a.tipo === "lista") {
    return {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: a.body },
        action: {
          button: a.boton.slice(0, 20),
          sections: [{ title: "Opciones", rows: a.filas.map((f) => ({ id: f.id, title: f.title.slice(0, 24), ...(f.description ? { description: f.description.slice(0, 72) } : {}) })) }],
        },
      },
    };
  }
  if (a.tipo === "cta") {
    return { type: "interactive", interactive: { type: "cta_url", body: { text: a.body }, action: { name: "cta_url", parameters: { display_text: a.display, url: a.url } } } };
  }
  throw new Error("tipo de mensaje desconocido: " + a.tipo);
}

async function enviar(env, destino, a) {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", ...destino, ...payloadMensaje(a) };
  for (let intento = 0; intento < 2; intento++) {
    const res = await fetch(`${KAPSO_META_BASE}/${destino.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "X-API-Key": env.KAPSO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, phoneNumberId: undefined }),
    });
    if (res.ok) return true;
    console.log("envio fallido", res.status, await res.text().catch(() => ""));
  }
  return false;
}

async function postRailway(ruta, payload) {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(`${RAILWAY_BASE}${ruta}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return await res.json();
      console.log("railway", ruta, res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.log("railway error", ruta, String(err));
    }
  }
  return null;
}

async function guardarEnD1(env, tabla, columnas, datos, telefono, username, conversationId) {
  if (!env.DB || !telefono) return;
  const presentes = columnas.filter((c) => datos[c] !== undefined && datos[c] !== null && datos[c] !== "");
  const ahora = new Date().toISOString();
  const existente = await env.DB.prepare(`SELECT telefono FROM ${tabla} WHERE telefono = ?`).bind(telefono).first();
  const campos = username ? [...presentes, "username"] : presentes;
  const valor = (c) => (c === "username" ? username : datos[c]);
  if (existente) {
    if (!campos.length) return;
    await env.DB.prepare(`UPDATE ${tabla} SET ${campos.map((c) => `${c} = ?`).join(", ")}, actualizado_en = ?, conversation_id = ? WHERE telefono = ?`)
      .bind(...campos.map(valor), ahora, conversationId, telefono).run();
  } else {
    const cols = ["telefono", ...presentes, "username", "conversation_id", "creado_en", "actualizado_en"];
    await env.DB.prepare(`INSERT INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .bind(telefono, ...presentes.map((c) => datos[c]), username, conversationId, ahora, ahora).run();
  }
}

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));
  const ec = body.execution_context || {};
  const vars = ec.vars || {};
  const system = ec.system || {};
  const context = ec.context || {};
  const contact = context.contact || {};
  const wa = body.whatsapp_context || {};
  const conversation = wa.conversation || {};

  const { entrada, ultimoAt } = extraerEntrada(wa.messages, vars);
  const ctx = {
    perfil: contact.profile_name || contact.name || conversation.contact_name || "",
    ahora: new Date(),
    resultadoInterprete: vars.interpretacion_pendiente ? resultadoInterpreteDe(body.flow_events, vars.interpretar_desde) : null,
  };
  if (vars.interpretacion_pendiente) {
    // Diagnostico: estructura real de los eventos de decision (para ajustar el lector si hace falta).
    const decisiones = (body.flow_events || []).filter((e) => /decision/.test(String(e.event_type || e.eventType || "")));
    console.log("interprete", ctx.resultadoInterprete, JSON.stringify(decisiones.slice(-2)).slice(0, 1500));
  }

  const res = procesar(vars, entrada, ctx);
  const nuevasVars = { ...res.vars };
  if (ultimoAt) nuevasVars.ultimo_inbound_at = ultimoAt;
  const estado = { ...vars, ...nuevasVars };

  const telefono = context.phone_number || contact.wa_id || conversation.phone_number || null;
  const bsuid = contact.business_scoped_user_id || context.whatsapp_business_scoped_user_id || conversation.business_scoped_user_id || null;
  const destino = {
    phoneNumberId: (system.whatsapp_config && system.whatsapp_config.phone_number_id) || env.PHONE_NUMBER_ID,
    ...(telefono ? { to: telefono } : {}),
    ...(bsuid ? { recipient: bsuid } : {}),
  };
  const idLead = telefono || bsuid;
  const username = contact.username || context.whatsapp_username || null;
  const conversationId = context.conversation_id || conversation.id || null;

  const enviarOLog = async (a) => {
    const ok = await enviar(env, destino, a);
    if (!ok) nuevasVars.ultimo_error_envio = new Date().toISOString();
    return ok;
  };

  for (const a of res.acciones) {
    try {
      if (a.tipo) {
        await enviarOLog(a);
      } else if (a.op === "guardar_tibio") {
        await guardarEnD1(env, "leads_tibios_isa_v2", ["nombre", "ciudad", "tipo_proyecto", "presupuesto"], estado, idLead, username, conversationId);
      } else if (a.op === "guardar_lead") {
        await guardarEnD1(
          env, "leads_isa_v2",
          ["nombre", "ciudad", "tipo_proyecto", "presupuesto", "conjunto_o_barrio", "m2", "banos", "plazo", "correo", "tipo_agendamiento", "fecha_llamada", "hora_llamada"],
          { ...estado, ...(a.extra || {}) }, idLead, username, conversationId
        );
      } else if (a.op === "estimado") {
        const resp = await postRailway("/tools/estimado-ilustrativo", {
          nombre: estado.nombre, ciudad: estado.ciudad, proyecto: estado.conjunto_o_barrio,
          m2: estado.m2, banos: estado.banos || undefined, tipoProyecto: estado.tipo_proyecto,
        });
        if (!resp || !resp.imageUrl) {
          await enviarOLog({ tipo: "texto", body: "uy, tuve un problema generando tu estimado ilustrativo 🙈 escríbeme cualquier cosa en un momento y lo intento de nuevo." });
          nuevasVars.paso = "estimado_reintento";
          nuevasVars.estimado_enviado = false;
          continue;
        }
        const { mensajes, vistos } = mensajesEstimado(estado, resp);
        for (const m of mensajes) {
          await enviarOLog(m);
          await new Promise((r) => setTimeout(r, 1500)); // orden: imagen general antes del detalle
        }
        nuevasVars.estimado_enviado = true;
        nuevasVars.paquetes_vistos = vistos;
      } else if (a.op === "detalle") {
        const paquete = PAQUETES.find((p) => p.id === a.paquete);
        const resp = await postRailway("/tools/detalle-paquete", {
          nombre: estado.nombre, ciudad: estado.ciudad, proyecto: estado.conjunto_o_barrio,
          paquete: paquete.clave, m2: estado.m2, banos: estado.banos || undefined,
        });
        if (!resp || !resp.imageUrl) {
          await enviarOLog({ tipo: "texto", body: "uy, no pude generar ese detalle en este momento 🙈 me lo vuelves a pedir en un ratico?" });
          continue;
        }
        const vistos = Array.from(new Set([...(estado.paquetes_vistos || []), paquete.id]));
        await enviarOLog(mensajeDetalle(paquete, resp.imageUrl, vistos, false));
        nuevasVars.paquetes_vistos = vistos;
      }
    } catch (err) {
      console.log("accion fallida", JSON.stringify(a).slice(0, 200), String(err));
    }
  }

  return new Response(JSON.stringify({ next_edge: res.edge, vars: nuevasVars }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Para los tests (node:vm). No afecta la ejecucion en Kapso.
globalThis.__isa3 = { resultadoInterpreteDe, opcionDesdeEtiqueta, ETIQUETAS_INTERPRETE, procesar, extraerEntrada, mensajesEstimado, mensajeDetalle, interpretarPresupuesto, interpretarM2, interpretarPlazo, buscarCiudad, interpretarTipo, nombrePerfilValido, extraerNombreDeTexto, festivosColombia, diasDisponibles, interpretarFranja, interpretarDia, payloadMensaje };
