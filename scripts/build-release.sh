#!/usr/bin/env bash
set -euo pipefail

archive="release/essential-seo-toolkit-5.0.0.zip"
release_files=()
mkdir -p release
rm -f "$archive"
while IFS= read -r file; do
  if [ -n "$file" ]; then
    release_files+=("$file")
  fi
done < scripts/release-files.txt
zip -X -q "$archive" "${release_files[@]}"
echo "Built $archive with ${#release_files[@]} production files."
