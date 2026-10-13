# --- Stage 1: install everything and compile TypeScript ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: small runtime image with production dependencies only ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist
COPY eval ./eval
# Don't run as root inside the container.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
