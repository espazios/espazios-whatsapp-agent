import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  calcularEstimado,
  paqueteDesdeTipoProyecto,
  PAQUETES,
  type Paquete,
} from "./tools/estimado-ilustrativo/pricing.js";
import { renderTarjeta, renderDetalle, type TarjetaPaqueteInput } from "./tools/estimado-ilustrativo/render.js";
import { leerContenidoPaquete } from "./tools/estimado-ilustrativo/contenido.js";

/**
 * Servidor de HERRAMIENTAS de Isa (Railway) — no recibe conversaciones.
 *
 * - POST /tools/estimado-ilustrativo y /tools/detalle-paquete: generan las
 *   imagenes del estimado; las llama el motor de Isa v3 (Kapso Function
 *   `isa3-motor`).
 * - GET /tools/estimados/:id: sirve esas imagenes (cache en memoria, 1 h).
 * - Cada minuto despierta la Kapso Function `isa3-seguimientos`.
 */
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

// --- Estimado ilustrativo (imagen con los 3 paquetes) ---
// Efimero por diseno: no es un registro oficial (esa es la cotizacion real
// de la sesion con el Ejecutivo Comercial), asi que basta con cachear los
// bytes en memoria del proceso en vez de guardarlos en Drive.
const estimadosGenerados = new Map<string, { bytes: Buffer; creadoEn: number }>();
const ESTIMADO_TTL_MS = 60 * 60 * 1000; // 1 hora

setInterval(() => {
  const ahora = Date.now();
  for (const [id, { creadoEn }] of estimadosGenerados) {
    if (ahora - creadoEn > ESTIMADO_TTL_MS) estimadosGenerados.delete(id);
  }
}, 10 * 60 * 1000).unref();

interface EstimadoInput {
  nombre: string;
  ciudad: string;
  proyecto: string;
  m2: number;
  /** Solo relevante si m2 cae en 31-44 (ahi hay 2 tarifas segun banos) — se ignora fuera de esa banda. */
  banos?: number;
  /** tipo_proyecto ya recolectado — si coincide con uno de los 3 paquetes, esa tarjeta se destaca y se manda su detalle de una vez. */
  tipoProyecto?: string;
}

// Tope de imagenes en memoria: si alguien llama los endpoints en masa, se
// descartan las mas viejas en vez de agotar la memoria del servidor.
const MAX_ESTIMADOS_EN_MEMORIA = 500;

function guardarImagen(bytes: Buffer, baseUrl: string): string {
  while (estimadosGenerados.size >= MAX_ESTIMADOS_EN_MEMORIA) {
    const masViejo = estimadosGenerados.keys().next().value;
    if (masViejo === undefined) break;
    estimadosGenerados.delete(masViejo);
  }
  const id = randomUUID();
  estimadosGenerados.set(id, { bytes, creadoEn: Date.now() });
  return `${baseUrl}/tools/estimados/${id}`;
}

/**
 * Limpia los datos que llegan a los endpoints antes de dibujarlos: textos
 * recortados (evita imagenes enormes o abuso) y m2/banos numericos validos.
 * Devuelve el error a reportar, o null si todo esta bien.
 */
const MAX_TEXTO = 120;
function limpiarTexto(valor: unknown): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO);
}
function validarMedidas(m2: number, banos: number | undefined): string | null {
  if (!Number.isFinite(m2) || m2 < 10 || m2 > 1000) return "m2 debe ser un numero entre 10 y 1000";
  if (banos !== undefined && banos !== 1 && banos !== 2) return "banos debe ser 1 o 2";
  return null;
}

app.post("/tools/estimado-ilustrativo", async (req, reply) => {
  const body = req.body as any;
  const input = (body?.input ?? body) as Partial<EstimadoInput>;
  const missing = (["nombre", "ciudad", "proyecto", "m2"] as const).filter(
    (field) => input[field] === undefined || input[field] === null || input[field] === ""
  );
  if (missing.length > 0) {
    return reply.code(400).send({ error: `Faltan campos: ${missing.join(", ")}` });
  }

  const m2 = Number(input.m2);
  const banos = input.banos !== undefined && input.banos !== null ? Number(input.banos) : undefined;
  const errorMedidas = validarMedidas(m2, banos);
  if (errorMedidas) return reply.code(400).send({ error: errorMedidas });
  input.nombre = limpiarTexto(input.nombre);
  input.ciudad = limpiarTexto(input.ciudad);
  input.proyecto = limpiarTexto(input.proyecto);

  try {
    const estimados = await calcularEstimado(m2, banos);
    const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const paqueteElegidoKey = paqueteDesdeTipoProyecto(input.tipoProyecto);
    const paquetesConDestaque: TarjetaPaqueteInput[] = estimados.map((p) => ({
      ...p,
      elegido: p.paquete === paqueteElegidoKey,
    }));

    const bytes = await renderTarjeta({
      nombre: input.nombre!,
      ciudad: input.ciudad!,
      proyecto: input.proyecto!,
      m2,
      paquetes: paquetesConDestaque,
    });
    const imageUrl = guardarImagen(bytes, baseUrl);

    // Si tipo_proyecto coincide con uno de los 3 paquetes, se genera y manda
    // de una vez el detalle ("que incluye") de ESE paquete — Carpintería y
    // cualquier otro valor no matchea ninguno, se queda en null.
    let paqueteElegido: { paquete: Paquete; imageUrl: string } | null = null;
    if (paqueteElegidoKey) {
      const elegido = estimados.find((p) => p.paquete === paqueteElegidoKey)!;
      const zonas = await leerContenidoPaquete(paqueteElegidoKey, {
        banos: elegido.banos ?? undefined,
        habitaciones: elegido.habitaciones ?? undefined,
      });
      const detalleBytes = await renderDetalle({
        nombre: input.nombre!,
        ciudad: input.ciudad!,
        proyecto: input.proyecto!,
        m2,
        banos: elegido.banos,
        habitaciones: elegido.habitaciones,
        paquete: paqueteElegidoKey,
        precioDesde: elegido.precioDesde,
        precioDesdeSinDescuento: elegido.precioDesdeSinDescuento,
        aproximado: elegido.aproximado,
        zonas,
      });
      paqueteElegido = { paquete: paqueteElegidoKey, imageUrl: guardarImagen(detalleBytes, baseUrl) };
    }

    return {
      imageUrl,
      paquetes: estimados.map((p) => ({
        paquete: p.paquete,
        precioDesde: p.precioDesde,
        precioDesdeSinDescuento: p.precioDesdeSinDescuento,
        aproximado: p.aproximado,
      })),
      paqueteElegido,
    };
  } catch (err) {
    req.log.error({ err }, "Fallo generando el estimado ilustrativo");
    return reply.code(500).send({ error: "No se pudo generar el estimado." });
  }
});

interface DetalleInput {
  nombre: string;
  ciudad: string;
  proyecto: string;
  paquete: string;
  m2: number;
  /** Solo relevante si m2 cae en 31-44 — se ignora fuera de esa banda. */
  banos?: number;
}

app.post("/tools/detalle-paquete", async (req, reply) => {
  const body = req.body as any;
  const input = (body?.input ?? body) as Partial<DetalleInput>;
  const missing = (["nombre", "ciudad", "proyecto", "paquete", "m2"] as const).filter(
    (field) => input[field] === undefined || input[field] === null || input[field] === ""
  );
  if (missing.length > 0) {
    return reply.code(400).send({ error: `Faltan campos: ${missing.join(", ")}` });
  }
  if (!PAQUETES.includes(input.paquete as Paquete)) {
    return reply.code(400).send({ error: `paquete debe ser uno de: ${PAQUETES.join(", ")}` });
  }

  const m2 = Number(input.m2);
  const banos = input.banos !== undefined && input.banos !== null ? Number(input.banos) : undefined;
  const errorMedidas = validarMedidas(m2, banos);
  if (errorMedidas) return reply.code(400).send({ error: errorMedidas });
  input.nombre = limpiarTexto(input.nombre);
  input.ciudad = limpiarTexto(input.ciudad);
  input.proyecto = limpiarTexto(input.proyecto);

  try {
    const paquete = input.paquete as Paquete;
    const estimado = (await calcularEstimado(m2, banos)).find((p) => p.paquete === paquete)!;
    const zonas = await leerContenidoPaquete(paquete, {
      banos: estimado.banos ?? undefined,
      habitaciones: estimado.habitaciones ?? undefined,
    });

    const bytes = await renderDetalle({
      nombre: input.nombre!,
      ciudad: input.ciudad!,
      proyecto: input.proyecto!,
      m2,
      banos: estimado.banos,
      habitaciones: estimado.habitaciones,
      paquete,
      precioDesde: estimado.precioDesde,
      precioDesdeSinDescuento: estimado.precioDesdeSinDescuento,
      aproximado: estimado.aproximado,
      zonas,
    });

    const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return { imageUrl: guardarImagen(bytes, baseUrl), zonas };
  } catch (err) {
    req.log.error({ err }, "Fallo generando el detalle del paquete");
    return reply.code(500).send({ error: "No se pudo generar el detalle." });
  }
});

app.get<{ Params: { id: string } }>("/tools/estimados/:id", async (req, reply) => {
  const entry = estimadosGenerados.get(req.params.id);
  if (!entry) return reply.code(404).send({ error: "Estimado no encontrado (puede haber expirado)." });
  reply.header("Content-Type", "image/png");
  return reply.send(entry.bytes);
});

// --- Seguimientos automaticos de Isa v3 (2026-11-25) ---
// Isa v3 programa los seguimientos en D1 (tabla isa3_seguimientos) y la Kapso
// Function publica `isa3-seguimientos` envia los que vencieron. Kapso no tiene
// cron, asi que este servidor la despierta cada minuto. La funcion no recibe
// datos del cliente: llamarla de mas no adelanta ni duplica ningun envio.
// ISA3_SEGUIMIENTOS_URL=off lo apaga sin tocar codigo.
const ISA3_SEGUIMIENTOS_URL =
  process.env.ISA3_SEGUIMIENTOS_URL ??
  "https://api.kapso.ai/platform/v1/functions/d781d5ab-70c8-4230-ae40-5dd2c1791b21/invoke";

if (ISA3_SEGUIMIENTOS_URL !== "off") {
  setInterval(async () => {
    try {
      const res = await fetch(ISA3_SEGUIMIENTOS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 20, ...(process.env.ISA3_TICK_TOKEN ? { token: process.env.ISA3_TICK_TOKEN } : {}) }),
      });
      const text = await res.text();
      if (!res.ok) {
        app.log.error({ status: res.status, body: text.slice(0, 500) }, "isa3-seguimientos respondio con error");
        return;
      }
      const data = JSON.parse(text) as { procesados?: unknown[] };
      if (data.procesados && data.procesados.length > 0) {
        app.log.info({ procesados: data.procesados }, "seguimientos de Isa v3 procesados");
      }
    } catch (err) {
      app.log.error({ err }, "fallo llamando a isa3-seguimientos");
    }
  }, 60 * 1000).unref();
  app.log.info("Seguimientos de Isa v3 activos (isa3-seguimientos cada 1 min)");
}

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
