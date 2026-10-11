FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# ffmpeg is required by yt-dlp for audio extraction and format merging. yt-dlp
# itself is installed with the production npm dependencies below.
RUN apt-get update \
  && apt-get install --no-install-recommends -y ffmpeg python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist

EXPOSE 8787
CMD ["npm", "start"]
