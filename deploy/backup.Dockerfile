FROM postgres:16-alpine AS rclone_legado
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt apk add --no-cache rclone

FROM alpine:3.22
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt apk add --no-cache postgresql16-client openssl bash python3 util-linux tzdata ca-certificates \
    && for cmd in pg_dump psql createdb dropdb pg_isready; do ln -s "/usr/libexec/postgresql16/$cmd" "/usr/local/bin/$cmd"; done
COPY --from=rclone_legado /usr/bin/rclone /usr/bin/rclone
ENV PATH="/usr/libexec/postgresql16:${PATH}"
COPY backup.sh backup-estudio.py backup-manifesto.py backup-conferencia.py /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh && chmod 0644 /usr/local/bin/backup-*.py
ENTRYPOINT ["backup.sh"]
CMD ["loop"]
