FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS tools

RUN apk add --no-cache git
RUN git clone https://github.com/mongodb/mongo-tools.git /src \
    && cd /src \
    && git checkout 21a342dfee6468ad9350d156d25086da64dd03b1
WORKDIR /src
RUN go get golang.org/x/crypto@v0.56.0 golang.org/x/net@v0.58.0 \
    && CGO_ENABLED=0 GOMAXPROCS=2 go build -mod=mod -p=2 -trimpath -ldflags="-s -w" -o /out/mongodump ./mongodump/main \
    && CGO_ENABLED=0 GOMAXPROCS=2 go build -mod=mod -p=2 -trimpath -ldflags="-s -w" -o /out/mongorestore ./mongorestore/main \
    && wget -q -O /tmp/js-yaml.tgz https://registry.npmjs.org/js-yaml/-/js-yaml-3.15.2.tgz \
    && echo '7f005cf0b8ee639b4557e0e321dc067c1f2aa0a442d096e03f2ab53353738794  /tmp/js-yaml.tgz' | sha256sum -c - \
    && mkdir -p /out/js-yaml \
    && tar -xz --strip-components=1 -f /tmp/js-yaml.tgz -C /out/js-yaml package/dist/js-yaml.js package/package.json \
    && rm -f /tmp/js-yaml.tgz \
    && rm -rf /go/pkg/mod /root/.cache/go-build

FROM mongo@sha256:406a4fdca9fc763443268f000218d3849ef8996f66ed9e92ba0b501b446ab822 AS runtime

COPY docker/mongo/gosu.sh /usr/local/bin/gosu
COPY docker/mongo/launchpad-entrypoint.sh /usr/local/bin/launchpad-mongo-entrypoint
COPY docker/mongo/healthcheck.sh /usr/local/bin/launchpad-mongo-healthcheck
COPY --from=tools /out/mongodump /usr/bin/mongodump
COPY --from=tools /out/mongorestore /usr/bin/mongorestore
COPY --from=tools /out/js-yaml /opt/js-yaml

RUN set -eux; \
    chmod 0755 /usr/local/bin/gosu /usr/local/bin/launchpad-mongo-entrypoint /usr/local/bin/launchpad-mongo-healthcheck /usr/bin/mongodump /usr/bin/mongorestore; \
    rm -f /usr/bin/bsondump /usr/bin/mongoexport /usr/bin/mongofiles /usr/bin/mongoimport /usr/bin/mongostat /usr/bin/mongotop; \
    ln -sf /opt/js-yaml/dist/js-yaml.js /js-yaml.js

# Flatten the hardened runtime so scanners and registries see only the files
# that are actually present, rather than deleted binaries from upstream layers.
FROM scratch
COPY --from=runtime / /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    MONGO_PACKAGE=mongodb-org \
    MONGO_REPO=repo.mongodb.org \
    MONGO_MAJOR=7.0 \
    MONGO_VERSION=7.0.40 \
    HOME=/data/db

VOLUME ["/data/configdb", "/data/db"]
EXPOSE 27017
ENTRYPOINT ["launchpad-mongo-entrypoint"]
CMD ["mongod"]
