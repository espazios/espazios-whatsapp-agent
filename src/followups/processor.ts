/**
 * Procesador de seguimientos (push) — reemplaza a `process-followups` /
 * `process-followups-v2` de Kapso. Acordado 2026-09-25 (ver
 * docs/isa-v2-system-prompt.md): la decision de negocio (validar,
 * calcular cadencia, armar el texto) vive aca en Railway — la misma
 * infraestructura que ya corre 24/7 y que nunca tuvo el problema de 404
 * que si tuvo `process-followups` — porque no depende del Cron interno
 * de Kapso. Kapso solo guarda el estado (`conversation_followups`,
 * `leads_isa_v2`, `leads_no_viables`) detras de un pequeno set de
 * endpoints HTTP, ya que ese estado vive en su D1 y Railway no tiene
 * acceso directo a esa base.
 *
 * *** CONTRATO PENDIENTE DE CONSTRUIR DEL LADO DE KAPSO ***
 * Los 4 endpoints de abajo (`FOLLOWUPS_LIST_URL`, `..._CLAIM_URL`,
 * `..._VALIDATE_URL`, `..._RESOLVE_URL`) todavia no existen — son la
 * especificacion que hay que pasarle a Kapso para que los implemente
 * como Kapso Functions, con la misma auth por header `x-api-key` que ya
 * usa `register-followup`/`process-followups`. Mientras no esten
 * configuradas las 4 variables de entorno, este procesador se queda
 * inactivo (ver el guard en tools-server.ts) — no rompe nada.
 */
import { sendText } from "../channel/kapso-client.js";
import { computeNextDueAt, MAX_ATTEMPTS } from "./cadence.js";
import { isSafeToSend, renderFollowupMessage } from "./templates.js";

export interface DueFollowup {
  id: string;
  conversation_id: string;
  phone_number: string;
  contact_name: string | null;
  pending_action: string;
  /** Intentos ya enviados hasta ahora (0 = ninguno todavia). */
  attempt: number;
  created_at: string; // ISO
  last_sent_at: string | null; // ISO
}

interface FollowupsEndpoints {
  listUrl: string;
  claimUrl: string;
  validateUrl: string;
  resolveUrl: string;
  token: string;
}

function readEndpoints(): FollowupsEndpoints | null {
  const listUrl = process.env.FOLLOWUPS_LIST_URL;
  const claimUrl = process.env.FOLLOWUPS_CLAIM_URL;
  const validateUrl = process.env.FOLLOWUPS_VALIDATE_URL;
  const resolveUrl = process.env.FOLLOWUPS_RESOLVE_URL;
  const token = process.env.FOLLOWUPS_PROCESS_TOKEN;
  if (!listUrl || !claimUrl || !validateUrl || !resolveUrl || !token) return null;
  return { listUrl, claimUrl, validateUrl, resolveUrl, token };
}

async function postJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} respondio ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * `GET /followups debidos` — misma consulta que ya especifico Kapso:
 * `SELECT * FROM conversation_followups WHERE status = 'pending' AND
 * next_due_at <= now ORDER BY next_due_at ASC LIMIT ?`. Sin validacion
 * de negocio todavia — solo trae lo que ya vencio.
 */
async function listDueFollowups(ep: FollowupsEndpoints, limit: number): Promise<DueFollowup[]> {
  const data = await postJson<{ followups: DueFollowup[] }>(ep.listUrl, ep.token, { limit });
  return data.followups ?? [];
}

/**
 * Corre las 4 validaciones acordadas, en orden, contra el estado real en
 * D1 (mensaje nuevo, agendamiento confirmado, no viable, conversacion
 * activa). Si alguna falla, el propio endpoint deja la cadena en
 * `cancelled` del lado de Kapso — aca solo nos importa si hay que
 * mandar o no.
 */
async function validateFollowup(
  ep: FollowupsEndpoints,
  followup: DueFollowup
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return postJson(ep.validateUrl, ep.token, {
    id: followup.id,
    phone_number: followup.phone_number,
    conversation_id: followup.conversation_id,
  });
}

/** Reclamo idempotente — UPDATE condicional a `status = 'processing'`. Si otra instancia ya la tomo, devuelve `claimed: false`. */
async function claimFollowup(ep: FollowupsEndpoints, id: string): Promise<boolean> {
  const data = await postJson<{ claimed: boolean }>(ep.claimUrl, ep.token, { id });
  return data.claimed === true;
}

type ResolveOutcome =
  | { outcome: "sent"; next_attempt: number; next_due_at: string }
  | { outcome: "sent"; close: true }
  | { outcome: "send_failed" };

async function resolveFollowup(ep: FollowupsEndpoints, id: string, resolution: ResolveOutcome): Promise<void> {
  await postJson(ep.resolveUrl, ep.token, { id, ...resolution });
}

async function processOne(ep: FollowupsEndpoints, followup: DueFollowup, log: { error: (o: unknown, msg: string) => void; info: (o: unknown, msg: string) => void }) {
  const validation = await validateFollowup(ep, followup);
  if (!validation.ok) {
    log.info({ id: followup.id, reason: validation.reason }, "follow-up cancelado antes de enviar");
    return;
  }

  const claimed = await claimFollowup(ep, followup.id);
  if (!claimed) {
    log.info({ id: followup.id }, "follow-up ya reclamado por otra instancia, se omite");
    return;
  }

  const attemptANarrar = followup.attempt + 1; // el intento que estamos por mandar (1-indexado).
  const message = renderFollowupMessage(
    { contactName: followup.contact_name, pendingAction: followup.pending_action, attempt: attemptANarrar },
    MAX_ATTEMPTS
  );

  if (!isSafeToSend(message)) {
    log.error({ id: followup.id, message }, "plantilla de push genero texto invalido, no se envia");
    await resolveFollowup(ep, followup.id, { outcome: "send_failed" });
    return;
  }

  try {
    await sendText(followup.phone_number, message);
  } catch (err) {
    log.error({ err, id: followup.id }, "fallo enviando el mensaje de push");
    await resolveFollowup(ep, followup.id, { outcome: "send_failed" });
    return;
  }

  const now = new Date();
  const nextDueAt = computeNextDueAt({
    attempt: attemptANarrar,
    createdAt: new Date(followup.created_at),
    lastSentAt: now,
  });

  if (nextDueAt === null) {
    await resolveFollowup(ep, followup.id, { outcome: "sent", close: true });
  } else {
    await resolveFollowup(ep, followup.id, {
      outcome: "sent",
      next_attempt: attemptANarrar,
      next_due_at: nextDueAt.toISOString(),
    });
  }
}

export async function runFollowupsTick(log: {
  error: (o: unknown, msg: string) => void;
  info: (o: unknown, msg: string) => void;
  warn: (msg: string) => void;
}): Promise<void> {
  const ep = readEndpoints();
  if (!ep) {
    log.warn("Endpoints de follow-ups no configurados todavia (FOLLOWUPS_LIST_URL/CLAIM_URL/VALIDATE_URL/RESOLVE_URL) — tick sin efecto.");
    return;
  }

  let due: DueFollowup[];
  try {
    due = await listDueFollowups(ep, 50);
  } catch (err) {
    log.error({ err }, "fallo listando follow-ups vencidos");
    return;
  }

  for (const followup of due) {
    try {
      await processOne(ep, followup, log);
    } catch (err) {
      log.error({ err, id: followup.id }, "fallo procesando un follow-up");
    }
  }
}
