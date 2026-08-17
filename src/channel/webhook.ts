import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifySignature, normalizeWebhook } from "@kapso/whatsapp-cloud-api/server";

export interface IncomingMessage {
  from: string; // numero del cliente en formato E.164
  text?: string;
  buttonReplyId?: string; // si el cliente toco un boton interactivo
  raw: unknown;
}

/** Se reemplaza por el Agente Supervisor una vez exista (ver §03 del diseno). */
export type IncomingMessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * Ruta que recibe los eventos que Kapso reenvia desde Meta (mensajes nuevos,
 * cambios de estado de entrega). Kapso es quien atiende el handshake GET de
 * verificacion con Meta — nuestro servidor solo necesita esta ruta POST
 * registrada en el dashboard de Kapso como webhook del proyecto/numero.
 *
 * TODO: confirmar en el dashboard de Kapso el nombre exacto de la cabecera y
 * el secreto de firma para webhooks reenviados por Kapso (puede diferir del
 * X-Hub-Signature-256 crudo de Meta si Kapso firma con su propio secreto).
 */
export function registerKapsoWebhook(app: FastifyInstance, onMessage: IncomingMessageHandler) {
  app.post("/webhooks/kapso", async (req: FastifyRequest, reply) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signatureHeader = req.headers["x-hub-signature-256"] as string | undefined;

    if (!rawBody || !signatureHeader) {
      req.log.warn("Webhook sin cuerpo crudo o sin cabecera de firma — rechazado.");
      return reply.code(400).send({ error: "missing signature" });
    }

    const valid = verifySignature({
      appSecret: requireEnv("KAPSO_WEBHOOK_SECRET"),
      rawBody,
      signatureHeader,
    });
    if (!valid) {
      req.log.warn("Firma de webhook invalida.");
      return reply.code(401).send({ error: "invalid signature" });
    }

    // Responder rapido y procesar despues — Kapso/Meta reintentan si tardamos.
    reply.code(200).send({ ok: true });

    const events = normalizeWebhook(req.body as any);
    for (const message of events.messages ?? []) {
      // "from" puede faltar si el usuario adopto un username de WhatsApp;
      // sin numero de telefono no podemos correlacionar el lead, se descarta.
      if (!message.from) {
        req.log.warn({ id: message.id }, "Mensaje sin numero de telefono (from) — omitido.");
        continue;
      }
      const interactive = message.interactive as { buttonReply?: { id?: string } } | undefined;
      await onMessage({
        from: message.from,
        text: message.text?.body,
        buttonReplyId: interactive?.buttonReply?.id,
        raw: message,
      }).catch((err) => req.log.error({ err }, "Fallo procesando mensaje entrante"));
    }
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
