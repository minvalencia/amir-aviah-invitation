# ---- Build stage (compile better-sqlite3 native module) ----
FROM node:20-alpine AS builder

# Build deps for better-sqlite3 (a native module)
RUN apk add --no-cache python3 make g++ libc-dev

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine

WORKDIR /app

# Copy node_modules with the compiled native module from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY public ./public

# Persistent data dir (mount Render disk here for persistence)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health-check the /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]
