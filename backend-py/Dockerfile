# The Routify API (FastAPI + Prisma) as one container: the API and the route-optimisation worker, like Render's
# startCommand. Used on the Oracle server next to OSRM/VROOM (infra/routing/oracle/docker-compose.yml, service "api").
#
#   docker build -t routify-api backend-py
#
# Migrations run when the container starts (they only ever add to the schema), so a new image updates the database
# before it serves requests.
FROM python:3.12-slim

# openssl: Prisma picks its engine build by the OpenSSL version. ca-certificates: HTTPS to Neon, Google, Brevo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Prisma's engines and Node (for the Prisma CLI that runs migrations) stay inside the image.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PRISMA_BINARY_CACHE_DIR=/app/.prisma-cache/binaries \
    PRISMA_NODEENV_CACHE_DIR=/app/.prisma-cache/nodeenv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY prisma ./prisma
RUN prisma generate && prisma --version >/dev/null

COPY app ./app
COPY scripts ./scripts
COPY docker-start.sh ./
RUN python -m scripts.bundle_prisma_engine && chmod +x docker-start.sh && mkdir -p /app/uploads

EXPOSE 4000
CMD ["./docker-start.sh"]
