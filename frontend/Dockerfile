FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_BASE_PATH=/pollapp/
ARG VITE_API_BASE=/pollapp/api
ARG VITE_DEFAULT_SERVER_URL=

ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_DEFAULT_SERVER_URL=$VITE_DEFAULT_SERVER_URL

COPY package.json package-lock.json* tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
