FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_BASE_PATH=/pollapp/
ARG VITE_API_BASE=/pollapp/api
ARG VITE_DEFAULT_SERVER_URL=
ARG VITE_PWA_ID=/pollapp/
ARG VITE_APP_NAME=PollBee
ARG VITE_APP_SHORT_NAME=PollBee
ARG VITE_THEME_COLOR=#2563eb
ARG VITE_START_URL=/pollapp/

ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_DEFAULT_SERVER_URL=$VITE_DEFAULT_SERVER_URL
ENV VITE_PWA_ID=$VITE_PWA_ID
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_APP_SHORT_NAME=$VITE_APP_SHORT_NAME
ENV VITE_THEME_COLOR=$VITE_THEME_COLOR
ENV VITE_START_URL=$VITE_START_URL

COPY package.json package-lock.json* tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

FROM nginx:alpine

RUN apk add --no-cache gettext

ARG VITE_BASE_PATH=/pollapp/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
