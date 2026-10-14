# Container de backup: pg_dump/psql do Postgres 16 + rclone (copia fora do servidor) + openssl (criptografia).
FROM postgres:16-alpine
RUN apk add --no-cache rclone openssl bash
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["backup.sh"]
CMD ["loop"]
