#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RPM_DIR="${SCRIPT_DIR}/rpms"
IMAGE_DIR="${SCRIPT_DIR}/images"

mkdir -p "${RPM_DIR}" "${IMAGE_DIR}"

if ! command -v dnf >/dev/null 2>&1; then
  echo "This preparation script expects a RHEL9-compatible machine with dnf." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker must be installed on the connected preparation machine before saving images." >&2
  exit 1
fi

echo "Installing dnf download plugin if needed..."
sudo dnf install -y dnf-plugins-core

echo "Adding Docker CE repository on the connected preparation machine..."
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

echo "Downloading Docker Engine and Compose RPM dependency closure..."
dnf download --resolve --destdir "${RPM_DIR}" \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

echo "Pulling and saving Ollama image..."
docker pull ollama/ollama:latest
docker save ollama/ollama:latest -o "${IMAGE_DIR}/ollama-image.tar"

echo "Building and saving application images..."
cd "${PROJECT_ROOT}"
docker compose build backend frontend
docker save ai-text-editor-backend:offline -o "${IMAGE_DIR}/backend-image.tar"
docker save ai-text-editor-frontend:offline -o "${IMAGE_DIR}/frontend-image.tar"

echo "Offline bundle assets prepared under ${SCRIPT_DIR}"
echo "Copy the project tree, including deploy/rhel9/rpms, deploy/rhel9/images, backend/model/Modelfile, backend/model/qwen2.5-3b-instruct-q4_k_m.gguf, and backend/model/all-MiniLM-L6-v2, to the target VM."
