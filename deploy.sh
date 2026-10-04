#!/usr/bin/env bash
# Deploy this project to Antideploy and wait for the result.
#
# Usage:  ./deploy.sh [project-dir]
#
# The account token lives in ~/.antideploy/config.json and is never printed.

set -euo pipefail

PROJECT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
API="https://antideploy.com/api/v1"
CONFIG="$HOME/.antideploy/config.json"

# Public name for this project. Changing it later changes the live URL.
APP_NAME="${ANTIDEPLOY_NAME:-yash-promptwars}"

if [[ ! -f "$CONFIG" ]]; then
  echo "No Antideploy token found at $CONFIG" >&2
  echo "Run the device flow once, then retry." >&2
  exit 1
fi

TOKEN="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['token'])" "$CONFIG")"
if [[ -z "$TOKEN" ]]; then
  echo "Token missing from $CONFIG" >&2
  exit 1
fi

# Reuse the application id recorded in .antideploy.json, or create it once.
META="$PROJECT_DIR/.antideploy.json"
if [[ -f "$META" ]]; then
  APP_ID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['applicationId'])" "$META")"
  echo "Using application $APP_ID"
else
  echo "Checking availability of $APP_NAME ..."
  AVAILABLE="$(curl -sS "$API/hostnames/check?label=$APP_NAME" -H "authorization: Bearer $TOKEN" |
    python3 -c "import json,sys;print(json.load(sys.stdin).get('available'))")"
  if [[ "$AVAILABLE" != "True" ]]; then
    echo "Subdomain '$APP_NAME' is not available. Set ANTIDEPLOY_NAME to another value." >&2
    exit 1
  fi

  echo "Creating Antideploy application: $APP_NAME"
  RESPONSE="$(curl -sS -X POST "$API/applications" \
    -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"$APP_NAME\",\"subdomain\":\"$APP_NAME\"}")"

  APP_ID="$(printf '%s' "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'applicationId' in data:
    print(data['applicationId'])
elif data.get('error') == 'name_taken':
    print(data['applicationId'])
else:
    raise SystemExit('create failed: ' + json.dumps(data))
")"

  printf '{"applicationId":"%s","name":"%s"}\n' "$APP_ID" "$APP_NAME" >"$META"
  echo "Saved $META"
fi

echo "Uploading $PROJECT_DIR ..."
UPLOAD="$(tar czf - \
  --exclude=.git \
  --exclude=.venv \
  --exclude='.venv.old.*' \
  --exclude=node_modules \
  --exclude=__pycache__ \
  --exclude='*.pyc' \
  --exclude='*.db' \
  -C "$PROJECT_DIR" . |
  curl -sS -X POST "$API/deploy?applicationId=$APP_ID" \
    -H "authorization: Bearer $TOKEN" \
    -F "archive=@-")"

TASK_ID="$(printf '%s' "$UPLOAD" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data.get('status') == 'unchanged':
    print('unchanged')
elif 'taskId' in data:
    print(data['taskId'])
else:
    raise SystemExit('deploy rejected: ' + json.dumps(data))
")"

if [[ "$TASK_ID" == "unchanged" ]]; then
  echo "Nothing changed since the last deploy."
  exit 0
fi

echo "Watching deployment $TASK_ID ..."
while true; do
  sleep 5
  STATUS="$(curl -sS "$API/deployments/$TASK_ID" -H "authorization: Bearer $TOKEN")"
  STATE="$(printf '%s' "$STATUS" | python3 -c "import json,sys;print(json.load(sys.stdin).get('status','unknown'))")"
  echo "  status: $STATE"

  case "$STATE" in
  succeeded)
    printf '%s' "$STATUS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print()
print(data.get('summary', 'Deployed.'))
security = data.get('security') or {}
issues = security.get('issues') or []
if issues:
    print()
    print('Security findings:')
    for issue in issues:
        print('  -', issue.get('title') or issue)
"
    break
    ;;
  failed)
    printf '%s' "$STATUS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print()
print('FAILED:', data.get('error', 'no error message'))
print('step:', data.get('failedStep'))
build = (data.get('deployment') or {}).get('buildLog') or ''
runtime = (data.get('deployment') or {}).get('runtimeLog') or ''
if build:
    print()
    print('--- build log (tail) ---')
    print(build[-1500:])
if runtime:
    print()
    print('--- runtime log (tail) ---')
    print(runtime[-1500:])
" >&2
    exit 1
    ;;
  esac
done
