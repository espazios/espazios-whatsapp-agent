import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const PAQUETE_SLUGS: Record<string, string> = {
  "Solo Obra Blanca": "solo-obra-blanca",
  Intermedio: "intermedio",
  "Remodelacion completa": "remodelacion-completa",
};

const WIDTH = 1080;
const HEIGHT = 1350;

// --- Assets (logo, fotos por paquete) ---
// Se resuelven relativo a este archivo, no al cwd del proceso, para que
// funcione sin importar desde donde se arranque el servidor.
const ASSETS_DIR = fileURLToPath(new URL("../../../assets", import.meta.url));

function loadAsset(...segments: string[]): Buffer | null {
  const filePath = path.join(ASSETS_DIR, ...segments);
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

// El servidor corre en Linux (Railway). librsvg (el motor de SVG que usa
// sharp) necesita la fuente instalada a nivel de sistema operativo — el
// @font-face embebido en el SVG (base64) resulto no ser confiable ahi
// (limitacion conocida de librsvg, el texto salia como glifos "tofu").
// La fuente se instala via nixpacks.toml (aptPkgs: fonts-dejavu-core,
// fonts-liberation) — aca solo se referencia por nombre.
const FONT_STACK = "'DejaVu Sans', 'Liberation Sans', 'Segoe UI', Arial, sans-serif";

const LOGO_BOX = { x: 60, y: 40, w: 420, h: 140 };

/** Genera la tarjeta de estimado ilustrativo como PNG. */
export async function renderTarjeta(input: TarjetaInput): Promise<Buffer> {
  const logo = loadAsset("logo.png");
  const svg = buildSvg(input, { logoPresente: logo !== null });
  let img = sharp(Buffer.from(svg)).png();
  if (logo) img = await componerLogo(img, logo);
  return img.toBuffer();
}

async function componerLogo(base: sharp.Sharp, logo: Buffer): Promise<sharp.Sharp> {
  const logoResized = await sharp(logo)
    .resize({ width: LOGO_BOX.w, height: LOGO_BOX.h, fit: "inside" })
    .toBuffer();
  const meta = await sharp(logoResized).metadata();
  const top = LOGO_BOX.y + Math.round((LOGO_BOX.h - (meta.height ?? LOGO_BOX.h)) / 2);
  const buffer = await base.toBuffer();
  return sharp(buffer).composite([{ input: logoResized, left: LOGO_BOX.x, top }]);
}

function buildSvg(input: TarjetaInput, opts: { logoPresente: boolean }): string {
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
      text { font-family: ${FONT_STACK}; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#F5F8F5" />

  <!-- Encabezado -->
  <rect width="${WIDTH}" height="220" fill="#1F2E27" />
  ${
    opts.logoPresente
      ? ""
      : `<text x="60" y="100" font-size="52" font-weight="700" fill="#FFFFFF">Espazios</text>`
  }
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

export interface DetalleInput {
  paquete: string;
  precioDesde: number | null;
  aproximado: boolean;
  items: string[];
}

const FOTO_BOX = { x: 60, y: 415, w: WIDTH - 120, h: 440 };
const ITEM_ALTURA = 42;
const ITEMS_Y_INICIO = FOTO_BOX.y + FOTO_BOX.h + 70;

/** Genera la tarjeta de detalle ("que incluye") de un solo paquete, como PNG. */
export async function renderDetalle(input: DetalleInput): Promise<Buffer> {
  const logo = loadAsset("logo.png");
  const foto = loadAsset("paquetes", `${PAQUETE_SLUGS[input.paquete] ?? "paquete"}.jpg`);
  const altura = ITEMS_Y_INICIO + Math.max(input.items.length, 1) * ITEM_ALTURA + 100;

  const svg = buildDetalleSvg(input, altura, { logoPresente: logo !== null, fotoPresente: foto !== null });
  let img = sharp(Buffer.from(svg)).png();
  if (logo) img = await componerLogo(img, logo);
  if (foto) img = await componerFoto(img, foto);
  return img.toBuffer();
}

async function componerFoto(base: sharp.Sharp, foto: Buffer): Promise<sharp.Sharp> {
  const fotoResized = await sharp(foto)
    .resize({ width: FOTO_BOX.w, height: FOTO_BOX.h, fit: "cover" })
    .toBuffer();
  const buffer = await base.toBuffer();
  return sharp(buffer).composite([{ input: fotoResized, left: FOTO_BOX.x, top: FOTO_BOX.y }]);
}

function buildDetalleSvg(
  input: DetalleInput,
  height: number,
  opts: { logoPresente: boolean; fotoPresente: boolean }
): string {
  const precioTexto =
    input.precioDesde === null
      ? "Precio disponible pronto"
      : `Desde ${formatCOP(input.precioDesde)}${input.aproximado ? "*" : ""}`;

  const items =
    input.items.length > 0
      ? input.items
          .map(
            (item, i) => `
    <circle cx="76" cy="${ITEMS_Y_INICIO + i * ITEM_ALTURA - 8}" r="5" fill="#B5722E" />
    <text x="96" y="${ITEMS_Y_INICIO + i * ITEM_ALTURA}" font-size="22" fill="#1F2E27">${escapeXml(item)}</text>`
          )
          .join("\n")
      : `<text x="60" y="${ITEMS_Y_INICIO}" font-size="22" fill="#8A968D">Detalle disponible pronto — pregunta a tu Ejecutivo Comercial.</text>`;

  // Espacio de la foto: si no hay archivo todavia, se deja el rectangulo
  // reservado con un aviso discreto — el area no se mueve cuando se agregue
  // la foto real, solo se cubre.
  const fotoPlaceholder = opts.fotoPresente
    ? ""
    : `
    <rect x="${FOTO_BOX.x}" y="${FOTO_BOX.y}" width="${FOTO_BOX.w}" height="${FOTO_BOX.h}" rx="14" fill="#E9EFE9" stroke="#D8E2DA" stroke-width="2" />
    <text x="${FOTO_BOX.x + FOTO_BOX.w / 2}" y="${FOTO_BOX.y + FOTO_BOX.h / 2}" font-size="22" fill="#9AA69C" text-anchor="middle">Foto ilustrativa proximamente</text>`;

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: ${FONT_STACK}; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${height}" fill="#F5F8F5" />

  <rect width="${WIDTH}" height="220" fill="#1F2E27" />
  ${
    opts.logoPresente
      ? ""
      : `<text x="60" y="100" font-size="52" font-weight="700" fill="#FFFFFF">Espazios</text>`
  }
  <text x="60" y="150" font-size="28" fill="#B9C9BE">Que incluye este paquete</text>

  <text x="60" y="290" font-size="38" font-weight="700" fill="#1F2E27">${escapeXml(NOMBRES_VISIBLES[input.paquete] ?? input.paquete)}</text>
  <text x="60" y="335" font-size="34" font-weight="700" fill="#B5722E">${escapeXml(precioTexto)}</text>

  <line x1="60" y1="375" x2="${WIDTH - 60}" y2="375" stroke="#D8E2DA" stroke-width="2" />

  ${fotoPlaceholder}

  ${items}

  <text x="60" y="${height - 60}" font-size="18" fill="#8A968D">
    <tspan x="60" dy="0">*Contenido y precio ilustrativos — se confirman en la visita tecnica</tspan>
    <tspan x="60" dy="26">y la cotizacion personalizada con tu Ejecutivo Comercial.</tspan>
  </text>
</svg>`.trim();
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
