FROM alpine:3.22
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
RUN apk add --no-cache postgresql16-client rclone openssl bash python3 util-linux tzdata ca-certificates
ENV PATH="/usr/libexec/postgresql16:${PATH}"
COPY backup.sh backup-estudio.py /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh && chmod 0644 /usr/local/bin/backup-estudio.py
ENTRYPOINT ["backup.sh"]
CMD ["loop"]
