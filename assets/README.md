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

**Rediseño 2026-08-28 — foto por zona, no por paquete.** La tarjeta de
detalle ("que incluye") pasa de una sola foto grande del paquete a una
foto pequeña junto a cada zona del hogar (Obra blanca, Cocina, Baño
general, etc.) — así el cliente ve el espacio real del que está leyendo
el listado, no una foto generica del paquete completo. El nombre del
archivo sale de la zona tal como está escrita en la pestaña "Incluye" de
la hoja de tarifas, normalizado (sin tildes, minúsculas, espacios a
guiones) — `slugZona()` en `render.ts`. Con las 7 zonas de hoy:

- `zonas/obra-blanca.jpg`
- `zonas/cocina.jpg`
- `zonas/zona-de-ropas.jpg`
- `zonas/bano-general.jpg`
- `zonas/bano-habitacion-principal.jpg`
- `zonas/habitacion-principal.jpg`
- `zonas/habitacion-2.jpg`
- `zonas/habitacion-3.jpg`

  Tamaño sugerido: ~800×600px o más (relación 4:3) — se recortan
  automáticamente para llenar el espacio (`cover`). Si en la pestaña
  "Incluye" aparece una zona con otro nombre, el archivo debe llamarse
  igual (normalizado) o se queda con el placeholder.

  **Cargadas 2026-09-04** — las 8 ya existen. `habitacion-2.jpg` y
  `habitacion-3.jpg` son el mismo archivo (el usuario subio la misma
  foto para ambas); reemplazar cualquiera de las dos cuando haya una
  foto distinta.

  Las fotos viejas por paquete (`paquetes/*.jpg`) ya no las usa el
  código — se pueden borrar cuando alguien confirme que no hacen falta
  en otro lado.
