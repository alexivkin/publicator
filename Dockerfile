FROM node:14.4-slim

WORKDIR /publicator

COPY package.json package-lock.json /publicator/

RUN  npm install --production

COPY firebase.schema.json /publicator/superstatic/
COPY app/ /publicator/app/
COPY lib/ /publicator/lib/
COPY public/ /publicator/public/
COPY server.js /publicator/

EXPOSE 8080
EXPOSE 3474

ENTRYPOINT ["node","server.js"]
