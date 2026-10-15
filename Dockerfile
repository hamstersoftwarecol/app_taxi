FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production RAYO_MODE=production SERVICE_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --workspaces=false && npm cache clean --force
COPY services ./services
COPY packages ./packages
COPY migrations ./migrations
COPY scripts ./scripts
USER node
CMD ["node", "services/production/run.mjs"]
