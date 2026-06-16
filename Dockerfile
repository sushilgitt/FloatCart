FROM node:18-alpine

ARG SHOPIFY_API_KEY
ENV SHOPIFY_API_KEY=$SHOPIFY_API_KEY
EXPOSE 8081
WORKDIR /app
COPY web .
# Install with devDeps so the Vite build works (NODE_ENV=production skips devDeps)
RUN npm install --include=dev
RUN cd frontend && npm install --include=dev && \
    cd node_modules/@shopify/app-bridge-core && \
    for dir in actions actions/Modal actions/Navigation actions/Menu actions/Link; do \
      if [ -d "$dir" ]; then \
        for item in "$dir"/*/; do \
          [ -d "$item" ] && [ ! -f "$item/index.js" ] && echo "module.exports = require('./');" > "$item/index.js"; \
        done; \
        for item in "$dir"/*.js; do true; done; \
      fi; \
    done && \
    cd /app/frontend && npm run build
ENV NODE_ENV=production
CMD ["npm", "run", "serve"]
