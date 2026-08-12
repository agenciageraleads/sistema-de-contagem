# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# Next.js standalone mode is recommended for Docker
ENV NEXT_OUTPUT_STANDALONE=true
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

# Copy necessary files from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["node", "server.js"]
