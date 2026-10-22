# Bot WhatsApp do ResconFi para o Fly.io
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 AUTH_DIR=/data/auth_info TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
EXPOSE 3000
CMD ["node", "index.js"]
