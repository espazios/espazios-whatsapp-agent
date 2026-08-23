import { getSheetsClient } from "../../lib/google-auth.js";

/**
 * Lee el "Tarifas Ilustrativas - Isa" (hoja limpia, separada de la
 * plantilla operativa del Ejecutivo Comercial) y calcula el "Desde $X" de
 * los 3 paquetes para un area dada. Nunca inventa un precio: si la celda
 * de precio esta vacia (todavia no la llena el equipo comercial), o el
 * area no cae en ningun rango conocido, lo dice explicitamente en vez de
 * calcular algo.
 */

export const PAQUETES = ["Solo Obra Blanca", "Intermedio", "Remodelacion completa"] as const;
export type Paquete = (typeof PAQUETES)[number];

export interface RangoTarifa {
  paquete: Paquete;
  m2Min: number;
  m2Max: number;
  precioDesde: number | null;
}

export interface EstimadoPaquete {
  paquete: Paquete;
  precioDesde: number | null;
  /** Si el area cayo fuera de los rangos conocidos, se uso el rango mas cercano. */
  aproximado: boolean;
}

const TARIFAS_RANGE = "A2:D"; // paquete, m2_min, m2_max, precio_desde — sin encabezado

export async function calcularEstimado(m2: number): Promise<EstimadoPaquete[]> {
  const rangos = await leerTarifas();
  return PAQUETES.map((paquete) => estimarParaPaquete(paquete, m2, rangos));
}

async function leerTarifas(): Promise<RangoTarifa[]> {
  const spreadsheetId = requireEnv("TARIFAS_ILUSTRATIVAS_SHEET_ID");
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: TARIFAS_RANGE });
  const rows = res.data.values ?? [];

  return rows
    .filter((row) => row[0] && PAQUETES.includes(row[0] as Paquete))
    .map((row) => ({
      paquete: row[0] as Paquete,
      m2Min: Number(row[1]),
      m2Max: Number(row[2]),
      precioDesde: parsePrecio(row[3]),
    }));
}

function estimarParaPaquete(paquete: Paquete, m2: number, rangos: RangoTarifa[]): EstimadoPaquete {
  const delPaquete = rangos.filter((r) => r.paquete === paquete);
  if (delPaquete.length === 0) {
    return { paquete, precioDesde: null, aproximado: false };
  }

  const exacto = delPaquete.find((r) => m2 >= r.m2Min && m2 <= r.m2Max);
  if (exacto) return { paquete, precioDesde: exacto.precioDesde, aproximado: false };

  // Fuera de todos los rangos conocidos: usar el rango mas cercano (el mas
  // bajo si el area es menor a todos, el mas alto si es mayor a todos) y
  // marcarlo como aproximado — la plantilla debe dejarlo claro al cliente.
  const ordenado = [...delPaquete].sort((a, b) => a.m2Min - b.m2Min);
  const masCercano = m2 < ordenado[0].m2Min ? ordenado[0] : ordenado[ordenado.length - 1];
  return { paquete, precioDesde: masCercano.precioDesde, aproximado: true };
}

function parsePrecio(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
