import "dotenv/config";
import fs from "node:fs";
import { generateQuote } from "../src/tools/cotizador/generate-quote.js";

/**
 * Prueba manual del flujo de cotizacion. Requiere .env completo
 * (ver .env.example) y el field-map.ts actualizado con la estructura real
 * de la plantilla.
 *
 * Uso: npm run generate-quote
 */
async function main() {
  const result = await generateQuote({
    clienteNombre: "Cliente de prueba",
    ciudad: "Bogota",
    tipoProyecto: "Cocina",
    metrosCuadrados: 12,
    nivelAcabado: "Medio",
    telefono: "3000000000",
  });

  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync("tmp/cotizacion-prueba.pdf", result.pdfBuffer);

  console.log("Cotizacion generada:");
  console.log("  Hoja diligenciada:", result.spreadsheetUrl);
  console.log("  PDF en Drive:", result.pdfDriveUrl);
  console.log("  PDF local:", "tmp/cotizacion-prueba.pdf");
  console.log("  Resultado:", result.output);
}

main().catch((err) => {
  console.error("Fallo la generacion de la cotizacion:", err);
  process.exit(1);
});
