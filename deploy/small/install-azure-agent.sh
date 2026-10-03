#!/usr/bin/env bash
# Installs an Azure Pipelines agent on this server as a systemd service, so
# the Deploy stage of azure-pipelines.yml runs here (like the Samantel setup).
#
#   AZP_URL=https://dev.azure.com/<org> AZP_TOKEN=<PAT with Agent Pools (read & manage)> \
#     [AZP_POOL=hooshban-server] bash install-azure-agent.sh
#
# The PAT is used once for registration and is not stored by this script.
set -euo pipefail
: "${AZP_URL:?set AZP_URL}"; : "${AZP_TOKEN:?set AZP_TOKEN}"
POOL="${AZP_POOL:-hooshban-server}"
DIR="$HOME/azagent-hooshban"
VERSION="${AZP_AGENT_VERSION:-4.255.0}"

mkdir -p "$DIR" && cd "$DIR"
if [ ! -f config.sh ]; then
  curl -fsSL --retry 5 "https://download.agent.dev.azure.com/agent/$VERSION/vsts-agent-linux-x64-$VERSION.tar.gz" | tar xz
fi
./config.sh --unattended --acceptTeeEula \
  --url "$AZP_URL" --auth pat --token "$AZP_TOKEN" \
  --pool "$POOL" --agent "$(hostname)-hooshban" --replace --work _work
sudo ./svc.sh install "$USER"
sudo ./svc.sh start
echo "Agent registered in pool '$POOL' and running as a service."
