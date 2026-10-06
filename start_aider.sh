#!/bin/bash
# Start aider for /home/dad/wwwhotel/hoteldemosite (hotel site + admin CMS) with the local Ollama models, tuned for this machine
# (AMD RX 6800 16 GB VRAM, 15 GB RAM). Extra arguments are passed through to aider, e.g.
#   ./start_aider.sh                                  # normal
#   ./start_aider.sh --model ollama_chat/gemma4:e4b          # smaller/faster architect
#   ./start_aider.sh --model ollama_chat/qwen2.5-coder:14b   # stronger coder SOLO @24k (no architect; 14b+7b don't fit together)
#   ./start_aider.sh --no-wait                               # launch even if another app holds the GPU
#   GPU_WAIT_MAX=600 ./start_aider.sh                        # wait at most 10 min for the GPU (default 30)
#
# What it does: activates the venv, checks Ollama/models/.env, WAITS for the GPU to be free if
# something else (ComfyUI, LM Studio, another model) is using it, pre-loads BOTH models into
# VRAM (editor first, then architect, so they stay resident together), runs aider, and
# unloads the models on exit so the GPU is free for other apps.
set -uo pipefail

PROJECT=/home/dad/wwwhotel/hoteldemosite
VENV=/home/dad/ai-stacks/stacks/venvLM
OLLAMA=http://127.0.0.1:11434
ARCHITECT=ollama_chat/gemma4:12b
EDITOR_MODEL=ollama_chat/qwen2.5-coder:7b-instruct
# must match num_ctx in ~/.aider.model.settings.yml (a different num_ctx forces a reload)
ARCHITECT_CTX=24576
EDITOR_CTX=16384
KEEP_ALIVE=30m

# allow --model X on the command line to change which architect gets pre-warmed
for ((i=1; i<=$#; i++)); do
  if [ "${!i}" = "--model" ]; then j=$((i+1)); ARCHITECT="${!j}"; fi
done
SOLO=0
case "$ARCHITECT" in *qwen2.5-coder:14b) SOLO=1; ARCHITECT_CTX=24576 ;; esac   # must match ./.aider.model.settings.yml
A_NAME=${ARCHITECT#*/}; E_NAME=${EDITOR_MODEL#*/}   # strip the ollama_chat/ prefix

say()  { printf '\033[1;34m[start_aider]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start_aider] WARNING:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[start_aider] ERROR:\033[0m %s\n' "$*"; exit 1; }

cd "$PROJECT" || die "cannot cd to $PROJECT"
[ -f "$VENV/bin/activate" ] || die "venv not found at $VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
export OLLAMA_API_BASE="$OLLAMA"

# ---- sanity checks ---------------------------------------------------------------------
python3 -c "import aider, dotenv, requests" 2>/dev/null || die "venv python3 is missing aider/dotenv/requests (run: pip install -U aider-chat python-dotenv requests)"
[ -f .env ] || printf 'OLLAMA_API_BASE=%s\n' "$OLLAMA" > .env   # aider reads OLLAMA_API_BASE from here
command -v node >/dev/null 2>&1 || die "node is not on PATH (needed for lint-cmd / scripts/aider-test.sh)"
curl -sf --max-time 5 "$OLLAMA/api/version" >/dev/null || die "Ollama is not reachable at $OLLAMA (sudo systemctl start ollama)"
for m in "$A_NAME" "$E_NAME"; do
  ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m" || die "model $m is not pulled (ollama pull $m)"
done
if [ "$SOLO" = 1 ]; then
  say "solo mode: $A_NAME @ $ARCHITECT_CTX ctx, no editor model (measured: 14b + 7b do not fit in 16 GB together)"
  set -- -c "$PROJECT/.aider.solo.conf.yml" "$@"   # aider 0.86 has no --no-architect; a config without architect: true is the way
fi
if [ -f .git/index.lock ]; then
  warn ".git/index.lock exists (stale lock from an interrupted git run). Removing it."
  rm -f .git/index.lock
fi
# ---- wait for the GPU to be free ---------------------------------------------------------
# Both aider models need ~14.9 GB of the 16 GB together. If something else (ComfyUI, LM Studio,
# another Ollama model) holds VRAM, wait for it to finish instead of launching into a swap-fest.
# Env knobs: GPU_WAIT_MAX=seconds (default 1800 = 30 min, 0 = don't wait), GPU_FREE_THRESHOLD_MIB
# (default 2200: anything above this is "someone else is using the GPU"). Pass --no-wait to skip.
GPU_WAIT_MAX=${GPU_WAIT_MAX:-1800}
GPU_FREE_THRESHOLD_MIB=${GPU_FREE_THRESHOLD_MIB:-2200}
_args=()
for a in "$@"; do if [ "$a" = "--no-wait" ]; then GPU_WAIT_MAX=0; else _args+=("$a"); fi; done
set -- "${_args[@]+"${_args[@]}"}"   # aider does not know --no-wait; drop it before passing args on

vram_used_mib() {  # prints MiB of VRAM in use, or nothing if it cannot be measured
  local used
  used=$(rocm-smi --showmeminfo vram 2>/dev/null | grep "Used" | grep -oE "[0-9]+$")
  [ -n "$used" ] && echo $((used/1048576))
}
gpu_users() {  # best-effort list of who holds the GPU: ollama models + other processes
  local m
  m=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | tr '\n' ' ')
  [ -n "$m" ] && printf 'ollama:[%s] ' "$m"
  rocm-smi --showpids 2>/dev/null | awk '/^[0-9]+/{print $2}' | sort -u | tr '\n' ' '
}
if command -v rocm-smi >/dev/null 2>&1; then
  used=$(vram_used_mib)
  if [ -n "$used" ] && [ "$used" -gt "$GPU_FREE_THRESHOLD_MIB" ]; then
    # our own models from a previous session do not count as "someone else"
    others=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | grep -v -e "^$A_NAME$" -e "^$E_NAME$" | tr '\n' ' ')
    pids=$(rocm-smi --showpids 2>/dev/null | awk '/^[0-9]+/{print $2}' | grep -v -e '^ollama' | sort -u | tr '\n' ' ')
    if [ -n "$others$pids" ] || [ "$used" -gt 15500 ]; then
      waited=0
      warn "GPU busy: ${used} MiB VRAM in use by $(gpu_users)"
      if [ "$GPU_WAIT_MAX" -gt 0 ]; then
        say "waiting up to $((GPU_WAIT_MAX/60)) min for it to be released (Ctrl-C to abort, --no-wait to skip) ..."
        while [ "$waited" -lt "$GPU_WAIT_MAX" ]; do
          sleep 15; waited=$((waited+15))
          used=$(vram_used_mib)
          [ -z "$used" ] && break
          if [ "$used" -le "$GPU_FREE_THRESHOLD_MIB" ]; then say "GPU is free (${used} MiB in use) after ${waited}s"; break; fi
          others=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | grep -v -e "^$A_NAME$" -e "^$E_NAME$" | tr '\n' ' ')
          pids=$(rocm-smi --showpids 2>/dev/null | awk '/^[0-9]+/{print $2}' | grep -v -e '^ollama' | sort -u | tr '\n' ' ')
          if [ -z "$others$pids" ] && [ "$used" -le 15500 ]; then say "only our own models remain on the GPU; continuing"; break; fi
          [ $((waited % 60)) -eq 0 ] && say "still waiting: ${used} MiB in use by $(gpu_users)"
        done
        [ "$waited" -ge "$GPU_WAIT_MAX" ] && warn "gave up waiting after $((GPU_WAIT_MAX/60)) min; launching anyway — expect Ollama to swap models (slower)."
      else
        warn "not waiting (--no-wait / GPU_WAIT_MAX=0); expect Ollama to swap models (slower) until that is freed."
      fi
    fi
  fi
fi

# ---- pre-warm both models so the first turn is fast and they stay resident -------------
load() { # model ctx
  curl -s --max-time 180 "$OLLAMA/api/generate" \
    -d "{\"model\":\"$1\",\"options\":{\"num_ctx\":$2},\"keep_alive\":\"$KEEP_ALIVE\"}" >/dev/null
}
if [ "$SOLO" = 1 ]; then
  say "loading $A_NAME (num_ctx $ARCHITECT_CTX) ..."; load "$A_NAME" "$ARCHITECT_CTX"
else
  say "loading editor    $E_NAME (num_ctx $EDITOR_CTX) ..."; load "$E_NAME" "$EDITOR_CTX"
  say "loading architect $A_NAME (num_ctx $ARCHITECT_CTX) ..."; load "$A_NAME" "$ARCHITECT_CTX"
  resident=$(ollama ps 2>/dev/null | awk 'NR>1{print $1}' | tr '\n' ' ')
  case "$resident" in
    *"$A_NAME"*"$E_NAME"*|*"$E_NAME"*"$A_NAME"*) say "both models resident on the GPU: $resident" ;;
    *) warn "only [$resident] is loaded; Ollama will reload models between architect and editor turns." ;;
  esac
fi

cleanup() {
  say "unloading models to free VRAM ..."
  curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$A_NAME\",\"keep_alive\":0}" >/dev/null
  curl -s --max-time 30 "$OLLAMA/api/generate" -d "{\"model\":\"$E_NAME\",\"keep_alive\":0}" >/dev/null
}
trap cleanup EXIT

# ---- run aider (models, edit formats and context limits come from ~/.aider.* files) ----
say "starting aider in $PROJECT"
aider "$@"
