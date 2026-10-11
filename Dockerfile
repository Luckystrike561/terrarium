# syntax=docker/dockerfile:1

# dist/ is plain JavaScript and assets, identical on every platform, so it is built once on the builder's own
# platform instead of under emulation for each target.
FROM --platform=$BUILDPLATFORM node:22.23.3-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY webview-ui/package.json webview-ui/
RUN npm ci
COPY . .
RUN npm run package

FROM node:22.23.3-trixie-slim AS runtime
# The server resolves the herdr socket and its state directory from $HOME. Pinning it keeps those paths at
# the documented mount points when `--user` runs the container as a UID that has no passwd entry.
ENV HOME=/home/node
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY webview-ui/package.json webview-ui/
# The webview's dependencies are already bundled into dist/webview, so only the server's are installed.
# The root `prepare` script runs husky, a dev dependency this install leaves out.
RUN npm ci --omit=dev --ignore-scripts --workspace=server --include-workspace-root && npm cache clean --force
COPY --from=build /app/dist ./dist
# A named volume mounted here starts with this ownership, so the server can write to it as `node`. The base
# image's home is 0700, which would lock a `--user` UID out of the mounts below it.
RUN chmod 0755 /home/node && install -d -o node -g node /home/node/.terrarium
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8790/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--provider", "herdr,omp", "--host", "0.0.0.0", "--port", "8790"]
