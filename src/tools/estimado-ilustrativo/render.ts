import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { EstimadoPaquete, Paquete } from "./pricing.js";
import type { ZonaContenido } from "./contenido.js";

export interface TarjetaPaqueteInput extends EstimadoPaquete {
  /** true si este es el paquete que coincide con el tipo_proyecto que el cliente ya eligio — se destaca en la tarjeta. */
  elegido?: boolean;
}

export interface TarjetaInput {
  nombre: string;
  ciudad: string;
  proyecto: string;
  m2: number;
  paquetes: TarjetaPaqueteInput[];
}

const DESCRIPCIONES: Record<string, string> = {
  "Solo Obra Blanca": "Pisos, muros y techos listos para vivir",
  Intermedio: "Obra blanca + carpinteria esencial (cocina y closets)",
  "Remodelacion completa": "Acabados y carpinteria a la medida, todo incluido",
};

// Nombres visibles para el cliente — evolucion 2026-08-28: "Remodelacion
// completa" pasa a mostrarse como "Remodelación Total" (nombre propio del
// paquete, no solo el termino tecnico) para que la pregunta de tipo de
// proyecto y la tarjeta de estimado usen exactamente el mismo nombre.
const NOMBRES_VISIBLES: Record<string, string> = {
  "Solo Obra Blanca": "Solo Obra Blanca",
  Intermedio: "Intermedio",
  "Remodelacion completa": "Remodelación Total",
};

const WIDTH = 1080;

// Descuento por defecto que se muestra en la etiqueta de la esquina cuando
// no se puede calcular el real a partir del precio con/sin descuento (ver
// calcularDescuentoPct) — pedido explicito del usuario 2026-08-28, "dato
// parametrico, default 3%". Coincide con el 3% que ya trae la formula de
// la hoja de tarifas (precio_m2 con descuento = precio_m2 - 3%).
const DESCUENTO_PCT_DEFAULT = 3;

// --- Paleta de marca ---
// Tomada por muestreo directo de assets/logo.png (2026-08-24): el logo real
// de Espazios usa un verde teal oscuro y un verde salvia — nada de naranja,
// que era un color arbitrario del primer borrador de esta tarjeta. El
// encabezado pasa de fondo verde oscuro a fondo blanco (mejor para un logo a
// color que no esta pensado para fondos oscuros), con una barra de acento en
// salvia como unico toque de color de marca ahi — principio de jerarquia:
// un solo acento fuerte, no repetir el mismo verde en todo.
const COLORS = {
  ink: "#123B38", // texto fuerte: nombre del cliente, titulos, precios
  inkMuted: "#4F6B67", // texto secundario: descripciones, meta info
  sage: "#6FBE94", // acento de marca: barra del encabezado, bullets, etiqueta de descuento
  sageTint: "#EAF6EF", // fondo suave para placeholders/badges
  bgPage: "#F6FAF8", // fondo de la tarjeta (fuera de las cards blancas)
  bgCard: "#FFFFFF", // fondo del encabezado y de las cards
  border: "#DCEAE1", // bordes y lineas divisorias
  footer: "#7C8D88", // texto de pie de pagina / disclaimers
  legalBg: "#F1F5F3", // fondo del bloque legal, distinto del bgPage para que se note como bloque aparte
} as const;

// --- Assets (logo, fotos por paquete, fotos por zona) ---
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

/** "Baño habitación principal" -> "bano-habitacion-principal", para nombrar el archivo de foto de esa zona. */
function slugZona(zona: string): string {
  return zona
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// El servidor corre en Linux (Railway). librsvg (el motor de SVG que usa
// sharp) necesita la fuente instalada a nivel de sistema operativo — el
// @font-face embebido en el SVG (base64) resulto no ser confiable ahi
// (limitacion conocida de librsvg, el texto salia como glifos "tofu"). La
// fuente se instala via el Dockerfile propio (apt: fonts-dejavu-core,
// fonts-liberation) — aca solo se referencia por nombre.
const FONT_STACK = "'DejaVu Sans', 'Liberation Sans', 'Segoe UI', Arial, sans-serif";

// h controla el tamano real (fit:"inside" lo limita por altura); w solo
// pone un tope maximo. El logo real es panoramico (~2.5:1 icono+wordmark),
// asi que h=100 dejaba antes suficiente aire respecto al subtitulo de abajo.
const LOGO_BOX = { x: 60, y: 46, w: 320, h: 100 };
const HEADER_HEIGHT = 220;
const HEADER_ACCENT_HEIGHT = 6;

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

async function componerImagen(
  base: sharp.Sharp,
  imagen: Buffer,
  box: { x: number; y: number; w: number; h: number }
): Promise<sharp.Sharp> {
  const resized = await sharp(imagen)
    .resize({ width: box.w, height: box.h, fit: "cover" })
    .toBuffer();
  const buffer = await base.toBuffer();
  return sharp(buffer).composite([{ input: resized, left: box.x, top: box.y }]);
}

/**
 * Etiqueta de descuento — esquina superior izquierda, pedido explicito del
 * usuario 2026-08-28. Ley de aislamiento (Von Restorff): unico elemento con
 * esquinas cuadradas contra un header de esquinas suaves, para que lea como
 * un sello/tag y no como un boton mas.
 */
function etiquetaDescuentoSvg(pct: number): string {
  const texto = `Incluye descuento del ${pct}%`;
  const ancho = 110 + texto.length * 9.5;
  return `
  <rect x="0" y="0" width="${ancho}" height="34" fill="${COLORS.ink}" />
  <path d="M ${ancho} 0 L ${ancho + 14} 17 L ${ancho} 34 Z" fill="${COLORS.ink}" />
  <text x="18" y="23" font-size="17" font-weight="700" fill="${COLORS.bgCard}">${escapeXml(texto)}</text>`;
}

/** Encabezado compartido: fondo blanco + logo (o texto de respaldo) + tagline + barra de acento. */
function encabezadoSvg(subtitulo: string, opts: { logoPresente: boolean; descuentoPct: number }): string {
  return `
  <rect width="${WIDTH}" height="${HEADER_HEIGHT}" fill="${COLORS.bgCard}" />
  <rect x="0" y="${HEADER_HEIGHT}" width="${WIDTH}" height="${HEADER_ACCENT_HEIGHT}" fill="${COLORS.sage}" />
  ${etiquetaDescuentoSvg(opts.descuentoPct)}
  ${
    opts.logoPresente
      ? ""
      : `<text x="60" y="106" font-size="52" font-weight="700" fill="${COLORS.ink}">Espazios</text>`
  }
  <text x="60" y="163" font-size="16" font-style="italic" fill="${COLORS.footer}">Dale vida a cada lugar.</text>
  <text x="60" y="200" font-size="26" fill="${COLORS.inkMuted}">${escapeXml(subtitulo)}</text>`;
}

/** Redondea a un entero — evita mostrar "2.97%" cuando el numero real trae ruido de coma flotante. */
function calcularDescuentoPct(
  precioDesde: number | null,
  precioDesdeSinDescuento: number | null
): number {
  if (precioDesde === null || precioDesdeSinDescuento === null || precioDesdeSinDescuento <= precioDesde) {
    return DESCUENTO_PCT_DEFAULT;
  }
  return Math.round((1 - precioDesde / precioDesdeSinDescuento) * 100);
}

/**
 * Precio principal (con descuento si lo hay) + precio de lista tachado
 * arriba, cuando el precio con descuento es menor. Si no hay descuento
 * real (o el precio no esta disponible), muestra una sola linea.
 */
function bloquePrecioSvg(
  p: Pick<EstimadoPaquete, "precioDesde" | "precioDesdeSinDescuento" | "aproximado">,
  opts: { x: number; yPrincipal: number; fontPrincipal: number; fontTachado?: number }
): string {
  if (p.precioDesde === null) {
    return `<text x="${opts.x}" y="${opts.yPrincipal}" font-size="${opts.fontPrincipal}" font-weight="700" fill="${COLORS.ink}">Precio disponible pronto</text>`;
  }

  const hayDescuento = p.precioDesdeSinDescuento !== null && p.precioDesdeSinDescuento > p.precioDesde;
  const principal = `Desde ${formatCOP(p.precioDesde)}${hayDescuento ? " con descuento" : ""}${p.aproximado ? "*" : ""}`;
  const lineaPrincipal = `<text x="${opts.x}" y="${opts.yPrincipal}" font-size="${opts.fontPrincipal}" font-weight="700" fill="${COLORS.ink}">${escapeXml(principal)}</text>`;

  if (!hayDescuento) return lineaPrincipal;

  const fontTachado = opts.fontTachado ?? Math.round(opts.fontPrincipal * 0.48);
  const yTachado = opts.yPrincipal - opts.fontPrincipal - 4;
  const lineaTachada = `<text x="${opts.x}" y="${yTachado}" font-size="${fontTachado}" fill="${COLORS.inkMuted}" text-decoration="line-through">Antes ${formatCOP(p.precioDesdeSinDescuento!)}</text>`;
  return `${lineaTachada}\n    ${lineaPrincipal}`;
}

function buildSvg(input: TarjetaInput, opts: { logoPresente: boolean }): string {
  const paqueteY = 560;
  const paqueteAltura = 240; // espacio extra para el precio tachado arriba del precio con descuento
  const paqueteGap = 26;

  const tarjetas = input.paquetes
    .map((p, i) => paqueteCardSvg(p, paqueteY + i * (paqueteAltura + paqueteGap), paqueteAltura))
    .join("\n");

  const cardsFinY = paqueteY + input.paquetes.length * (paqueteAltura + paqueteGap) - paqueteGap;
  const descuentoPct = calcularDescuentoPct(
    input.paquetes.find((p) => p.precioDesde !== null)?.precioDesde ?? null,
    input.paquetes.find((p) => p.precioDesde !== null)?.precioDesdeSinDescuento ?? null
  );
  const legal = bloqueLegal(cardsFinY + 50, descuentoPct);
  const height = legal.y + legal.alto + 40;

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: ${FONT_STACK}; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${height}" fill="${COLORS.bgPage}" />

  ${encabezadoSvg("Estimado ilustrativo de tu proyecto", { logoPresente: opts.logoPresente, descuentoPct })}

  <!-- Datos del cliente -->
  <g font-size="26" fill="${COLORS.ink}">
    <text x="60" y="280" font-weight="700">${escapeXml(input.nombre)}</text>
    <text x="60" y="320" fill="${COLORS.inkMuted}">${escapeXml(input.proyecto)} · ${escapeXml(input.ciudad)}</text>
    <text x="60" y="360" fill="${COLORS.inkMuted}">${input.m2} m² area privada</text>
  </g>

  <line x1="60" y1="400" x2="${WIDTH - 60}" y2="400" stroke="${COLORS.border}" stroke-width="2" />

  <text x="60" y="470" font-size="30" font-weight="700" fill="${COLORS.ink}">Estos son tus 3 paquetes</text>
  <text x="60" y="505" font-size="22" fill="${COLORS.inkMuted}">Elige el que mas se ajuste a lo que buscas</text>

  ${tarjetas}

  ${legal.svg}
</svg>`.trim();
}

function paqueteCardSvg(p: TarjetaPaqueteInput, y: number, alto: number): string {
  const descripcion = DESCRIPCIONES[p.paquete] ?? "";
  const bordeAncho = p.elegido ? 4 : 2;
  const bordeColor = p.elegido ? COLORS.ink : COLORS.border;

  const badge = p.elegido
    ? `
    <rect x="${WIDTH - 60 - 172}" y="${y + 18}" width="172" height="34" rx="17" fill="${COLORS.sage}" />
    <text x="${WIDTH - 60 - 172 + 86}" y="${y + 41}" font-size="18" font-weight="700" fill="${COLORS.bgCard}" text-anchor="middle">Tu elección</text>`
    : "";

  return `
  <g>
    <rect x="60" y="${y}" width="${WIDTH - 120}" height="${alto}" rx="18" fill="${COLORS.bgCard}" stroke="${bordeColor}" stroke-width="${bordeAncho}" />
    <rect x="60" y="${y}" width="6" height="${alto}" rx="3" fill="${COLORS.sage}" />
    ${badge}
    <text x="92" y="${y + 52}" font-size="30" font-weight="700" fill="${COLORS.ink}">${escapeXml(NOMBRES_VISIBLES[p.paquete] ?? p.paquete)}</text>
    <text x="92" y="${y + 90}" font-size="22" fill="${COLORS.inkMuted}">${escapeXml(descripcion)}</text>
    ${bloquePrecioSvg(p, { x: 92, yPrincipal: y + alto - 40, fontPrincipal: 42 })}
  </g>`;
}

export interface DetalleInput {
  nombre: string;
  ciudad: string;
  proyecto: string;
  m2: number;
  /** Fila de tarifa realmente usada (ver pricing.ts) — se muestran solo si se conocen. */
  banos: number | null;
  habitaciones: number | null;
  paquete: Paquete;
  precioDesde: number | null;
  precioDesdeSinDescuento: number | null;
  aproximado: boolean;
  zonas: ZonaContenido[];
}

// --- Layout de zonas: imagen a la izquierda, encabezado + items a la derecha ---
// Ley de la region comun (cada zona es su propia tarjeta) + ley de proximidad
// (la foto vive junto a su texto, no en un bloque separado arriba).
const ZONA_PADDING = 24;
const ZONA_IMG = { w: 200, h: 150 };
const ZONA_GAP_IMG_TEXTO = 24;
const ZONA_TITULO_ALTURA = 48; // espacio entre el techo de la tarjeta y la linea base del primer item
const ITEM_FONT = 21;
const ITEM_LINE_H = 28;
const ITEM_GAP = 10;
const ZONA_CARD_GAP = 22;
const ZONAS_X = 60;
const ZONAS_ANCHO = WIDTH - 120;

interface ZonaLayout {
  zona: string;
  lineasPorItem: string[][];
  alto: number;
}

/** Envuelve texto a un ancho maximo en px, estimando el ancho de caracter para DejaVu Sans/Liberation Sans. */
function envolverTexto(texto: string, anchoPx: number, fontSize: number): string[] {
  const maxChars = Math.max(10, Math.floor(anchoPx / (fontSize * 0.54)));
  const palabras = texto.split(" ");
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (candidata.length > maxChars && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function calcularLayoutZonas(zonas: ZonaContenido[], anchoTexto: number): ZonaLayout[] {
  return zonas.map((z) => {
    const lineasPorItem = z.items.map((item) => envolverTexto(item, anchoTexto, ITEM_FONT));
    const totalLineas = lineasPorItem.reduce((acc, l) => acc + l.length, 0);
    const contenidoAlto = ZONA_TITULO_ALTURA + totalLineas * ITEM_LINE_H + (lineasPorItem.length - 1) * ITEM_GAP;
    const alto = Math.max(contenidoAlto, ZONA_IMG.h) + ZONA_PADDING * 2;
    return { zona: z.zona, lineasPorItem, alto };
  });
}

/** Genera la tarjeta de detalle ("que incluye") de un solo paquete, como PNG. */
export async function renderDetalle(input: DetalleInput): Promise<Buffer> {
  const logo = loadAsset("logo.png");
  const anchoTexto = ZONAS_ANCHO - ZONA_PADDING * 2 - ZONA_IMG.w - ZONA_GAP_IMG_TEXTO;
  const layout = calcularLayoutZonas(input.zonas, anchoTexto);
  const fotosZona = input.zonas.map((z) => loadAsset("zonas", `${slugZona(z.zona)}.jpg`));

  const { svg, height } = buildDetalleSvg(input, layout, {
    logoPresente: logo !== null,
    fotosPresentes: fotosZona.map((f) => f !== null),
  });

  let img = sharp(Buffer.from(svg)).png();
  if (logo) img = await componerLogo(img, logo);

  // Componer las fotos de zona que si existan, en el mismo orden/posicion que el SVG.
  let cursorY = ZONAS_Y_INICIO;
  for (let i = 0; i < layout.length; i++) {
    const foto = fotosZona[i];
    if (foto) {
      img = await componerImagen(img, foto, { x: ZONAS_X + ZONA_PADDING, y: cursorY + ZONA_PADDING, w: ZONA_IMG.w, h: ZONA_IMG.h });
    }
    cursorY += layout[i].alto + ZONA_CARD_GAP;
  }

  return img.toBuffer();
}

// Encabezado (220) + datos de cliente/proyecto (3 lineas) + precio + divisor.
const ZONAS_Y_INICIO = 470;

function bloqueLegal(y: number, descuentoPct: number): { svg: string; y: number; alto: number } {
  const lineas = [
    "Este documento es un estimado ilustrativo y preliminar — no constituye",
    "una oferta comercial en firme ni una cotización definitiva de Espazios.",
    "El valor final puede variar según la personalización que elijas para tu",
    "proyecto y los ajustes que resulten de conocer tu vivienda en la visita",
    `técnica. El descuento del ${descuentoPct}% se confirma en la cotización formal,`,
    "que entrega tu Ejecutivo Comercial tras esa visita.",
  ];
  const alto = 28 + lineas.length * 24 + 16;
  const tspans = lineas.map((l, i) => `<tspan x="84" dy="${i === 0 ? 0 : 24}">${escapeXml(l)}</tspan>`).join("");
  return {
    svg: `
  <rect x="0" y="${y}" width="${WIDTH}" height="${alto}" fill="${COLORS.legalBg}" />
  <rect x="60" y="${y + 18}" width="4" height="${alto - 36}" fill="${COLORS.sage}" />
  <text x="84" y="${y + 28}" font-size="17" fill="${COLORS.footer}">${tspans}</text>`,
    y,
    alto,
  };
}

function buildDetalleSvg(
  input: DetalleInput,
  layout: ZonaLayout[],
  opts: { logoPresente: boolean; fotosPresentes: boolean[] }
): { svg: string; height: number } {
  const descuentoPct = calcularDescuentoPct(input.precioDesde, input.precioDesdeSinDescuento);

  const metaPartes = [`${input.m2} m² área privada`];
  if (input.habitaciones !== null) metaPartes.push(`${input.habitaciones} habitación${input.habitaciones === 1 ? "" : "es"}`);
  if (input.banos !== null) metaPartes.push(`${input.banos} baño${input.banos === 1 ? "" : "s"}`);

  let cursorY = ZONAS_Y_INICIO;
  const zonasSvg =
    layout.length > 0
      ? layout
          .map((z, i) => {
            const cardY = cursorY;
            const cardAlto = z.alto;
            const imgX = ZONAS_X + ZONA_PADDING;
            const imgY = cardY + ZONA_PADDING;
            const textoX = imgX + ZONA_IMG.w + ZONA_GAP_IMG_TEXTO;
            const textoAnchoDisponible = ZONAS_ANCHO - ZONA_PADDING * 2 - ZONA_IMG.w - ZONA_GAP_IMG_TEXTO;

            const fotoPlaceholder = opts.fotosPresentes[i]
              ? ""
              : `
      <rect x="${imgX}" y="${imgY}" width="${ZONA_IMG.w}" height="${ZONA_IMG.h}" rx="10" fill="${COLORS.sageTint}" stroke="${COLORS.border}" stroke-width="2" />
      <text x="${imgX + ZONA_IMG.w / 2}" y="${imgY + ZONA_IMG.h / 2}" font-size="15" fill="${COLORS.inkMuted}" text-anchor="middle">Foto próximamente</text>`;

            let itemCursorY = cardY + ZONA_PADDING + ZONA_TITULO_ALTURA;
            const itemsSvg = z.lineasPorItem
              .map((lineas) => {
                const bulletY = itemCursorY - 7;
                const bloque = `
      <circle cx="${textoX + 6}" cy="${bulletY}" r="4.5" fill="${COLORS.sage}" />
      <text x="${textoX + 20}" y="${itemCursorY}" font-size="${ITEM_FONT}" fill="${COLORS.ink}">${lineas
                  .map((l, li) => `<tspan x="${textoX + 20}" dy="${li === 0 ? 0 : ITEM_LINE_H}">${escapeXml(l)}</tspan>`)
                  .join("")}</text>`;
                itemCursorY += lineas.length * ITEM_LINE_H + ITEM_GAP;
                return bloque;
              })
              .join("\n");

            cursorY += cardAlto + ZONA_CARD_GAP;

            return `
    <rect x="${ZONAS_X}" y="${cardY}" width="${ZONAS_ANCHO}" height="${cardAlto}" rx="14" fill="${COLORS.bgCard}" stroke="${COLORS.border}" stroke-width="2" />
    ${fotoPlaceholder}
    <text x="${textoX}" y="${cardY + ZONA_PADDING + 24}" font-size="24" font-weight="700" fill="${COLORS.ink}">${escapeXml(z.zona)}</text>
    ${itemsSvg}`;
          })
          .join("\n")
      : `<text x="${ZONAS_X}" y="${cursorY}" font-size="22" fill="${COLORS.footer}">Detalle disponible pronto — pregunta a tu Ejecutivo Comercial.</text>`;

  if (layout.length === 0) cursorY += 50;

  const legal = bloqueLegal(cursorY + 30, descuentoPct);
  const height = legal.y + legal.alto + 40;

  const svg = `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text { font-family: ${FONT_STACK}; }
    </style>
  </defs>

  <rect width="${WIDTH}" height="${height}" fill="${COLORS.bgPage}" />

  ${encabezadoSvg("Que incluye este paquete", { logoPresente: opts.logoPresente, descuentoPct })}

  <text x="60" y="255" font-size="20" fill="${COLORS.footer}">Cotización ilustrativa preparada para</text>
  <text x="60" y="285" font-size="26" font-weight="700" fill="${COLORS.ink}">${escapeXml(input.nombre)}</text>
  <text x="60" y="315" font-size="20" fill="${COLORS.inkMuted}">${escapeXml(input.proyecto)} · ${escapeXml(input.ciudad)} · ${escapeXml(metaPartes.join(" · "))}</text>

  <text x="60" y="365" font-size="32" font-weight="700" fill="${COLORS.ink}">${escapeXml(NOMBRES_VISIBLES[input.paquete] ?? input.paquete)}</text>
  ${bloquePrecioSvg(input, { x: 60, yPrincipal: 415, fontPrincipal: 34, fontTachado: 20 })}

  <line x1="60" y1="440" x2="${WIDTH - 60}" y2="440" stroke="${COLORS.border}" stroke-width="2" />

  ${zonasSvg}

  ${legal.svg}
</svg>`.trim();

  return { svg, height };
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
