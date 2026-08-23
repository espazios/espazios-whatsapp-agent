import { getSheetsClient } from "../../lib/google-auth.js";
import { PAQUETES, type Paquete } from "./pricing.js";

const INCLUYE_RANGE = "Incluye!A2:B"; // paquete, item — sin encabezado

/** Lee que incluye cada paquete (pestana "Incluye" de la hoja de tarifas). */
export async function leerContenidoPaquetes(): Promise<Record<Paquete, string[]>> {
  const spreadsheetId = requireEnv("TARIFAS_ILUSTRATIVAS_SHEET_ID");
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: INCLUYE_RANGE });
  const rows = res.data.values ?? [];

  const resultado = Object.fromEntries(PAQUETES.map((p) => [p, [] as string[]])) as Record<
    Paquete,
    string[]
  >;

  for (const [paquete, item] of rows) {
    if (paquete && item && PAQUETES.includes(paquete as Paquete)) {
      resultado[paquete as Paquete].push(String(item).trim());
    }
  }
  return resultado;
}

export async function leerContenidoPaquete(paquete: Paquete): Promise<string[]> {
  const todos = await leerContenidoPaquetes();
  return todos[paquete] ?? [];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
