#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RPM_DIR="${SCRIPT_DIR}/rpms"
IMAGE_DIR="${SCRIPT_DIR}/images"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.offline.yml"
MODEL_FILE="${PROJECT_ROOT}/backend/model/qwen2.5-3b-instruct-q4_k_m.gguf"
MODELFILE="${PROJECT_ROOT}/backend/model/Modelfile"
MINILM_DIR="${PROJECT_ROOT}/backend/model/all-MiniLM-L6-v2"
MODEL_NAME="qwen2.5-3b-local"
DOCKER_BIN="${DOCKER_BIN:-docker}"

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This setup must run as root: sudo bash deploy/rhel9/setup.sh" >&2
    exit 1
  fi
}

require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "Missing required file: ${path}" >&2
    exit 1
  fi
}

need_root

if [[ ! -d "${RPM_DIR}" ]] || ! compgen -G "${RPM_DIR}/*.rpm" >/dev/null; then
  echo "Missing Docker RPMs in ${RPM_DIR}" >&2
  echo "Expected docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin, and docker-compose-plugin RPMs." >&2
  exit 1
fi

if [[ ! -d "${IMAGE_DIR}" ]] || ! compgen -G "${IMAGE_DIR}/*.tar" >/dev/null; then
  echo "Missing pre-saved Docker image tarballs in ${IMAGE_DIR}" >&2
  exit 1
fi

require_file "${MODEL_FILE}"
require_file "${MODELFILE}"
require_file "${COMPOSE_FILE}"
if [[ ! -d "${MINILM_DIR}" ]]; then
  echo "Missing required MiniLM model directory: ${MINILM_DIR}" >&2
  exit 1
fi

echo "Installing Docker Engine and Compose plugin from local RPMs..."
dnf install -y "${RPM_DIR}"/*.rpm

echo "Enabling Docker service..."
systemctl enable --now docker

if ! command -v docker-compose >/dev/null 2>&1; then
  cat >/usr/local/bin/docker-compose <<'EOF'
#!/usr/bin/env bash
exec docker compose "$@"
EOF
  chmod 0755 /usr/local/bin/docker-compose
fi

echo "Creating persistent host folders..."
mkdir -p /var/lib/ai-text-editor/ollama
mkdir -p /var/lib/ai-text-editor/backend-data
mkdir -p /mnt/uploads/user_1
chmod 0755 /mnt/uploads
chmod 0755 /mnt/uploads/user_1

echo "Loading pre-saved Docker images..."
for image_tar in "${IMAGE_DIR}"/*.tar; do
  echo "Loading ${image_tar}"
  "${DOCKER_BIN}" load -i "${image_tar}"
done

export AI_EDITOR_PROJECT_ROOT="${PROJECT_ROOT}"

echo "Starting Ollama..."
"${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" up -d ollama

echo "Waiting for Ollama to accept commands..."
for attempt in {1..60}; do
  if "${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" exec -T ollama ollama list >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 60 ]]; then
    echo "Ollama did not become ready in time. Check: docker compose -f ${COMPOSE_FILE} logs ollama" >&2
    exit 1
  fi
  sleep 2
done

echo "Creating sideloaded Ollama model ${MODEL_NAME} from /models/Modelfile..."
"${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" exec -T ollama ollama create "${MODEL_NAME}" -f /models/Modelfile

echo "Starting backend and frontend..."
"${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" up -d backend frontend

echo "Deployment complete."
echo "Frontend: http://localhost:5173"
echo "Backend health: http://localhost:8000/health"
