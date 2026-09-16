# PostgreSQL 17 keeps the existing data format; build security updates off-host.
FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
# The runtime is always postgres, so the root-only privilege-switching helper
# is unused. Remove that old Go binary rather than carrying a second runtime.
RUN apk upgrade --no-cache && test -x /usr/local/bin/gosu && rm /usr/local/bin/gosu
USER postgres
