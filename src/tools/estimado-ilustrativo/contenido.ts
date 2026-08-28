import { getSheetsClient } from "../../lib/google-auth.js";
import { PAQUETES, type Paquete } from "./pricing.js";

/**
 * Lee que incluye cada paquete (pestana "Incluye" de la hoja de tarifas),
 * agrupado por zona del hogar / punto de trabajo (Obra Blanca, Cocina y
 * zona de ropas, Baño general, Baño principal, Habitación principal,
 * Habitación 2, Habitación 3) — evolucion 2026-08-28, antes era una lista
 * plana sin zona.
 *
 * Columnas esperadas: paquete, zona, item. Retrocompatible con el formato
 * viejo (paquete, item, sin columna de zona): si una fila no tiene zona,
 * el item cae en una zona generica "General" — asi nada se rompe si la
 * pestaña todavia no se actualizo a 3 columnas.
 */

export interface ZonaContenido {
  zona: string;
  items: string[];
}

const INCLUYE_RANGE = "Incluye!A2:C"; // paquete, zona, item — sin encabezado

/** Zonas que solo aplican segun banos/habitaciones del cliente — cualquier otra zona siempre aplica. */
const ZONAS_CONDICIONALES: Record<string, (opts: { banos?: number; habitaciones?: number }) => boolean> = {
  "bano principal": (opts) => opts.banos === 2,
  "habitacion 2": (opts) => (opts.habitaciones ?? 1) >= 2,
  "habitacion 3": (opts) => (opts.habitaciones ?? 1) >= 3,
};

/** Lee todas las zonas de todos los paquetes, sin filtrar por banos/habitaciones. */
async function leerContenidoCrudo(): Promise<Record<Paquete, ZonaContenido[]>> {
  const spreadsheetId = requireEnv("TARIFAS_ILUSTRATIVAS_SHEET_ID");
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: INCLUYE_RANGE });
  const rows = res.data.values ?? [];

  const zonasPorPaquete = Object.fromEntries(PAQUETES.map((p) => [p, new Map<string, string[]>()])) as Record<
    Paquete,
    Map<string, string[]>
  >;

  for (const row of rows) {
    const paquete = row[0];
    if (!paquete || !PAQUETES.includes(paquete as Paquete)) continue;

    const tieneZona = row.length >= 3 && String(row[2] ?? "").trim() !== "";
    const zona = tieneZona ? String(row[1]).trim() : "General";
    const item = tieneZona ? String(row[2]).trim() : String(row[1] ?? "").trim();
    if (!item) continue;

    const mapa = zonasPorPaquete[paquete as Paquete];
    if (!mapa.has(zona)) mapa.set(zona, []);
    mapa.get(zona)!.push(item);
  }

  return Object.fromEntries(
    PAQUETES.map((p) => [p, [...zonasPorPaquete[p].entries()].map(([zona, items]) => ({ zona, items }))])
  ) as Record<Paquete, ZonaContenido[]>;
}

/** Lee que incluye cada paquete, ya filtrado por las zonas que aplican segun banos/habitaciones. */
export async function leerContenidoPaquetes(
  opts: { banos?: number; habitaciones?: number } = {}
): Promise<Record<Paquete, ZonaContenido[]>> {
  const crudo = await leerContenidoCrudo();
  return Object.fromEntries(
    PAQUETES.map((p) => [p, crudo[p].filter((z) => zonaAplica(z.zona, opts))])
  ) as Record<Paquete, ZonaContenido[]>;
}

export async function leerContenidoPaquete(
  paquete: Paquete,
  opts: { banos?: number; habitaciones?: number } = {}
): Promise<ZonaContenido[]> {
  const todos = await leerContenidoPaquetes(opts);
  return todos[paquete] ?? [];
}

function zonaAplica(zona: string, opts: { banos?: number; habitaciones?: number }): boolean {
  const clave = normalizar(zona);
  const condicion = ZONAS_CONDICIONALES[clave];
  return condicion ? condicion(opts) : true;
}

/** Minusculas, sin tildes/ñ-diacritico, para comparar "Baño principal" con "bano principal". */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
