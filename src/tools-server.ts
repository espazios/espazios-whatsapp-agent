import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { generateQuote, getQuotePdfBytes } from "./tools/cotizador/generate-quote.js";
import type { QuoteInput } from "./tools/cotizador/field-map.js";
import {
  calcularEstimado,
  paqueteDesdeTipoProyecto,
  PAQUETES,
  type Paquete,
} from "./tools/estimado-ilustrativo/pricing.js";
import { renderTarjeta, renderDetalle, type TarjetaPaqueteInput } from "./tools/estimado-ilustrativo/render.js";
import { leerContenidoPaquete } from "./tools/estimado-ilustrativo/contenido.js";

/**
 * Servidor de HERRAMIENTAS — no recibe conversaciones de WhatsApp.
 *
 * Desde la decision de arquitectura del 2026-08-16: la nueva Isa vive como
 * un Workflow de Kapso con un `agent node` (Claude) como cerebro — Kapso
 * recibe/envia los mensajes y mantiene el estado de la conversacion. Este
 * servidor solo expone las herramientas de negocio que ese agent node llama
 * (webhook tools / MCP), empezando por la cotizacion. agendar_cita y
 * sync_hubspot se agregan aca mismo mas adelante.
 *
 * Debe quedar en una URL publica para que Kapso pueda llamarla (ver
 * PUBLIC_BASE_URL en .env.example).
 */
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.post("/tools/generar-cotizacion", async (req, reply) => {
  // Kapso puede mandar los argumentos del tool en el body directo o
  // envueltos en { input: {...} } (asi lo hace con las funciones desplegadas,
  // ver docs/flows/step-types/agent-node.mdx) — aceptamos ambas formas.
  const body = req.body as any;
  const input = (body?.input ?? body) as Partial<QuoteInput>;
  const missing = (
    ["clienteNombre", "ciudad", "tipoProyecto", "metrosCuadrados", "nivelAcabado", "telefono"] as const
  ).filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length > 0) {
    return reply.code(400).send({ error: `Faltan campos: ${missing.join(", ")}` });
  }

  try {
    const quote = await generateQuote(input as QuoteInput);
    const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return {
      rangoBajo: quote.output.rangoBajo,
      rangoAlto: quote.output.rangoAlto,
      resumenSupuestos: quote.output.resumenSupuestos,
      pdfUrl: `${baseUrl}/tools/cotizaciones/${quote.pdfDriveFileId}`,
      spreadsheetUrl: quote.spreadsheetUrl,
    };
  } catch (err) {
    req.log.error({ err }, "Fallo generando la cotizacion");
    return reply.code(500).send({ error: "No se pudo generar la cotizacion." });
  }
});

app.get<{ Params: { fileId: string } }>("/tools/cotizaciones/:fileId", async (req, reply) => {
  try {
    const bytes = await getQuotePdfBytes(req.params.fileId);
    reply.header("Content-Type", "application/pdf");
    return reply.send(bytes);
  } catch (err) {
    req.log.error({ err }, "Fallo sirviendo el PDF de la cotizacion");
    return reply.code(404).send({ error: "PDF no encontrado." });
  }
});

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

function guardarImagen(bytes: Buffer, baseUrl: string): string {
  const id = randomUUID();
  estimadosGenerados.set(id, { bytes, creadoEn: Date.now() });
  return `${baseUrl}/tools/estimados/${id}`;
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

  try {
    const m2 = Number(input.m2);
    const banos = input.banos !== undefined && input.banos !== null ? Number(input.banos) : undefined;
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
  paquete: string;
  m2: number;
  /** Solo relevante si m2 cae en 31-44 — se ignora fuera de esa banda. */
  banos?: number;
}

app.post("/tools/detalle-paquete", async (req, reply) => {
  const body = req.body as any;
  const input = (body?.input ?? body) as Partial<DetalleInput>;
  const missing = (["paquete", "m2"] as const).filter(
    (field) => input[field] === undefined || input[field] === null || input[field] === ""
  );
  if (missing.length > 0) {
    return reply.code(400).send({ error: `Faltan campos: ${missing.join(", ")}` });
  }
  if (!PAQUETES.includes(input.paquete as Paquete)) {
    return reply.code(400).send({ error: `paquete debe ser uno de: ${PAQUETES.join(", ")}` });
  }

  try {
    const paquete = input.paquete as Paquete;
    const m2 = Number(input.m2);
    const banos = input.banos !== undefined && input.banos !== null ? Number(input.banos) : undefined;
    const estimado = (await calcularEstimado(m2, banos)).find((p) => p.paquete === paquete)!;
    const zonas = await leerContenidoPaquete(paquete, {
      banos: estimado.banos ?? undefined,
      habitaciones: estimado.habitaciones ?? undefined,
    });

    const bytes = await renderDetalle({
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

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
