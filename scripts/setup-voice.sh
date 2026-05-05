#!/bin/bash
# ─── TEJAS VOICE SETUP ────────────────────────────────────────────────────────
# Downloads the best free male voice for Tejas
# Run once: bash scripts/setup-voice.sh

set -e

PIPER_DIR="$HOME/.local/share/piper"
mkdir -p "$PIPER_DIR"

echo ""
echo "  ◈ TEJAS Voice Setup"
echo "  ─────────────────────"
echo ""

# Check piper installed
if ! command -v piper &> /dev/null; then
  echo "  Installing piper-tts..."
  pip3 install piper-tts --break-system-packages
fi

echo "  Selecting best male voice..."
echo ""

# Voice options — all free, all male, all high quality
echo "  Available voices:"
echo "  1. Ryan (en_US)    — Deep, professional, clear    [RECOMMENDED]"
echo "  2. Alan (en_GB)    — British accent, authoritative"
echo "  3. Arctic (en_US)  — Clear, neutral American"
echo ""

read -p "  Choose voice (1/2/3) [default: 1]: " choice
choice=${choice:-1}

BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

case $choice in
  2)
    NAME="en_GB-alan-medium"
    URL="$BASE_URL/en/en_GB/alan/medium"
    ;;
  3)
    NAME="en_US-arctic-medium"
    URL="$BASE_URL/en/en_US/arctic/medium"
    ;;
  *)
    NAME="en_US-ryan-high"
    URL="$BASE_URL/en/en_US/ryan/high"
    ;;
esac

echo ""
echo "  Downloading $NAME..."
echo "  (one time, ~60MB)"
echo ""

wget -q --show-progress -O "$PIPER_DIR/$NAME.onnx" "$URL/$NAME.onnx"
wget -q -O "$PIPER_DIR/$NAME.onnx.json" "$URL/$NAME.onnx.json"

echo ""
echo "  Testing voice..."
echo "  Tejas online. Voice systems active." | piper \
  --model "$PIPER_DIR/$NAME.onnx" \
  --output_raw 2>/dev/null | aplay -r 22050 -f S16_LE -t raw - 2>/dev/null

echo ""
echo "  ✓ Voice setup complete!"
echo "  Model: $PIPER_DIR/$NAME.onnx"
echo ""
echo "  Test with:"
echo "  tejas voice --speak \"Systems online. Ready.\""
echo ""
