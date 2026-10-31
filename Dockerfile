# Self-hosted Postern relay: the API and phone page on your own server.
#   docker build -t postern-relay .
#   docker run -p 8790:8790 postern-relay
# Put it behind HTTPS (phones only run the encryption on https pages).

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN node scripts/build.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=8790 HOST=0.0.0.0
WORKDIR /app
COPY selfhost/package.json selfhost/package-lock.json selfhost/
RUN cd selfhost && npm ci --omit=dev --ignore-scripts
COPY selfhost/server.mjs selfhost/
COPY relay/src/mailbox.js relay/src/
COPY --from=build /src/relay/public relay/public
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8790/healthz || exit 1
CMD ["node", "selfhost/server.mjs"]
