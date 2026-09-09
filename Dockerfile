# ---------- 构建阶段 ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# 本平台运行时无环境变量注入机制，机密信息随镜像层私有分发（构建上下文不会公开）。
# 若迁移到自有基础设施，请删除以下 COPY，改用 --env-file、环境变量或编排平台 Secret 注入，
# 同时在 .dockerignore 中启用对 .env / .agent-gw.json 的排除。
COPY .env ./
COPY .agent-gw.json /root/.kimi/agent-gw.json
COPY .agent-gw.json ./
EXPOSE 3000
CMD ["node", "dist/boot.js"]
