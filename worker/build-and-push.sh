#!/usr/bin/env bash
# Build the Dress Nation digitization worker image and push it to a registry.
#
# RunPod GPUs are x86_64, so this always builds for linux/amd64 — on an Apple
# Silicon Mac that runs under emulation (slower, but correct). The GitHub
# Actions workflow (.github/workflows/worker-image.yml) does the same build
# natively; use this script only when you want to push to your own registry
# (Docker Hub, a private registry) instead of GHCR.
#
# Prereqs:
#   - docker with buildx (ships with Docker Desktop)
#   - you are already logged in:  docker login <registry-host>
#       GHCR:       echo "$GHCR_PAT" | docker login ghcr.io -u <user> --password-stdin
#       Docker Hub: docker login
#
# Usage:
#   REGISTRY=ghcr.io/<your-user-or-org>   ./build-and-push.sh          # tag :latest
#   REGISTRY=docker.io/<your-user> TAG=v1 ./build-and-push.sh
set -euo pipefail

REGISTRY="${REGISTRY:?set REGISTRY, e.g. ghcr.io/yourname or docker.io/yourname}"
IMAGE="${IMAGE:-dressnation-worker}"
TAG="${TAG:-latest}"
REF="${REGISTRY%/}/${IMAGE}:${TAG}"

cd "$(dirname "$0")"

echo "Building and pushing ${REF} (linux/amd64)…"
docker buildx build --platform linux/amd64 -t "${REF}" --push .

echo
echo "Done. Point your RunPod Serverless endpoint's image at:"
echo "    ${REF}"
echo "(If using GHCR, make the package public or give RunPod a read:packages token so it can pull.)"
