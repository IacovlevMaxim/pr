# Multi-stage Dockerfile for the TypeScript server
# Builder: installs dev deps, builds TS to JS
FROM node:20-alpine AS builder
WORKDIR /app

# Install build-time dependencies
COPY package.json package-lock.json* ./
# RUN apk add --no-cache python3 make g++ || true
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Runtime image: only production deps + built artifact
FROM node:20-alpine AS runner
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

EXPOSE 5000
CMD ["node", "dist/server.js"]
