# Official Playwright image: Chromium + all system libraries preinstalled.
# Tag MUST match the "playwright" version in package.json (1.49.1).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Install dependencies first (better layer caching). Browsers already ship in
# the base image, so skip the browser download during install.
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --ignore-scripts

COPY . .

ENV NODE_ENV=production
ENV HEADLESS=true

# The host (Render/Fly) injects PORT; the app reads process.env.PORT.
EXPOSE 3000
CMD ["npm", "start"]
