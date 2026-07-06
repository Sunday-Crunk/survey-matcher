FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-openpyxl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/matcher-app

COPY matcher-app/package.json matcher-app/package-lock.json ./
RUN npm ci

WORKDIR /app
COPY matcher-app ./matcher-app
COPY scripts ./scripts

WORKDIR /app/matcher-app
RUN npm run build:hosted

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PYTHON=python3

CMD ["npm", "run", "start:hosted"]
