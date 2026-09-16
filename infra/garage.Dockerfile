# The upstream static binary is unchanged; Alpine supplies the provisioning shell.
FROM dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020 AS upstream
FROM alpine:3.24
RUN apk upgrade --no-cache \
  && addgroup -g 10001 garage && adduser -D -H -u 10001 -G garage garage \
  && mkdir /data /metadata && chown garage:garage /data /metadata \
  && chmod 0700 /data /metadata
COPY --from=upstream /garage /garage
COPY infra/garage.toml /etc/garage.toml
COPY --chmod=0555 infra/garage-entrypoint.sh /usr/local/bin/garage-entrypoint
USER 10001:10001
ENV RUST_LOG=warn
HEALTHCHECK --interval=90s --timeout=5s --start-period=40s --retries=3 \
  CMD test -f /tmp/garage-ready && /garage status >/dev/null 2>&1
ENTRYPOINT ["/usr/local/bin/garage-entrypoint"]
