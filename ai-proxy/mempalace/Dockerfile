FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir chromadb pyyaml

# Copy server
COPY mempalace_server.py .

# ChromaDB data directory
RUN mkdir -p /app/mempalace_data

ENV MEMPALACE_DIR=/app/mempalace_data
ENV MEMPALACE_PORT=8080

EXPOSE 8080

CMD ["python", "mempalace_server.py"]
