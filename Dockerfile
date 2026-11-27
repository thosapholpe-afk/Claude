# Thosaphol Connect — one container serves the web app and the API.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
ENV PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
