# Pilot System v3.1 frontend — Sprint 0 skeleton image.
# Pinned to Node 20 LTS per the v3.1 stack (see README for the local
# Node version difference). Serves the Vite production build via preview.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY vite.config.ts ./
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
