FROM debian:bookworm-slim AS audio-teste
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && espeak-ng -v pt-br -s 135 -w /teste.wav "Olá, gostaria de saber os horários da barbearia para amanhã."

FROM python:3.12-slim
ARG VCS_REF=""
LABEL org.opencontainers.image.revision=$VCS_REF
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ASR_MODELO=/modelo ASR_THREADS=1 HF_HUB_OFFLINE=1
WORKDIR /worker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Modelo público fixado; áudios de clientes nunca passam pelo download/build.
RUN HF_HUB_OFFLINE=0 python -c "from faster_whisper.utils import download_model; download_model('base', output_dir='/modelo', revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66')"
COPY servidor.py test_servidor.py smoke.py ./
COPY --from=audio-teste /teste.wav ./teste.wav
RUN python -m unittest test_servidor.py && python smoke.py teste.wav
RUN useradd --uid 10001 --no-create-home worker && chown -R worker:worker /worker /modelo
USER worker
EXPOSE 8091
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/saude',timeout=3)"
CMD ["uvicorn", "servidor:app", "--host", "0.0.0.0", "--port", "8091", "--no-access-log"]
