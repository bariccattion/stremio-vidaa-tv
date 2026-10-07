# Self-host the VIDAA Stremio build (README "Method 3").
# Builds the site from upstream/ + patches/, then serves it on port 8000.
FROM node:22-alpine

WORKDIR /site

COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY . .
RUN node scripts/build.mjs

EXPOSE 8000
CMD ["npx", "serve", "app", "-l", "8000", "--no-clipboard"]
