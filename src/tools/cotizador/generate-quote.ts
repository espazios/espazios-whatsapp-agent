import { Readable } from "node:stream";
import { getDriveClient, getSheetsClient, getBearerToken } from "../../lib/google-auth.js";
import {
  INPUT_CELL_MAP,
  OUTPUT_CELL_MAP,
  type QuoteInput,
  type QuoteOutput,
} from "./field-map.js";

export interface GeneratedQuote {
  spreadsheetId: string;
  spreadsheetUrl: string;
  pdfDriveFileId: string;
  pdfDriveUrl: string;
  pdfBuffer: Buffer;
  output: QuoteOutput;
}

/**
 * Genera una cotizacion preliminar a partir de los datos calificados de un
 * lead: copia la plantilla unica del cotizador, la diligencia, lee el
 * resultado ya calculado por sus formulas y exporta la copia como PDF.
 *
 * La plantilla original nunca se modifica — cada llamada crea una copia
 * nueva, nombrada con el cliente y la fecha, dentro de la carpeta de salida.
 */
export async function generateQuote(input: QuoteInput): Promise<GeneratedQuote> {
  const templateId = requireEnv("COTIZADOR_TEMPLATE_ID");
  const outputFolderId = requireEnv("COTIZADOR_OUTPUT_FOLDER_ID");
  const printSheetGid = process.env.COTIZADOR_PRINT_SHEET_GID ?? "0";

  const drive = await getDriveClient();
  const sheets = await getSheetsClient();

  const fecha = new Date().toISOString().slice(0, 10);
  const copyName = `Cotizacion - ${input.clienteNombre} - ${fecha}`;

  // 1. Copiar la plantilla (nunca se edita el original).
  const copy = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: copyName, parents: [outputFolderId] },
    fields: "id, webViewLink",
  });
  const spreadsheetId = copy.data.id;
  if (!spreadsheetId) throw new Error("Drive no devolvio un id para la copia del cotizador.");

  // 2. Diligenciar los campos de entrada.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: (Object.keys(INPUT_CELL_MAP) as (keyof QuoteInput)[]).map((field) => ({
        range: INPUT_CELL_MAP[field],
        values: [[input[field]]],
      })),
    },
  });

  // 3. Leer el resultado ya calculado por las formulas de la plantilla.
  const outputRanges = Object.values(OUTPUT_CELL_MAP);
  const outputRead = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: outputRanges,
  });
  const output = mapOutputValues(outputRead.data.valueRanges ?? [], outputRanges);

  // 4. Exportar la pestana imprimible como PDF.
  const pdfBuffer = await exportSheetAsPdf(spreadsheetId, printSheetGid);

  // 5. Guardar el PDF junto a la copia diligenciada, en la misma carpeta.
  const pdfUpload = await drive.files.create({
    requestBody: {
      name: `${copyName}.pdf`,
      parents: [outputFolderId],
      mimeType: "application/pdf",
    },
    media: { mimeType: "application/pdf", body: Readable.from(pdfBuffer) },
    fields: "id, webViewLink",
  });

  return {
    spreadsheetId,
    spreadsheetUrl: copy.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    pdfDriveFileId: pdfUpload.data.id ?? "",
    pdfDriveUrl: pdfUpload.data.webViewLink ?? "",
    pdfBuffer,
    output,
  };
}

/**
 * Vuelve a traer los bytes de un PDF ya generado (por su fileId de Drive),
 * para servirlo cuando el agent node de Kapso llama al tool de cotizacion
 * y necesita una URL de la que descargar el PDF (send_media). No requiere
 * que el archivo sea publico en Drive — se descarga con nuestra cuenta de
 * servicio y se reenvia.
 */
export async function getQuotePdfBytes(fileId: string): Promise<Buffer> {
  const drive = await getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function exportSheetAsPdf(spreadsheetId: string, gid: string): Promise<Buffer> {
  const token = await getBearerToken();
  const params = new URLSearchParams({
    format: "pdf",
    gid,
    size: "A4",
    portrait: "true",
    fitw: "true",
    gridlines: "false",
    printtitle: "false",
    sheetnames: "false",
    pagenumbers: "false",
    top_margin: "0.5",
    bottom_margin: "0.5",
    left_margin: "0.5",
    right_margin: "0.5",
  });
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params.toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`No se pudo exportar el cotizador a PDF (HTTP ${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function mapOutputValues(
  valueRanges: { values?: any[][] | null }[],
  requestedRanges: string[]
): QuoteOutput {
  // batchGet devuelve valueRanges en el mismo orden en que se pidieron los
  // rangos, pero puede reescribir el string de "range" (comillas, etc.) —
  // por eso se empareja por posicion, no por texto.
  const fields = Object.keys(OUTPUT_CELL_MAP) as (keyof QuoteOutput)[];
  const result = {} as QuoteOutput;
  fields.forEach((field, i) => {
    if (OUTPUT_CELL_MAP[field] !== requestedRanges[i]) {
      throw new Error("Orden de rangos de salida inconsistente — revisar OUTPUT_CELL_MAP.");
    }
    const raw = valueRanges[i]?.values?.[0]?.[0];
    (result as any)[field] = typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  });
  return result;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  return value;
}
