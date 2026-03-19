#!/usr/bin/env bash
# generate-repo-export.sh — regenerate repo-export.txt from all tracked git files
# Run manually before committing, or automatically via Netlify build command.

set -euo pipefail

OUTPUT="repo-export.txt"
DIVIDER="========================================"

> "$OUTPUT"

git ls-files | sort | while IFS= read -r file; do
  # Skip the output file itself
  [ "$file" = "$OUTPUT" ] && continue

  # Skip binary files
  if file -b --mime-encoding "$file" 2>/dev/null | grep -q "binary"; then
    continue
  fi

  printf '%s\nFILE: ./%s\n%s\n' "$DIVIDER" "$file" "$DIVIDER" >> "$OUTPUT"
  cat "$file" >> "$OUTPUT"
  printf '\n' >> "$OUTPUT"
done

echo "repo-export.txt updated ($(wc -l < "$OUTPUT") lines, $(git ls-files | grep -v "^$OUTPUT$" | wc -l) files)"
