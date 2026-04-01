FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production

# Копируем весь код
COPY . .

# Открываем порт
EXPOSE 3000

# Запускаем бота
CMD ["node", "index.js"]
