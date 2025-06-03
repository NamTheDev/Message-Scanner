FROM node:latest

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN  git pulld

CMD ["npm", "start"]