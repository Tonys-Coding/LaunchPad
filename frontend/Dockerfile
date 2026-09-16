FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /app
COPY package.json yarn.lock ./
COPY . ./
RUN corepack enable \
    && yarn install --frozen-lockfile \
    && yarn build \
    && rm -rf node_modules /usr/local/share/.cache/yarn /root/.cache

FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS caddy-build

RUN apk add --no-cache git
RUN git clone https://github.com/caddyserver/caddy.git /src \
    && cd /src \
    && git checkout e2eee6a7fce366321294c9c2a79f3146891dcbdf
WORKDIR /src
RUN go get golang.org/x/crypto@v0.56.0 \
    golang.org/x/net@v0.58.0 \
    google.golang.org/grpc@v1.83.2 \
    && go mod tidy \
    && CGO_ENABLED=0 GOMAXPROCS=2 go build -p=2 -trimpath -ldflags="-s -w" -o /usr/bin/caddy ./cmd/caddy \
    && rm -rf /go/pkg/mod /root/.cache/go-build

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40 AS certificates
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates

FROM scratch

ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY --from=certificates /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /app/build /srv

EXPOSE 80 443

ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
