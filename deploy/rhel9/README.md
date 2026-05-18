# RHEL 9 Zero-Network Deployment

This folder is the offline bootstrap package for a blank RHEL 9 evaluation VM.

## Required Bundle Contents

Place these files before shipping the bundle:

```text
deploy/rhel9/rpms/*.rpm
deploy/rhel9/images/ollama-image.tar
deploy/rhel9/images/backend-image.tar
deploy/rhel9/images/frontend-image.tar
backend/model/qwen2.5-3b-instruct-q4_k_m.gguf
backend/model/Modelfile
backend/model/all-MiniLM-L6-v2/
deploy/rhel9/docker-compose.offline.yml
deploy/rhel9/setup.sh
```

The RPM directory must include the full offline dependency closure for Docker Engine, not only the top-level RPMs. At minimum this includes:

```text
docker-ce
docker-ce-cli
containerd.io
docker-buildx-plugin
docker-compose-plugin
```

## Prepare On A Connected RHEL 9 Compatible Machine

Run:

```bash
bash deploy/rhel9/prepare-bundle.sh
```

That script downloads Docker RPMs, builds the backend/frontend images, pulls `ollama/ollama:latest`, and saves all images into `deploy/rhel9/images`.

## Install On The Blank RHEL 9 VM

Copy the full project bundle to the VM, then run:

```bash
sudo bash setup.sh
```

or:

```bash
sudo bash deploy/rhel9/setup.sh
```

The setup script:

1. Installs Docker Engine and Docker Compose plugin from local RPMs.
2. Enables and starts `docker.service`.
3. Creates persistent host folders:
   - `/var/lib/ai-text-editor/ollama`
   - `/var/lib/ai-text-editor/backend-data`
   - `/mnt/uploads/user_1`
4. Loads all image tarballs from `deploy/rhel9/images`.
5. Starts Ollama.
6. Creates the Ollama model `qwen2.5-3b-local` from `/models/Modelfile`, backed by the bundled GGUF.
7. Starts backend and frontend.

## Runtime Endpoints

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8000
Health:   http://localhost:8000/health
Ollama:   http://localhost:11434
```

## Notes

- No external model pull is used. Ollama receives `backend/model` as read-only `/models` and creates the local model from `Modelfile`.
- MiniLM is loaded from bundled `backend/model/all-MiniLM-L6-v2/` by the backend container.
- Uploaded files persist on the host under `/mnt/uploads/user_1`.
- Backend SQLite data persists under `/var/lib/ai-text-editor/backend-data`.
- Ollama model blobs persist under `/var/lib/ai-text-editor/ollama`.
