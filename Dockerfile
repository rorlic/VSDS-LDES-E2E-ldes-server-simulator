# build environment
FROM node:22-bullseye-slim AS builder
# fix vulnerabilities
ARG NPM_TAG=10.8.2
RUN npm install -g npm@${NPM_TAG}
# build it
WORKDIR /build
COPY . .
RUN npm ci
RUN npm run build

# run environment
FROM node:22.5.0-bullseye-slim
# fix vulnerabilities
# note: trivy insists this to be on the same RUN line
RUN apt-get -y update && apt-get -y upgrade
RUN apt-get -y install apt-utils
WORKDIR /usr/vsds/simulator
# fix vulnerabilities
ARG NPM_TAG=10.8.2
RUN npm install -g npm@${NPM_TAG}
## setup to run as less-privileged user
COPY --chown=node:node --from=builder /build/package*.json ./
COPY --chown=node:node --from=builder /build/dist ./
ENV NODE_ENV=production
RUN npm ci --omit=dev
## install signal-handler wrapper
RUN apt-get -y install dumb-init
## install curl (for checking health)
RUN apt-get -y install curl
## allow passing variables
ARG SEED=
ENV SEED=${SEED}
ARG BASEURL=http://localhost
ENV BASEURL=${BASEURL}
ARG MAXBODYSIZE=
ENV MAXBODYSIZE=${MAXBODYSIZE}
## set start command
EXPOSE 80
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
USER node
CMD ["sh", "-c", "node server.js --maxBodySize=${MAXBODYSIZE} --seed=${SEED} --baseUrl=${BASEURL} --host=0.0.0.0 --port=80"]
