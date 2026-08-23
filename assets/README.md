# Assets de las tarjetas de estimado ilustrativo

Poner los archivos aca con estos nombres exactos — el codigo los detecta
solo (`src/tools/estimado-ilustrativo/render.ts`) y aparecen en la
proxima tarjeta generada, sin tocar nada mas. Mientras no existan, las
tarjetas se generan igual con un placeholder discreto en su lugar.

- `logo.png` — logo de Espazios, fondo transparente recomendado. Se
  ubica en el encabezado oscuro de ambas tarjetas (resumen y detalle).
  Tamano sugerido: ~600×250px o proporcion similar (se ajusta
  automaticamente, sin recortar).

- `paquetes/solo-obra-blanca.jpg` — foto ilustrativa del paquete "Solo
  Obra Blanca", en la tarjeta de detalle.
- `paquetes/intermedio.jpg` — foto del paquete "Intermedio".
- `paquetes/remodelacion-completa.jpg` — foto del paquete "Remodelacion
  completa".

  Tamano sugerido para las tres: horizontales, ~1600×900px o mas — se
  recortan automaticamente para llenar el espacio (`cover`), asi que una
  foto muy vertical puede perder los bordes laterales.
