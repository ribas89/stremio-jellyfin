FROM node:22-alpine
WORKDIR /app
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=1000:1000 index.js LICENSE ./
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 scripts ./scripts
COPY --chown=1000:1000 public ./public
RUN mkdir -p /app/config && chown -R 1000:1000 /app && chmod 755 /app /app/config && chmod 644 /app/index.js && chmod -R u+rwX,go+rX /app/src /app/scripts /app/public
ENV NODE_ENV=production CONFIG_PATH=/app/config/config.json
EXPOSE 7000
USER 1000:1000
CMD ["node", "index.js"]
