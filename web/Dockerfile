# --- Stage 1: install and build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# Where Next.js forwards /api requests. Baked in at build time.
ARG API_URL=http://server:4000
ENV API_URL=$API_URL
RUN npm run build

# --- Stage 2: run the standalone server ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
