import { google } from "googleapis";
import fs from "node:fs";

// Credenciales de Google (usuario OAuth autorizado, ver CLAUDE.md). Hoy solo
// se usa Sheets (tarifas e "Incluye" del estimado ilustrativo). Calendar se
// deja porque esta en el roadmap (agendar con Calendar API). Ojo: con un
// token de usuario, los permisos reales los fija el token emitido, no esta
// lista; reducirla de verdad exige volver a generar el token.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
];

let authClientPromise: ReturnType<typeof buildAuthClient> | null = null;

function buildAuthClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!keyPath && !inlineJson) {
    throw new Error(
      "Falta GOOGLE_SERVICE_ACCOUNT_KEY_PATH o GOOGLE_SERVICE_ACCOUNT_JSON en el entorno."
    );
  }

  const credentials = inlineJson
    ? JSON.parse(inlineJson)
    : JSON.parse(fs.readFileSync(keyPath as string, "utf-8"));

  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  return auth.getClient();
}

/** Cliente autenticado compartido (una sola cuenta de servicio para todo Google). */
export function getGoogleAuthClient() {
  if (!authClientPromise) authClientPromise = buildAuthClient();
  return authClientPromise;
}

export async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  return google.sheets({ version: "v4", auth: auth as any });
}

export async function getCalendarClient() {
  const auth = await getGoogleAuthClient();
  return google.calendar({ version: "v3", auth: auth as any });
}
