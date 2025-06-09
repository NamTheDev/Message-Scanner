FROM node:latest

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN  git pull

CMD ["npm", "start"]