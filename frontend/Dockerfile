# Pilot System v3.1 frontend — Render fix 2026-11-03.
# Pinned to Node 20 LTS per the v3.1 stack.
# FIX for Render build failure: the old runtime stage ran `npm ci --omit=dev`,
# which removed vite and vitest, but `vite preview` loads vite.config.ts,
# which imports from 'vitest/config' — so preview failed with
# "Cannot find module 'vitest/config'".
# The runtime stage now copies the already-built node_modules from the
# build stage instead of reinstalling, so vite (and the config's imports)
# are present at preview time. Serves the Vite production build via preview.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY vite.config.ts ./
EXPOSE 5173
# Render assigns its own PORT to a web service; preview must listen on
# $PORT when Render sets it, otherwise Render cannot detect the service
# and marks the deploy failed even though preview is running on 5173.
CMD ["sh", "-c", "npx vite preview --host 0.0.0.0 --port ${PORT:-5173}"]
