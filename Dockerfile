# Build : client statique (dist/) + serveur bundlé (dist-server/).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Exécution : juste Node, le serveur bundlé et les fichiers statiques.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080
CMD ["node", "dist-server/index.mjs"]
