# Servidor de Gundam Assemble (Express + Socket.IO). Se construye desde la raíz
# del repositorio: docker build -f server/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server/data ./data
# Railway / Render / Fly ponen PORT; en local, 3001
EXPOSE 3001
CMD ["node", "dist/index.js"]
