FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS build

RUN apk add --no-cache git
RUN git clone https://github.com/minio/minio.git /src \
    && cd /src \
    && git checkout 7aac2a2c5b7c882e68c1ce017d8256be2feea27f
WORKDIR /src
RUN go get golang.org/x/crypto@v0.56.0 \
    golang.org/x/net@v0.58.0 \
    google.golang.org/grpc@v1.83.2 \
    github.com/apache/thrift@v0.24.0 \
    go.opentelemetry.io/otel/sdk@v1.44.0 \
    github.com/prometheus/prometheus@v0.311.3 \
    github.com/rabbitmq/amqp091-go@v1.13.0 \
    github.com/buger/jsonparser@v1.1.2 \
    github.com/go-jose/go-jose/v4@v4.1.4 \
    go.etcd.io/etcd/client/pkg/v3@v3.5.33 \
    && go mod tidy -e \
    && go mod download all \
    && CGO_ENABLED=0 GOMAXPROCS=2 go build -p=2 -tags kqueue -trimpath -ldflags="-s -w" -o /out/minio . \
    && rm -rf /go/pkg/mod /root/.cache/go-build

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates su-exec \
    && addgroup -g 10001 minio \
    && adduser -D -H -u 10001 -G minio minio

COPY --from=build /out/minio /usr/bin/minio
COPY docker/minio/entrypoint.sh /usr/bin/launchpad-minio-entrypoint

RUN chmod 0755 /usr/bin/minio /usr/bin/launchpad-minio-entrypoint

EXPOSE 9000 9001
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/launchpad-minio-entrypoint"]
CMD ["server", "/data", "--console-address", ":9001"]
