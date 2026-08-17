import "dotenv/config";
import Fastify from "fastify";
import { generateQuote, getQuotePdfBytes } from "./tools/cotizador/generate-quote.js";
import type { QuoteInput } from "./tools/cotizador/field-map.js";

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

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
