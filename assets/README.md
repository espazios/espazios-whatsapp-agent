# Assets de las tarjetas de estimado ilustrativo

Poner los archivos aca con estos nombres exactos — el codigo los detecta
solo (`src/tools/estimado-ilustrativo/render.ts`) y aparecen en la
proxima tarjeta generada, sin tocar nada mas. Mientras no existan, las
tarjetas se generan igual con un placeholder discreto en su lugar.

- `logo.png` — **ya cargado (2026-08-24)**, logo real de Espazios a
  color con fondo transparente. Se ubica en el encabezado blanco de
  ambas tarjetas (resumen y detalle) — el encabezado se redisenio de
  verde oscuro a blanco porque el logo a color no esta pensado para
  fondo oscuro. Paleta de la tarjeta tomada por muestreo del logo (ver
  `COLORS` en `render.ts`).

- `paquetes/solo-obra-blanca.jpg` — foto ilustrativa del paquete "Solo
  Obra Blanca", en la tarjeta de detalle.
- `paquetes/intermedio.jpg` — foto del paquete "Intermedio".
- `paquetes/remodelacion-completa.jpg` — foto del paquete "Remodelacion
  completa".

  Tamano sugerido para las tres: horizontales, ~1600×900px o mas — se
  recortan automaticamente para llenar el espacio (`cover`), asi que una
  foto muy vertical puede perder los bordes laterales.
