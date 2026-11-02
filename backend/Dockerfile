# Pilot System v3.1 backend — Render fix 2026-11-03.
# Pinned to Node 20 LTS per the v3.1 stack.
# FIX for Render build failure: the old runtime stage ran `npm ci --omit=dev`
# a second time, which rebuilt argon2 from source and failed with
# "Could not find any Python installation" on node:20-alpine.
# The runtime stage now copies the already-built node_modules from the
# build stage instead of reinstalling, so no compiler/Python is needed
# at runtime and the argon2 binary built in the build stage is reused
# (same base image, so it stays compatible).
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
