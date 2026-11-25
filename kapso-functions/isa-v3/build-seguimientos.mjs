// Genera el codigo de la Kapso Function "isa3-seguimientos" a partir de motor.js:
// toma solo las declaraciones que usa el envio de seguimientos y renombra
// handlerSeguimientos -> handler. Uso: node build-seguimientos.mjs motor.js salida.js
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(process.argv[2], "utf8").split("\n");
const chunks = []; let cur = null;
for (const line of src) {
  const m = line.match(/^(?:async\s+)?function\s+(\w+)|^(?:const|let)\s+(\w+)|^(globalThis)/);
  if (m) { cur = { name: m[1] || m[2] || m[3], lines: [] }; chunks.push(cur); }
  if (cur) cur.lines.push(line);
}
const keep = new Set(("KAPSO_META_BASE KAPSO_PLATFORM_BASE CALENDAR_URL COBERTURA_SOLO_CARPINTERIA FRANJAS DIAS_SEMANA MESES norm " +
 "fechaBogota pascua iso festivosColombia diasDisponibles bloque OPCIONES_TIPO filaCiudad CIUDADES_LISTA MUNICIPIOS_LISTA preguntar " +
 "PASOS_SEGUIMIENTO PASOS_AGENDA ESPERAS_SEGUIMIENTO_MIN ITEM_PENDIENTE preguntaSeguimiento introSeguimiento plantillaSeguimiento " +
 "sumarMinutosHabiles tablasSeguimientosListas asegurarTablaSeguimientos estadoEjecucion mensajesSeguimiento tickSeguimientos " +
 "handlerSeguimientos payloadMensaje enviar TABLAS tablasResueltas tabla variantesSiNo esAfirmacion esNegacion repararNombre").split(" "));
const out = ["// Kapso Function isa3-seguimientos — generada desde kapso-functions/isa-v3/motor.js (entrada handlerSeguimientos). La llama Railway cada minuto."];
for (const c of chunks) if (keep.has(c.name)) out.push(c.lines.join("\n").replace(/^async function handlerSeguimientos\(/, "async function handler("));
writeFileSync(process.argv[3], out.join("\n") + "\n");
const faltan = [...keep].filter((k) => !chunks.some((c) => c.name === k));
console.log("faltan:", faltan);
