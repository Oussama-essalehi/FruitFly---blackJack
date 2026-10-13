# FlyJack's shared fly: server/server.js plays one fly forever and serves the page.
# The fly's memory lives in /var/data: mount a persistent disk there, or every deploy starts a new fly.
FROM node:22-alpine
WORKDIR /app
COPY src ./src
COPY data/circuit.json ./data/
COPY web/index.html ./web/
COPY server/server.js ./server/
ENV DATA_DIR=/var/data PORT=8080
EXPOSE 8080
CMD ["node", "server/server.js"]
