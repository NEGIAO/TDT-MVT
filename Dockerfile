# 使用超轻量级 Alpine Node 官方镜像 (镜像体积 < 150MB)
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 设置时区为上海
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

# 拷贝项目文件
COPY package.json ./
COPY mvt_codec.mjs ./
COPY server.mjs ./
COPY style_generator.mjs ./
COPY build_browser_codec.mjs ./
COPY static/ ./static/

# 创建持久化缓存目录
RUN mkdir -p /app/cache

# 暴露服务端口
EXPOSE 8890

# 环境变量默认值
ENV PORT=8890
ENV NODE_ENV=production

# 启动服务
CMD ["node", "server.mjs"]
