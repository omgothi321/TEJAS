#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  TEJAS — Installer for Kali Linux / Debian-based systems
#  Run: chmod +x install.sh && ./install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ████████╗███████╗     ██╗ █████╗ ███████╗"
echo "     ██╔══╝██╔════╝     ██║██╔══██╗██╔════╝"
echo "     ██║   █████╗       ██║███████║███████╗"
echo "     ██║   ██╔══╝  ██   ██║██╔══██║╚════██║"
echo "     ██║   ███████╗╚█████╔╝██║  ██║███████║"
echo "     ╚═╝   ╚══════╝ ╚════╝ ╚═╝  ╚═╝╚══════╝"
echo -e "${NC}"
echo -e "${GRAY}  Jarvis.OS — AI + Robotics Operating System${NC}"
echo -e "${GRAY}  Installer for Kali Linux${NC}"
echo ""

# ── Check Node.js ──────────────────────────────────────────────────────────
echo -e "${CYAN}[1/5]${NC} Checking Node.js..."

if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}  Node.js not found. Installing...${NC}"
  
  # Install via NodeSource (Node 20 LTS)
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo -e "${GREEN}  ✓ Node.js installed${NC}"
else
  NODE_VERSION=$(node --version)
  echo -e "${GREEN}  ✓ Node.js found: ${NODE_VERSION}${NC}"
  
  # Check version is >= 18
  NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED}  ✗ Node.js 18+ required. Current: ${NODE_VERSION}${NC}"
    echo -e "${YELLOW}  Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs${NC}"
    exit 1
  fi
fi

# ── Check npm ──────────────────────────────────────────────────────────────
echo -e "${CYAN}[2/5]${NC} Checking npm..."
if ! command -v npm &> /dev/null; then
  echo -e "${RED}  ✗ npm not found${NC}"
  exit 1
fi
NPM_VERSION=$(npm --version)
echo -e "${GREEN}  ✓ npm found: ${NPM_VERSION}${NC}"

# ── Install dependencies ───────────────────────────────────────────────────
echo -e "${CYAN}[3/5]${NC} Installing dependencies..."
npm install --silent
echo -e "${GREEN}  ✓ Dependencies installed${NC}"

# ── Make executable ────────────────────────────────────────────────────────
echo -e "${CYAN}[4/5]${NC} Setting permissions..."
chmod +x bin/tejas.js
echo -e "${GREEN}  ✓ Permissions set${NC}"

# ── Link globally ──────────────────────────────────────────────────────────
echo -e "${CYAN}[5/5]${NC} Linking tejas globally..."
npm link --silent 2>/dev/null || sudo npm link --silent

echo -e "${GREEN}  ✓ tejas linked globally${NC}"

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ✓ Tejas installed successfully!${NC}"
echo ""
echo -e "${GRAY}  Quick start:${NC}"
echo -e "${GRAY}  ${NC}${CYAN}mkdir my-project && cd my-project${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas init${NC}${GRAY}                    — initialize${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas run "setup git"${NC}${GRAY}           — run first task${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas status${NC}${GRAY}                   — view system${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas agent --list${NC}${GRAY}             — view agents${NC}"
echo ""
echo -e "${GRAY}  Set your API key (pick your model):${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas config --set api_keys.claude=sk-ant-xxx${NC}"
echo -e "${GRAY}  ${NC}${CYAN}tejas config --set api_keys.deepseek=sk-xxx${NC}"
echo ""
echo -e "${YELLOW}  Tejas. One command at a time.${NC}"
echo ""
