FROM golang:1.26-alpine AS build
ARG GOPROXY=https://proxy.golang.org,direct
ARG VERSION=dev
ARG COMMIT=unknown
ENV GOPROXY=${GOPROXY} CGO_ENABLED=0
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o /out/hooshban ./cmd/hooshban

# scratch: no shell, no package manager, nothing but the binary, CA roots
# and timezone data. (Distroless is equivalent but gcr.io is unreachable from Iran.)
FROM scratch
ARG VERSION=dev
LABEL org.opencontainers.image.title="hooshban-api" org.opencontainers.image.version="${VERSION}"
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /out/hooshban /hooshban
USER 65532:65532
EXPOSE 8080 9090
ENTRYPOINT ["/hooshban"]
