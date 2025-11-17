###############################################################################
# Stage 1: Builder
###############################################################################
FROM node:22-slim AS builder

WORKDIR /usr/src/microsoft-rewards-script

ENV PLAYWRIGHT_BROWSERS_PATH=0

# Copy package files
COPY package.json package-lock.json tsconfig.json ./

# Install all dependencies
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

# Remove build dependencies
RUN rm -rf node_modules \
    && npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# Install Chromium browsers
RUN npx playwright install --with-deps chromium \
    && rm -rf /root/.cache /tmp/* /var/tmp/*

###############################################################################
# Stage 2: Runtime
###############################################################################
FROM node:22-slim AS runtime

WORKDIR /usr/src/microsoft-rewards-script

# Set production environment variables
ENV NODE_ENV=production \
    TZ=UTC \
    PLAYWRIGHT_BROWSERS_PATH=0

# Install minimal system libraries and cron
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    cron \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libgconf-2-4 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Copy compiled application and dependencies
COPY --from=builder /usr/src/microsoft-rewards-script/dist ./dist
COPY --from=builder /usr/src/microsoft-rewards-script/package*.json ./
COPY --from=builder /usr/src/microsoft-rewards-script/node_modules ./node_modules

# Copy scripts and config files
COPY --chmod=755 src/run_daily.sh ./src/run_daily.sh
COPY --chmod=644 src/crontab.template /etc/cron.d/microsoft-rewards-cron.template
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
COPY src/accounts.json ./src/accounts.json

# Create log directory
RUN mkdir -p /var/log

# Entrypoint handles TZ and launch
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
