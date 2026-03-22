#!/bin/sh
set -e

# depends.cc CLI installer
# Usage: curl -fsSL https://depends.cc/install.sh | sh

REPO="legendum/depends"
CLONE_DIR="$HOME/.config/depends/src"

echo "Installing depends CLI..."

# Check for bun, install if missing
if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found — installing from https://bun.sh..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Clone or update
if [ -d "$CLONE_DIR" ]; then
  echo "Updating existing installation..."
  cd "$CLONE_DIR" && git pull --quiet
else
  echo "Downloading..."
  git clone --quiet "https://github.com/$REPO.git" "$CLONE_DIR"
fi

# Install dependencies
cd "$CLONE_DIR"
bun install --silent

# Link the CLI globally
bun link --silent

echo ""
echo "Installed to ~/.config/depends/src"
echo "CLI linked to $(bun pm bin -g)/depends"
echo ""

# Check PATH
if ! command -v depends >/dev/null 2>&1; then
  echo "Note: $(bun pm bin -g) is not on your PATH."
  echo "Add it with: export PATH=\"\$HOME/.bun/bin:\$PATH\""
  echo ""
fi

echo "Quick start:"
echo "  depends serve    # run locally (no signup needed)"
echo "  depends init     # scaffold depends.yml"
echo "  depends push     # sync to server"
echo "  depends status   # see what's green, yellow, red"
echo ""
echo "To update later: depends update"
