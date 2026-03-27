FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build Next.js application
RUN npm run build

# Expose port for Next.js frontend
EXPOSE 3000

CMD ["npm", "start"]
