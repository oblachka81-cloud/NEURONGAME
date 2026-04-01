FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Копируем весь код
COPY . .

# Создаём пользователя без прав (безопасность)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

# Открываем порт
EXPOSE 3000

# Запускаем бота
CMD ["node", "index.js"]
