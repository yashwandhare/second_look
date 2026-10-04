# Second Look
#
#   make run      start the app and open it in your browser
#   make install  create the virtual environment and install dependencies
#   make test     run the test suite
#   make check    confirm the app imports and integrations are configured
#   make pitch    open the pitch document

.PHONY: run install test check pitch

PORT ?= 8000
HOST ?= 127.0.0.1

run:
	@HOST=$(HOST) PORT=$(PORT) ./run.sh

install:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r backend/requirements.txt
	@echo ""
	@echo "  Now run:  cp .env.example .env  and fill in the keys"

test:
	.venv/bin/python -m pytest backend/tests -q

check:
	@.venv/bin/python -c "
	import os, sys
	sys.path.insert(0, '.')
	from backend.main import app
	from backend.services import firestore
	gem = 'set' if os.getenv('GEMINI_API_KEY', '').strip() else 'MISSING'
	print(f'  app imports ok')
	print(f'  gemini    : {gem}')
	print(f'  firestore : {'set' if firestore.is_configured() else 'MISSING'}')
	"

pitch:
	@xdg-open PITCH.md >/dev/null 2>&1 || open PITCH.md >/dev/null 2>&1 || echo "  Open PITCH.md"
