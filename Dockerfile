# How this server is built for a directory that runs it in a container.
#
# Checked in rather than left to be inferred: the repository root also holds
# packaging/manifest.json, whose entry point describes the layout inside a
# packed bundle rather than inside this tree, and a build guessing from that
# starts a path that does not exist here.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

CMD ["node", "dist/index.js"]
