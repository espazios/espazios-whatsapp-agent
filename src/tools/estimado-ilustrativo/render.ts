import sharp from "sharp";
import type { EstimadoPaquete } from "./pricing.js";

export interface TarjetaInput {
  nombre: string;
  ciudad: string;
  proyecto: string;
  m2: number;
  paquetes: EstimadoPaquete[];
}

const DESCRIPCIONES: Record<string, string> = {
  "Solo Obra Blanca": "Pisos, muros y techos listos para vivir",
  Intermedio: "Obra blanca + carpinteria esencial (cocina y closets)",
  "Remodelacion completa": "Acabados y carpinteria a la medida, todo incluido",
};

const NOMBRES_VISIBLES: Record<string, string> = {
  "Solo Obra Blanca": "Solo Obra Blanca",
  Intermedio: "Intermedio",
  "Remodelacion completa": "Remodelación completa",
};

const WIDTH = 1080;
const HEIGHT = 1350;

/** Genera la tarjeta de estimado ilustrativo como PNG. */
export async function renderTarjeta(input: TarjetaInput): Promise<Buffer> {
  const svg = buildSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function buildSvg(input: TarjetaInput): string {
  const paqueteY = 560;
  const paqueteAltura = 210;
  const paqueteGap = 26;

  const tarjetas = input.paquetes
    .map((p, i) => paqueteCardSvg(p, paqueteY + i * (paqueteAltura + paqueteGap), paqueteAltura))
    .join("\n");

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#F5F8F5" />

  <!-- Encabezado -->
  <rect width="${WIDTH}" height="220" fill="#1F2E27" />
  <text x="60" y="100" font-size="52" font-weight="700" fill="#FFFFFF">Espazios</text>
  <text x="60" y="150" font-size="28" fill="#B9C9BE">Estimado ilustrativo de tu proyecto</text>

  <!-- Datos del cliente -->
  <g font-size="26" fill="#1F2E27">
    <text x="60" y="280" font-weight="700">${escapeXml(input.nombre)}</text>
    <text x="60" y="320" fill="#4B594F">${escapeXml(input.proyecto)} · ${escapeXml(input.ciudad)}</text>
    <text x="60" y="360" fill="#4B594F">${input.m2} m² area privada</text>
  </g>

  <line x1="60" y1="400" x2="${WIDTH - 60}" y2="400" stroke="#D8E2DA" stroke-width="2" />

  <text x="60" y="470" font-size="30" font-weight="700" fill="#1F2E27">Estos son tus 3 paquetes</text>
  <text x="60" y="505" font-size="22" fill="#4B594F">Elige el que mas se ajuste a lo que buscas</text>

  ${tarjetas}

  <!-- Pie / disclaimer -->
  <text x="60" y="${HEIGHT - 60}" font-size="18" fill="#8A968D">
    <tspan x="60" dy="0">*Precios aproximados, no constituyen una cotizacion formal — sujetos a</tspan>
    <tspan x="60" dy="26">visita tecnica y a la cotizacion personalizada con tu Ejecutivo Comercial.</tspan>
  </text>
</svg>`.trim();
}

function paqueteCardSvg(p: EstimadoPaquete, y: number, alto: number): string {
  const descripcion = DESCRIPCIONES[p.paquete] ?? "";
  const precioTexto =
    p.precioDesde === null
      ? "Precio disponible pronto"
      : `Desde ${formatCOP(p.precioDesde)}${p.aproximado ? "*" : ""}`;

  return `
  <g>
    <rect x="60" y="${y}" width="${WIDTH - 120}" height="${alto}" rx="18" fill="#FFFFFF" stroke="#E2EAE3" stroke-width="2" />
    <text x="92" y="${y + 52}" font-size="30" font-weight="700" fill="#1F2E27">${escapeXml(NOMBRES_VISIBLES[p.paquete] ?? p.paquete)}</text>
    <text x="92" y="${y + 90}" font-size="22" fill="#4B594F">${escapeXml(descripcion)}</text>
    <text x="92" y="${y + alto - 40}" font-size="42" font-weight="700" fill="#B5722E">${escapeXml(precioTexto)}</text>
  </g>`;
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
