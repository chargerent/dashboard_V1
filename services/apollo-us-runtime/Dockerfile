FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /workspace/services/apollo-us-runtime

RUN corepack enable
COPY services/apollo-us-runtime/package.json services/apollo-us-runtime/pnpm-lock.yaml services/apollo-us-runtime/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY services/apollo-us-runtime/src ./src
COPY functions/apolloProfileTemplate.mjs /workspace/functions/apolloProfileTemplate.mjs
COPY functions/apolloScreens.mjs /workspace/functions/apolloScreens.mjs

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
