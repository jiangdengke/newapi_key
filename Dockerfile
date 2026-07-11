FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 4173

CMD ["node", "server.js"]
