#!/bin/bash
# Runs after every `git commit`. If src/version.js was touched, tags and pushes the new version.

if ! git diff HEAD~1 HEAD --name-only 2>/dev/null | grep -q "src/version.js"; then
  exit 0
fi

VERSION=$(node -e "
const fs = require('fs');
const m = fs.readFileSync('src/version.js', 'utf8').match(/version:\s*[\"'](v[\d.]+)[\"']/);
process.stdout.write(m ? m[1] : '');
" 2>/dev/null)

[ -z "$VERSION" ] && exit 0

# Skip if tag already exists locally or remotely
if git tag | grep -q "^${VERSION}$"; then
  exit 0
fi

git tag "$VERSION" && git push origin "$VERSION"
echo "{\"systemMessage\": \"Git tag $VERSION created and pushed to GitHub\"}"
