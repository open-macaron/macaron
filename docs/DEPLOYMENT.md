# macaron-bot — supply chain and VPS deployment

Everything here is public: the repo, the images, and the unit files. So no secret ever lives in git or in GitHub. The VPS pulls its deployment from the public repo, and GitHub never gets SSH or any other credential to the VPS.

```
 PR ──▶ ci.yml (gates) ──▶ main ──▶ release.yml ──▶ ghcr.io/open-macaron/controller@sha256:…
                                       ├ build (UBI 10, non-root, digest-pinned base)
                                       ├ SBOM (syft) + Trivy scan (fail on fixable HIGH/CRITICAL)
                                       └ attest: build provenance (SLSA) + SBOM → Sigstore, pushed to GHCR
 Renovate PR "deploy: controller → sha256:…" ── merge to main
                                                    │  (public repo, no credentials needed)
 Fedora VPS, user `macaron` (rootless, lingering)   ▼
   macaron-deploy.timer (5 min) ──▶ deploy.sh
     ├ git fetch origin main  (fast-forward only)
     ├ for every Image= digest: verify provenance (release.yml on main) ── refuse otherwise
     ├ install deploy/quadlets → ~/.config/containers/systemd/ ; daemon-reload
     └ pg_dump, restart changed units (the controller migrates at startup); health gate, else roll back
   macaron.pod   :80/:443 published, nothing else
     ├ caddy        TLS (ACME), routes /webhook and /bootstrap only → controller:8080
     ├ controller   :8080 app, :9090 health + metrics (pod-local)
     └ postgres     127.0.0.1:5432 (pod-local, never published)
```

## 0. The VPS (checked over `ssh open-macaron-vps` on 2026-10-15)

| Item | Found | Action |
|---|---|---|
| Provider / OS | OVH VPS (Canada), Fedora 44 Cloud, kernel 7.1, KVM. Supported until 2027-05 | Plan the upgrade to Fedora 45 before then |
| Size | 2 vCPU, 3.7 GiB RAM, 40 GB disk (3 % used) | Fits; controller 768 MiB, Postgres ~512 MiB, Caddy ~64 MiB |
| Network | 51.222.37.43, 2607:5300:205:200::db3c (IPv4 + IPv6) | DNS `A` + `AAAA` for the controller hostname |
| Podman / SELinux | Podman 5.8.4, SELinux enforcing | As designed |
| SSH | Port 50485, root key-only. **Password auth is ON**: `50-cloud-init.conf` sets `PasswordAuthentication yes`, and the drop-in wins over `sshd_config`. User `fedora` has a password and passwordless sudo | ✅ **Fixed 2026-10-15:** drop-in `00-macaron.conf` sets `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers fedora`. Verified: key login works, password login refused. `bootstrap-host.sh` must keep this file |
| Firewall | **None**: firewalld not installed, nftables ruleset empty | Install firewalld: inbound ssh (50485), http, https only |
| Exposed services | `systemd-resolved` LLMNR on 0.0.0.0:5355 / [::]:5355 | `LLMNR=no` in resolved.conf |
| Updates | No automatic updates | `dnf5-plugin-automatic`, security only, weekly reboot window |
| Brute force | No failed logins yet (non-standard port) | fail2ban on sshd anyway |
| Service user | Only `fedora` exists; no `macaron` user, no linger; `ip_unprivileged_port_start=1024` | Created by `bootstrap-host.sh` (§3) |

## 1. Image build (`release.yml`, `Containerfile`)

- **Two-stage Containerfile.** It builds on `registry.access.redhat.com/ubi10/nodejs-24` and runs on `ubi10/nodejs-24-minimal`. Both images are pinned by digest, and Renovate bumps them.
- **What the build does:** `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm deploy --prod` into `/opt/app`. The runtime image only gets that folder.
- **Runtime image:**
  - `USER 1001`;
  - no package manager or compiler at runtime;
  - a tiny `healthcheck` entrypoint for `HealthCmd`;
  - `NODE_ENV=production`, plus `--enable-source-maps` for readable stack traces.
- **Reproducibility:** `SOURCE_DATE_EPOCH` comes from the commit, and labels follow OCI conventions (`org.opencontainers.image.source`, `revision`, `version`).
- **Workflow permissions:** top level `permissions: {}`. Only the release job gets `contents: read`, `packages: write`, `id-token: write` and `attestations: write`.
- **Attestations:**
  - `actions/attest-build-provenance` with `push-to-registry: true` gives SLSA v1 provenance, signed by Sigstore through GitHub OIDC with no long-lived key.
  - `actions/attest-sbom` attaches the syft SPDX SBOM.
  - The `agent-cli` tarball used by `run.yml` is attested the same way.
- **Verification on the VPS:** the signer identity must be `https://github.com/open-macaron/macaron/.github/workflows/release.yml@refs/heads/main`, with issuer `token.actions.githubusercontent.com`. The check needs no GitHub credential; the tool choice is open, see §6.

## 2. Quadlets (`deploy/quadlets/`)

```
deploy/
├── quadlets/
│   ├── macaron.pod                    PublishPort 80, 443 — nothing else leaves the pod
│   ├── macaron-caddy.container        Caddyfile from deploy/caddy/, certs in macaron-caddy.volume
│   ├── macaron-postgres.container     quay.io/fedora/postgresql-17@sha256:…, data in macaron-pgdata.volume
│   ├── macaron-controller.container   Requires/After postgres; migrates at startup
│   ├── macaron-pgdata.volume
│   └── macaron-caddy.volume
├── caddy/Caddyfile                    host, HSTS, path allow-list, request size limit
├── systemd/macaron-deploy.{service,timer}
└── scripts/deploy.sh, scripts/bootstrap-host.sh
```

Every container gets the same hardening. The controller unit is the reference:

```ini
[Unit]
Requires=macaron-postgres.service
After=macaron-postgres.service

[Container]
Image=ghcr.io/open-macaron/controller@sha256:…        # digest only; Renovate bumps it
Pod=macaron.pod
ReadOnly=true
ReadOnlyTmpfs=true
DropCapability=ALL
NoNewPrivileges=true
SecurityLabelType=container_t                         # SELinux enforcing on the host
Secret=macaron-gh-interact,type=env,target=GH_INTERACT
Secret=macaron-gh-push,type=env,target=GH_PUSH
Secret=macaron-gh-org,type=env,target=GH_ORG
Secret=macaron-or-provisioning,type=env,target=OPENROUTER_PROVISIONING_KEY
Secret=macaron-or-router,type=env,target=OPENROUTER_ROUTER_KEY
Secret=macaron-webhook-hmac,type=env,target=WEBHOOK_HMAC
Secret=macaron-signing-key,target=/run/secrets/signing_key,mode=0400
Secret=macaron-database-url,type=env,target=DATABASE_URL
EnvironmentFile=%h/.config/macaron/controller.env     # non-secret config, incl. MACARON_ENABLED
HealthCmd=/opt/app/bin/healthcheck
HealthStartPeriod=30s
Notify=healthy                                        # systemd waits until the app is healthy
LogDriver=journald

[Service]
Restart=on-failure
MemoryMax=768M
CPUQuota=150%

[Install]
WantedBy=default.target
```

- **Single node.** A restart causes a few seconds of downtime and no lost work: triggers and pg-boss jobs are rows in Postgres, the notifications poller resumes from its stored cursor, and the scheduled `reconcile` job recovers `workflow_run` webhooks that arrived while it was down.
- **Migrations** run when the controller starts, before it serves anything: Drizzle's migrator inside the database module's factory, under a Postgres advisory lock so two instances never migrate at once. pg-boss migrates its own `pgboss` schema the same way. Migrations must only add or widen columns, so a rollback to the previous digest keeps working. A destructive change ships in two releases.
- **Rollback:** `deploy.sh` keeps the last good commit. If the controller isn't healthy within 2 minutes, it re-installs that commit's quadlets and restarts.

## 3. Host (`deploy/scripts/bootstrap-host.sh`, run once as root)

| Area | Setting |
|---|---|
| OS | Fedora Server (current release), `dnf5-automatic` installing security updates, reboot window weekly |
| Access | SSH keys only, no root login, no password auth; `fail2ban` on sshd |
| Firewall | `firewalld`: only `ssh`, `http`, `https` inbound |
| Egress | nftables: traffic from uid `macaron` is limited to TCP 443 + DNS. Rootless containers egress as that user via pasta, so this covers them |
| SELinux | Enforcing; volumes mounted with `:Z` |
| User | `macaron`, no sudo, `loginctl enable-linger`; `net.ipv4.ip_unprivileged_port_start=80` so rootless Caddy can bind 80/443 |
| Podman | Fedora's Podman 5.x; `podman-auto-update` *not* used (we deploy by digest via `deploy.sh`) |
| Disk | Full-disk encryption if the provider allows it, because Podman's file secret driver stores values on disk readable by `macaron` |

## 4. Secrets (created once over SSH, never in git)

| Podman secret | Content | Rotation |
|---|---|---|
| `macaron-gh-interact`, `macaron-gh-push`, `macaron-gh-org` | PATs of macaron-bot, scopes in REPOSITORIES.md §3 | ≤ 90 days; the controller exports the `github-authentication-token-expiration` header as a metric |
| `macaron-or-provisioning`, `macaron-or-router` | OpenRouter keys | 90 days |
| `macaron-webhook-hmac` | shared with the `open-macaron/runner` webhook (+ any upstream admin who installs our webhook) | yearly |
| `macaron-signing-key` | SSH commit-signing key (public key registered on macaron-bot) | yearly |
| `macaron-database-url`, `macaron-pg-password` | generated by `bootstrap-host.sh` | on demand |

Create each secret with `printf %s "$VALUE" | podman secret create --replace <name> -` as user `macaron`; `docs/runbooks/secrets.md` covers rotation. The values never go through a shell history, a file in the repo, or GitHub.

## 5. Operations

- **Logs:** journald (`journalctl --user -u macaron-controller`), as JSON lines from pino with secrets redacted.
- **Metrics:** `:9090/metrics` stays inside the pod. Without a Prometheus, the controller pushes its own alerts (channel open, see §6) for:
  - spend in the last hour above a threshold;
  - open keys older than 1 h;
  - event lag p95 above 3 min;
  - poller failing for 5 min, or `X-Poll-Interval` above 300 s for 15 min (GitHub under load; expect slower reactions);
  - a token expiring in less than 14 days.

  It also pings a dead-man's switch every minute, so silence is an alert too.
- **Backups:** the VPS provider backs up the whole machine automatically. Those snapshots are crash-consistent, which Postgres recovers from on start through its WAL. In addition, `deploy.sh` takes a local `pg_dump` before running any migration, so a bad migration can be undone without restoring the whole VPS.
- **Kill switch:** set `MACARON_ENABLED=false` in `controller.env` and restart. The controller stops ingesting, revokes every open key, and cancels running workflows. `systemctl --user stop macaron-pod` is the hard stop; open keys still expire through the sweeper on the next start.

## 6. Open points

1. **VPS:** which provider and size? 2 vCPU / 4 GB is enough. Does it offer disk encryption and snapshots?
2. **Domain:** a hostname for Caddy/ACME, for example `macaron.<domain>`, and for the webhook URLs.
3. **Alert channel:** e-mail, Matrix or Slack webhook, ntfy? And a dead-man's switch service (healthchecks.io or self-hosted).
4. **Signature check at pull time:** Podman's `policy.json` (`sigstoreSigned` + Fulcio) matches signers by email, while GitHub attestations use a workflow-URI identity. Until we confirm Podman can check them, `deploy.sh` verifies before installing. We also need to pick the verifier: `cosign verify-attestation` against the identity in §1, or `gh attestation verify` with a read-only token.
