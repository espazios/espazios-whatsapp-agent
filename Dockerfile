# Railpack (el builder por defecto de Railway) fallaba en el paso
# "prepare" sin dar ningun detalle (build de 4-5s, "railpack prepare
# exited with an error"), incluso con diffs minimos y sin variables de
# apt-packages — asi que dejamos esa caja negra y controlamos el build
# nosotros mismos. Ver CLAUDE.md para la bitacora completa.
FROM node:22-bookworm-slim

# fontconfig + DejaVu/Liberation: necesarios para que sharp/librsvg
# rendericen texto en las tarjetas SVG->PNG (el @font-face embebido en
# el SVG no es confiable en librsvg, hay que instalar la fuente en el SO).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
