FROM node:20-alpine
WORKDIR /app
COPY backend/package.json ./backend/package.json
COPY backend/src ./backend/src
COPY frontend ./frontend
COPY db ./db
COPY docs ./docs
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
