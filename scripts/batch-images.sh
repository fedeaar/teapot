#!/usr/bin/env bash
# Group image files in a directory into subfolders of N (default 50), sorted by name.
# Usage: ./scripts/batch-images.sh <folder> [batch_size]
set -euo pipefail

DIR="${1:-}"
SIZE="${2:-50}"

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "Usage: $0 <folder> [batch_size]" >&2
  exit 1
fi

cd "$DIR"

shopt -s nullglob nocaseglob
files=( *.jpg *.jpeg *.png *.webp *.heic *.heif )
shopt -u nocaseglob

if (( ${#files[@]} == 0 )); then
  echo "No image files found in $DIR" >&2
  exit 0
fi

IFS=$'\n' sorted=( $(printf '%s\n' "${files[@]}" | LC_ALL=C sort) )
unset IFS

i=0
for f in "${sorted[@]}"; do
  batch=$(( i / SIZE + 1 ))
  mkdir -p "batch_$batch"
  mv -- "$f" "batch_$batch/"
  i=$(( i + 1 ))
done

echo "Moved $i files into $(( (i + SIZE - 1) / SIZE )) batch folders of up to $SIZE."
