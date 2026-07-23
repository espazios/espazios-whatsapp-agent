/**
 * Mapeo entre los campos logicos del lead/cotizacion y las celdas reales de
 * la plantilla del cotizador en Drive.
 *
 * TODO (bloqueante): estos rangos A1 y el nombre de las pestanas son de
 * EJEMPLO. Hay que reemplazarlos por la estructura real de la plantilla
 * (ver checklist en CLAUDE.md). Para obtenerlos: abrir la plantilla, ubicar
 * cada celda de entrada/salida y anotar "NombrePestana!Celda" (ej. "Entradas!C4").
 */

export interface QuoteInput {
  clienteNombre: string;
  ciudad: string;
  tipoProyecto: string; // ej. "Cocina", "Closets", "Bano", "Remodelacion integral", "Mueble a medida"
  metrosCuadrados: number;
  nivelAcabado: string; // ej. "Estandar", "Medio", "Premium"
  telefono: string;
}

export interface QuoteOutput {
  rangoBajo: number;
  rangoAlto: number;
  resumenSupuestos: string;
}

/** Pestana de la plantilla donde se escriben los datos de entrada. */
export const INPUT_SHEET_NAME = "Entradas"; // TODO: confirmar nombre real de la pestana

/** Celdas de entrada, una por campo de QuoteInput. */
export const INPUT_CELL_MAP: Record<keyof QuoteInput, string> = {
  clienteNombre: `${INPUT_SHEET_NAME}!C4`, // TODO
  ciudad: `${INPUT_SHEET_NAME}!C5`, // TODO
  tipoProyecto: `${INPUT_SHEET_NAME}!C6`, // TODO
  metrosCuadrados: `${INPUT_SHEET_NAME}!C7`, // TODO
  nivelAcabado: `${INPUT_SHEET_NAME}!C8`, // TODO
  telefono: `${INPUT_SHEET_NAME}!C9`, // TODO
};

/** Pestana de la plantilla donde quedan los resultados ya calculados por formulas. */
export const OUTPUT_SHEET_NAME = "Entradas"; // TODO: puede ser una pestana distinta

/** Celdas de salida, una por campo de QuoteOutput. */
export const OUTPUT_CELL_MAP: Record<keyof QuoteOutput, string> = {
  rangoBajo: `${OUTPUT_SHEET_NAME}!F4`, // TODO
  rangoAlto: `${OUTPUT_SHEET_NAME}!F5`, // TODO
  resumenSupuestos: `${OUTPUT_SHEET_NAME}!F6`, // TODO
};
