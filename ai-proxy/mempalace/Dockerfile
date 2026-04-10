FROM python:3.12-slim

WORKDIR /app

# Install dependencies (sentence-transformers for Chinese embedding model)
RUN pip install --no-cache-dir chromadb sentence-transformers

# Pre-download bge-small-zh-v1.5 model at build time (avoids cold-start delay)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-zh-v1.5')"

# Copy server
COPY mempalace_server.py .

# ChromaDB data directory
RUN mkdir -p /app/mempalace_data

ENV MEMPALACE_DIR=/app/mempalace_data
ENV MEMPALACE_PORT=8080

EXPOSE 8080

CMD ["python", "mempalace_server.py"]
