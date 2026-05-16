# Deploy

## Purpose
Owns reproducible deployment assets and operational runbooks.

## Offline deployment flow
1. Build release artifacts in a connected environment.
2. Export artifacts and dependencies to an offline bundle (for example: container images, wheel/npm caches, and configuration manifests).
3. Transfer the bundle to the target offline environment using approved media.
4. Verify checksums/signatures before install.
5. Load artifacts (image load/package install), apply configuration, and start services.
6. Run smoke checks and capture deployment logs for audit.
