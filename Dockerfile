FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=4173

COPY --from=builder --chown=node:node /app/.next/standalone ./

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 4173

CMD ["node", "server.js"]
