FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=https://localhost/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

ENV NODE_ENV=production
USER node
EXPOSE 3000 4000
CMD ["npm","run","start","--workspace","@waste/web"]
