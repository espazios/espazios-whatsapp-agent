import { getSheetsClient } from "../../lib/google-auth.js";

/**
 * Lee el "Tarifas Ilustrativas - Isa" (hoja limpia, separada de la
 * plantilla operativa del Ejecutivo Comercial) y calcula el "Desde $X" de
 * los 3 paquetes para un area dada. Nunca inventa un precio: si la celda
 * de precio esta vacia (todavia no la llena el equipo comercial), o el
 * area no cae en ningun m2 conocido, lo dice explicitamente en vez de
 * calcular algo.
 *
 * Evolucion 2026-08-28: la hoja paso de "un precio por rango de m2" (25-35
 * / 36-45 / 46-55) a "un precio por cada m2 exacto" (19 a 60), con una
 * fila por paquete+m2 — y en la banda 31-44 m2, DOS filas por m2 segun
 * banos (1 o 2; habitaciones queda fijo en 2 en esa banda, no hace falta
 * preguntarla). Fuera de esa banda (<=30 o >=45) hay una sola fila por m2,
 * no hace falta preguntar nada.
 */

export const PAQUETES = ["Solo Obra Blanca", "Intermedio", "Remodelacion completa"] as const;
export type Paquete = (typeof PAQUETES)[number];

interface TarifaFila {
  paquete: Paquete;
  banos: number;
  habitaciones: number;
  m2: number;
  precioM2: number | null;
  precioM2Descuento: number | null;
}

export interface EstimadoPaquete {
  paquete: Paquete;
  /** Total "desde $" con descuento, ya multiplicado por el area — el numero principal que ve el cliente. */
  precioDesde: number | null;
  /** Total sin descuento — se muestra tachado junto al precio con descuento. */
  precioDesdeSinDescuento: number | null;
  /** Si el area (o la combinacion banos/m2 pedida) cayo fuera de lo conocido, se uso el dato mas cercano. */
  aproximado: boolean;
  /**
   * Banos/habitaciones de la fila de tarifa realmente usada — se derivan
   * solos del m2 (fijos fuera de la banda 31-44) o del `banos` que se le
   * paso a `calcularEstimado` (dentro de esa banda). `leerContenidoPaquete`
   * los recibe tal cual para decidir que zonas del "Incluye" mostrar (ej.
   * "Baño principal" solo si banos=2) — nunca hace falta pedirle
   * `habitaciones` al cliente por separado.
   */
  banos: number | null;
  habitaciones: number | null;
}

// paquete, Baños, Habitaciones, m2, precio_m2, precio_m2 con descuento, notas — sin encabezado.
const TARIFAS_RANGE = "A2:G";

const BANOS_POR_DEFECTO = 1; // opcion mas economica si no se sabe (m2 31-44 sin banos aun recolectado)

export async function calcularEstimado(m2: number, banos?: number): Promise<EstimadoPaquete[]> {
  const filas = await leerTarifas();
  return PAQUETES.map((paquete) => estimarParaPaquete(paquete, m2, banos, filas));
}

async function leerTarifas(): Promise<TarifaFila[]> {
  const spreadsheetId = requireEnv("TARIFAS_ILUSTRATIVAS_SHEET_ID");
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: TARIFAS_RANGE,
    // Numeros crudos (sin formatear con el locale de la hoja) — evita
    // ambiguedad entre "531389,4" (coma decimal) y "531,389.4" (coma de miles).
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values ?? [];

  const filas: TarifaFila[] = [];
  for (const row of rows) {
    const paquete = normalizarPaquete(row[0]);
    const m2 = parseNumero(row[3]);
    if (!paquete || m2 === null) continue; // filas de nota/referencia sin datos completos
    filas.push({
      paquete,
      banos: parseNumero(row[1]) ?? BANOS_POR_DEFECTO,
      habitaciones: parseNumero(row[2]) ?? 1,
      m2,
      precioM2: parsePrecio(row[4]),
      precioM2Descuento: parsePrecio(row[5]),
    });
  }
  return filas;
}

/**
 * Mapea el `tipo_proyecto` que Isa ya recolecto (uno de los 3 nombres de
 * paquete, o "Carpintería") al paquete interno correspondiente — para
 * saber cual tarjeta destacar y de cual mandar el detalle de una vez.
 * "Carpintería" (y cualquier otra cosa que no matchee) devuelve null: no
 * tiene paquete de precio por m2 asociado, sigue su flujo aparte.
 */
export function paqueteDesdeTipoProyecto(tipoProyecto: string | undefined | null): Paquete | null {
  return normalizarPaquete(tipoProyecto);
}

/** Acepta variantes de escritura/acentos y el alias historico "Total" (como quedo cargada la hoja) para "Remodelacion completa". */
function normalizarPaquete(raw: unknown): Paquete | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const limpio = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (limpio === "solo obra blanca") return "Solo Obra Blanca";
  if (limpio === "intermedio") return "Intermedio";
  if (limpio === "total" || limpio === "remodelacion completa" || limpio === "remodelacion total") {
    return "Remodelacion completa";
  }
  return null;
}

function estimarParaPaquete(
  paquete: Paquete,
  m2: number,
  banos: number | undefined,
  filas: TarifaFila[]
): EstimadoPaquete {
  const delPaquete = filas.filter((f) => f.paquete === paquete);
  if (delPaquete.length === 0) {
    return { paquete, precioDesde: null, precioDesdeSinDescuento: null, aproximado: false, banos: null, habitaciones: null };
  }

  const banosPreferido = banos === 2 ? 2 : BANOS_POR_DEFECTO;

  const exacta = filasEnM2(delPaquete, m2, banosPreferido)[0];
  if (exacta) {
    return {
      paquete,
      precioDesde: totalDesde(exacta.precioM2Descuento, m2),
      precioDesdeSinDescuento: totalDesde(exacta.precioM2, m2),
      aproximado: false,
      banos: exacta.banos,
      habitaciones: exacta.habitaciones,
    };
  }

  // m2 fuera de la tabla (hoy 19-60): usar el m2 conocido mas cercano (el
  // mas bajo si el area pedida es menor a todos, el mas alto si es mayor).
  const m2Disponibles = [...new Set(delPaquete.map((f) => f.m2))].sort((a, b) => a - b);
  const m2Cercano = m2 < m2Disponibles[0] ? m2Disponibles[0] : m2Disponibles[m2Disponibles.length - 1];
  const masCercana = filasEnM2(delPaquete, m2Cercano, banosPreferido)[0];
  return {
    paquete,
    precioDesde: totalDesde(masCercana?.precioM2Descuento ?? null, m2),
    precioDesdeSinDescuento: totalDesde(masCercana?.precioM2 ?? null, m2),
    aproximado: true,
    banos: masCercana?.banos ?? null,
    habitaciones: masCercana?.habitaciones ?? null,
  };
}

/** Filas de un paquete para un m2 dado, prefiriendo la fila del numero de banos pedido cuando hay mas de una (banda 31-44). */
function filasEnM2(delPaquete: TarifaFila[], m2: number, banosPreferido: number): TarifaFila[] {
  const enM2 = delPaquete.filter((f) => f.m2 === m2);
  if (enM2.length <= 1) return enM2;
  const conBanosPreferido = enM2.filter((f) => f.banos === banosPreferido);
  return conBanosPreferido.length > 0 ? conBanosPreferido : enM2;
}

function totalDesde(precioM2: number | null, m2: number): number | null {
  return precioM2 === null ? null : Math.round(precioM2 * m2);
}

function parsePrecio(raw: unknown): number | null {
  const n = parseNumero(raw);
  return n !== null && n > 0 ? n : null;
}

function parseNumero(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
