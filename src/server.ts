import "dotenv/config";
import Fastify from "fastify";
import { registerKapsoWebhook, type IncomingMessage } from "./channel/webhook.js";
import { sendText } from "./channel/kapso-client.js";

const app = Fastify({ logger: true });

// La verificacion de firma del webhook necesita el cuerpo crudo (Buffer),
// no solo el JSON ya parseado — Fastify por defecto descarta el buffer original.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  try {
    (req as any).rawBody = body;
    done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async () => ({ ok: true }));

// TODO: reemplazar este handler por el Agente Supervisor (§03) una vez exista
// el orquestador (Claude Agent SDK + maquina de estados + herramientas).
const onMessage = async (msg: IncomingMessage) => {
  app.log.info({ from: msg.from, text: msg.text }, "Mensaje entrante de WhatsApp");
  await sendText(msg.from, "Hola, soy el asistente de Espazios. (Respuesta de prueba — Supervisor aun no conectado.)");
};

registerKapsoWebhook(app, onMessage);

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
