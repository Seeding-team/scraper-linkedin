# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/messenger-bridge . \
 && go build -trimpath -ldflags="-s -w" -o /out/poc ./cmd/poc

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -H -u 10001 bridge \
 && mkdir /data && chown bridge:bridge /data && chmod 700 /data
COPY --from=build /out/ /usr/local/bin/
USER bridge
ENV BRIDGE_LISTEN=:8090 BRIDGE_DATA_DIR=/data
VOLUME /data
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/health || exit 1
ENTRYPOINT ["messenger-bridge"]
