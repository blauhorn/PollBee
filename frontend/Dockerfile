FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/pollapp
