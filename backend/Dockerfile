# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Expose port
EXPOSE 3001

# Entrypoint to run migrations and then the app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
