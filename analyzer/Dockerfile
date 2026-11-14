# Essentia publishes Linux wheels for x86_64 only; DigitalOcean droplets are x86_64.
FROM --platform=linux/amd64 python:3.14-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY analysis.py app.py ./

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
USER nobody
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
