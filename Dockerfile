FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json server.js ./
COPY --chown=1000:1000 lib ./lib
COPY --chown=1000:1000 public ./public
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
