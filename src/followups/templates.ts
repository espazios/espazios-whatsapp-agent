/**
 * Plantillas deterministicas del mensaje de push — NUNCA generadas por el
 * modelo. Ver docs/isa-v2-system-prompt.md, "Instrucciones del mensaje de
 * push": el texto sale de aca, con el nombre y el dato pendiente
 * insertados, y se valida antes de mandarse (`isSafeToSend`) para
 * garantizar que nunca sale un placeholder interno ni una respuesta
 * cruda de modelo.
 */

export interface FollowupMessageInput {
  contactName: string | null | undefined;
  /** Descripcion corta que el agente guardo en `register-followup` (ej. "indicar presupuesto"). */
  pendingAction: string;
  /** Intento que se esta por mandar (1-indexado: este va a ser el intento N). */
  attempt: number;
}

/** Textos conocidos que NUNCA deben salir por WhatsApp — evidencia real de bugs de runtime. */
const FORBIDDEN_SUBSTRINGS = [
  "Only the final assistant message is shown",
  "[ENTER_WAITING]",
  "tool_call",
  "tool_name",
  "function_call",
];

function saludoConNombre(contactName: string | null | undefined): string {
  const nombre = contactName?.trim();
  return nombre ? `hola ${nombre}` : "hola";
}

function categoriaDePendingAction(pendingAction: string): "agendamiento_link" | "eleccion_reunion" | "dato" {
  const texto = pendingAction.toLowerCase();
  if (texto.includes("agend") || texto.includes("enlace") || texto.includes("link")) return "agendamiento_link";
  if (texto.includes("llamada") || texto.includes("reuni")) return "eleccion_reunion";
  return "dato";
}

/**
 * Arma el mensaje de push para un intento dado. El ultimo intento
 * (`attempt === MAX_ATTEMPTS`, ver cadence.ts) siempre usa el cierre
 * calido, sin importar `pendingAction` — es la despedida de la cadena,
 * no otro recordatorio.
 */
export function renderFollowupMessage(input: FollowupMessageInput, maxAttempts: number): string {
  const saludo = saludoConNombre(input.contactName);

  if (input.attempt >= maxAttempts) {
    return `${saludo}, no quiero ser insistente — si más adelante quieres retomar tu cotización, aquí seguimos 😊`;
  }

  switch (categoriaDePendingAction(input.pendingAction)) {
    case "agendamiento_link":
      return `${saludo}, ¿alcanzaste a agendar tu cotización en el link? cualquier cosa me cuentas`;
    case "eleccion_reunion":
      return `${saludo}, quedé pendiente de saber si prefieres llamada, reunión virtual o presencial para tu cotización — me cuentas cuando puedas`;
    case "dato":
    default:
      return `${saludo}, quedé pendiente de que me confirmaras ${input.pendingAction} para seguir con tu cotización — cuando puedas, me cuentas 😊`;
  }
}

/**
 * Ultima verificacion antes de enviar: nunca mandar vacio, ni nada que
 * coincida con un placeholder interno conocido. Con plantillas fijas
 * esto no deberia dispararse nunca — es la red de seguridad, no la
 * defensa principal.
 */
export function isSafeToSend(text: string): boolean {
  const limpio = text.trim();
  if (limpio.length === 0) return false;
  return !FORBIDDEN_SUBSTRINGS.some((forbidden) => limpio.includes(forbidden));
}
