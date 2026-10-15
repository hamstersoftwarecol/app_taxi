# Local deployment implementation plan

Goal: prepare reproducible local and future production containers without running infrastructure externally.

Architecture: PostgreSQL17 persists state; migration job gates six independent backend services. Compose overlays select a localhost HTTP proxy or future Caddy HTTPS. Admin builds independently. Monitoring remains an explicit profile.

- [x] Build backend Dockerfile with migrations/scripts and Node24 production runner.
- [x] Build admin Dockerfile with a Dockerfile-specific ignore file and lockfile installation.
- [x] Define base compose, local/production overlays, Caddy routes and monitoring.
- [x] Add operator-only secret generation and backup/restore scripts without argument interpolation.
- [x] Validate YAML, shell syntax and structural deployment requirements locally; do not launch Docker or external infrastructure.
- [x] Document commands, limitations, backup recovery and future activation prerequisites.
