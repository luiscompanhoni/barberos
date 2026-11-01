# Container de backup: pg_dump/psql do Postgres 16 + rclone (copia fora do servidor) + openssl (criptografia).
FROM postgres:16-alpine
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
RUN --mount=type=secret,id=build_ca,target=/etc/ssl/certs/ca-certificates.crt \
    apk add --no-cache rclone openssl bash python3 util-linux
COPY backup.sh backup-estudio.py /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh && chmod 0644 /usr/local/bin/backup-estudio.py
ENTRYPOINT ["backup.sh"]
CMD ["loop"]
