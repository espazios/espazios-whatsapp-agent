import { google } from "googleapis";
import fs from "node:fs";

// Cuenta de servicio unica para Sheets, Calendar y Gmail.
// Gmail requiere delegacion de dominio (impersonar un buzon real de Espazios)
// si se usa desde una cuenta de servicio; Sheets/Calendar no la necesitan
// mientras la hoja y el calendario del asesor esten compartidos directamente
// con el correo de la cuenta de servicio.
//
// 2026-09-02: se quito el scope de Drive (`.../auth/drive`) a proposito —
// es el unico que Google clasifica como "restringido" (exige evaluacion de
// seguridad para publicar la app OAuth fuera de modo "Testing"), y hoy nada
// en produccion lo necesita: el estimado ilustrativo solo lee Sheets. Lo
// unico que usaba Drive es `generar_cotizacion`/`getDriveClient()`
// (`src/tools/cotizador/generate-quote.ts`), que ya esta dormido — no es
// parte del lanzamiento de Isa v2 (ver CLAUDE.md). Si se retoma esa funcion,
// hay que agregar el scope de vuelta ANTES, o `getDriveClient()` fallara con
// un error de permisos (el token no tendria alcance a Drive).
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
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

export async function getDriveClient() {
  const auth = await getGoogleAuthClient();
  return google.drive({ version: "v3", auth: auth as any });
}

export async function getSheetsClient() {
  const auth = await getGoogleAuthClient();
  return google.sheets({ version: "v4", auth: auth as any });
}

export async function getCalendarClient() {
  const auth = await getGoogleAuthClient();
  return google.calendar({ version: "v3", auth: auth as any });
}

/** Token bearer crudo, para el endpoint de exportacion a PDF de Sheets (fuera de la API REST estandar). */
export async function getBearerToken(): Promise<string> {
  const auth = await getGoogleAuthClient();
  const token = await (auth as any).getAccessToken();
  if (!token) throw new Error("No se pudo obtener un access token de Google.");
  return typeof token === "string" ? token : token.token;
}
