FROM node:22-alpine

WORKDIR /app

# Copy entire monorepo
COPY . .

# Build client
WORKDIR /app/client
RUN npm install --include=dev
RUN npm run build

# Install server dependencies
WORKDIR /app/server
RUN npm install

# Set working directory to server for runtime
WORKDIR /app/server

EXPOSE 3000

CMD ["npm", "start"]
