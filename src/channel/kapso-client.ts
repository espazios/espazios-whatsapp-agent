import { WhatsAppClient, buildTemplateSendPayload } from "@kapso/whatsapp-cloud-api";

/**
 * Canal de WhatsApp: en vez de hablar directo con la Cloud API de Meta,
 * pasamos por Kapso (BSP) — maneja la conexion del numero, plantillas y
 * onboarding, y expone el mismo SDK tipado (@kapso/whatsapp-cloud-api)
 * enrutando a traves de su proxy con un solo API key.
 *
 * https://docs.kapso.ai/docs/introduction
 */
export const kapso = new WhatsAppClient({
  baseUrl: "https://api.kapso.ai/meta/whatsapp",
  kapsoApiKey: requireEnv("KAPSO_API_KEY"),
});

const phoneNumberId = () => requireEnv("KAPSO_PHONE_NUMBER_ID");

/** Mensaje de texto libre — solo valido dentro de la ventana de 24h (ver CLAUDE.md). */
export function sendText(to: string, body: string) {
  return kapso.messages.sendText({ phoneNumberId: phoneNumberId(), to, body });
}

/** Botones rapidos (hasta 3) — usado en Saludo, Consentimiento, Clasificacion, etc. */
export function sendButtons(
  to: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
  footerText?: string
) {
  return kapso.messages.sendInteractiveButtons({
    phoneNumberId: phoneNumberId(),
    to,
    bodyText,
    footerText,
    buttons,
  });
}

/** Plantilla pre-aprobada — obligatoria fuera de la ventana de 24h (seguimiento, §07). */
export function sendTemplate(
  to: string,
  name: string,
  language: string,
  bodyParams: { parameterName: string; text: string }[] = []
) {
  const template = buildTemplateSendPayload({
    name,
    language,
    body: bodyParams.map((p) => ({ type: "text", ...p })),
  });
  // El tipo de retorno de buildTemplateSendPayload (la forma oficial de construir
  // esto, ver docs de @kapso/whatsapp-cloud-api) no calza estructuralmente con el
  // tipo de entrada esperado por sendTemplate por una aspereza de los .d.ts del SDK
  // (falta de index signature en las variantes de TemplateComponent) — el shape en
  // runtime es exactamente el que la propia libreria espera.
  return kapso.messages.sendTemplate({
    phoneNumberId: phoneNumberId(),
    to,
    template: template as unknown as Parameters<typeof kapso.messages.sendTemplate>[0]["template"],
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
