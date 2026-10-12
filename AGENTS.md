# Repository Guidelines

## Project Structure & Module Organization

Tengyu Title Studio generates ecommerce titles and Excel exports.

- `backend/tengyu/`: FastAPI, desktop bridge, tasks, providers, SQLite, and files. Title rules: `resources/title_skill.md`.
- `frontend/src/`: React/TypeScript components, API client, and styles; static assets live in `frontend/public/`.
- `tests/`: backend tests and shared fixtures. `frontend/tests/`: Playwright interaction tests.
- `packaging/` and `scripts/`: Windows packaging configuration and build script. `docs/`: screenshots and validation records.

## Build, Test, and Development Commands

Use Python 3.12, uv, and Node.js 24. Run Python commands from the repository root and npm commands from `frontend/`.

- `uv sync --frozen --python 3.12`: install locked Python dependencies.
- `npm ci`: install locked frontend dependencies.
- `npm run build`: type-check TypeScript and build frontend assets; run before launching the app or UI tests.
- `uv run --no-sync tengyu-title-web`: start the local browser backend; open its printed authenticated URL.
- `uv run --no-sync tengyu-title`: launch the Windows desktop window.
- `npm run dev`: start Vite with the backend running; append the backend URL's `#token=...` on first connection.
- `uv run --no-sync ruff check backend tests`: lint Python.
- `uv run --no-sync pytest -q`: run backend tests.
- `npm run test:ui`: run Playwright; install Chromium with `npx playwright install chromium` if needed.

Build installers with `./scripts/build-windows.ps1` on Windows with Inno Setup 6. See `docs/VALIDATION.md` for acceptance scope.

## Coding Style & Naming Conventions

Follow existing formatting: four-space Python indentation, two-space TypeScript indentation, and PascalCase React component filenames. Use snake_case Python functions and camelCase TypeScript functions; preserve snake_case API fields. Python targets Ruff's configured 110-character line length. TypeScript uses strict checking; no frontend formatter or linter is configured. Keep user-facing text Chinese.

## Testing Guidelines

Use pytest, pytest-asyncio, and respx for backend tests named `test_*.py`; name Playwright files `*.spec.ts`. Mock provider calls and isolate filesystem/database state with temporary directories. Add regression coverage for changed behavior. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History contains one `feat:` commit; follow its concise, imperative style using prefixes like `fix:` or `docs:`. PRs should explain changes, link relevant issues, report checks, and include UI screenshots when applicable. Distinguish installer builds from Windows GUI acceptance.

## Security & Configuration

Keep API keys in the system credential store and local test data under `TENGYU_DATA_DIR`. Exclude real product images, databases, and credentials from commits. Preserve loopback-only serving, session authentication, and explicit user-triggered retries for billable model requests.
