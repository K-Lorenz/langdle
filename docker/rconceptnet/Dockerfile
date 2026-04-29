# syntax=docker/dockerfile:1
FROM alpine:3.20

ARG RCN_VERSION=0.1.0

RUN apk add --no-cache ca-certificates curl tar

ARG TARGETARCH
RUN set -eux; \
	case "$TARGETARCH" in \
		amd64) ARCH=x86_64-unknown-linux-musl ;; \
		arm64) ARCH=aarch64-unknown-linux-musl ;; \
		*) ARCH=x86_64-unknown-linux-musl ;; \
	esac; \
	curl -fsSL -o /tmp/rcn.tgz \
		"https://github.com/knadh/rconceptnet/releases/download/v${RCN_VERSION}/rconceptnet_${RCN_VERSION}_${ARCH}.tar.gz"; \
	tar -xzf /tmp/rcn.tgz -C /tmp; \
	if [ -x /tmp/rconceptnet ]; then \
		install -m755 /tmp/rconceptnet /usr/local/bin/rconceptnet; \
	else \
		BIN="$(find /tmp -maxdepth 3 -type f -name rconceptnet | head -1)"; \
		install -m755 "$BIN" /usr/local/bin/rconceptnet; \
	fi; \
	rm -rf /tmp/rcn.tgz /tmp/rconceptnet; \
	test -x /usr/local/bin/rconceptnet

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data
EXPOSE 3043
ENTRYPOINT ["/entrypoint.sh"]
