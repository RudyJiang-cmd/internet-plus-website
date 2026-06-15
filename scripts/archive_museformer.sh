#!/usr/bin/env bash
set -euo pipefail

DESTINATION="${1:-}"
SSH_KEY="${2:-$PWD/TRAE.pem}"
REMOTE_HOST="${MUSEFORMER_HOST:-101.32.72.146}"
REMOTE_USER="${MUSEFORMER_USER:-ubuntu}"
MIN_FREE_KB=$((150 * 1024 * 1024))

if [[ -z "$DESTINATION" ]]; then
  echo "Usage: $0 /Volumes/EncryptedDisk/Lingyan-Cloud-Exit [/path/to/TRAE.pem]" >&2
  exit 2
fi

if [[ "$DESTINATION" != /Volumes/* ]]; then
  echo "Destination must be on a mounted external volume under /Volumes." >&2
  exit 2
fi

VOLUME_ROOT="/Volumes/$(cut -d/ -f3 <<<"$DESTINATION")"
if [[ ! -d "$VOLUME_ROOT" ]]; then
  echo "External volume is not mounted: $VOLUME_ROOT" >&2
  exit 2
fi

if [[ "${ALLOW_UNENCRYPTED:-0}" != "1" ]] && ! diskutil info "$VOLUME_ROOT" | grep -Eq 'FileVault:[[:space:]]+Yes|Encrypted:[[:space:]]+Yes'; then
  echo "Refusing to archive server secrets to an unencrypted volume." >&2
  echo "Use an encrypted APFS volume, or set ALLOW_UNENCRYPTED=1 only after accepting the risk." >&2
  exit 2
fi

FREE_KB="$(df -Pk "$VOLUME_ROOT" | awk 'NR == 2 {print $4}')"
if (( FREE_KB < MIN_FREE_KB )); then
  echo "At least 150 GiB free space is required; only $((FREE_KB / 1024 / 1024)) GiB is available." >&2
  exit 2
fi

if [[ ! -r "$SSH_KEY" ]]; then
  echo "SSH key is not readable: $SSH_KEY" >&2
  exit 2
fi

ARCHIVE_DIR="$DESTINATION/museformer-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ARCHIVE_DIR/manifests"
chmod 700 "$ARCHIVE_DIR"

SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST")

"${SSH[@]}" 'hostname; date -Is; uname -a; df -h; free -h' > "$ARCHIVE_DIR/manifests/system.txt"
"${SSH[@]}" 'nvidia-smi || true; nvcc --version || true' > "$ARCHIVE_DIR/manifests/nvidia.txt" 2>&1
"${SSH[@]}" 'python3 --version; python3 -m pip freeze || true' > "$ARCHIVE_DIR/manifests/python.txt" 2>&1
"${SSH[@]}" 'dpkg-query -W -f="${binary:Package}\t${Version}\n"' > "$ARCHIVE_DIR/manifests/packages.tsv"
"${SSH[@]}" 'sudo systemctl cat museformer-api.service; sudo systemctl status museformer-api.service --no-pager || true' > "$ARCHIVE_DIR/manifests/museformer-api.service.txt" 2>&1
"${SSH[@]}" 'sudo find /home/ubuntu/muzic -xdev -printf "%y\t%s\t%TY-%Tm-%TdT%TH:%TM:%TS\t%p\n" | sort -k4' > "$ARCHIVE_DIR/manifests/muzic-files.tsv"
"${SSH[@]}" 'sudo du -xhd2 / /home/ubuntu /home/ubuntu/muzic 2>/dev/null | sort -h' > "$ARCHIVE_DIR/manifests/disk-usage.txt"

"${SSH[@]}" "sudo tar --acls --xattrs --numeric-owner --one-file-system \
  --exclude=/dev --exclude=/proc --exclude=/sys --exclude=/run --exclude=/tmp \
  --exclude=/mnt --exclude=/media --exclude=/lost+found -cpf - /" \
  | zstd -T0 -10 -o "$ARCHIVE_DIR/museformer-rootfs.tar.zst"

zstd -t "$ARCHIVE_DIR/museformer-rootfs.tar.zst"
(
  cd "$ARCHIVE_DIR"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)

echo "Museformer archive verified: $ARCHIVE_DIR"
