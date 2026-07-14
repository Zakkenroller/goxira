# Deploying katago-service to Google Cloud Run

Cloud Run runs the KataGo wrapper as a container with **no server to administer**
— no VPS, no ssh, no nginx, no certbot. TLS and a public HTTPS URL are provided
automatically. It scales to zero when idle, so at Goxira's traffic it is likely
**free** under Cloud Run's always-free tier (check current limits at
<https://cloud.google.com/run/pricing> before relying on this).

The same `Dockerfile` runs unchanged on Fly.io, Railway, Render, or any Docker
host — nothing here is Cloud-Run-specific except the `gcloud` commands, so this
is not vendor lock-in.

## What's in this directory

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the image — KataGo binary + neural net baked in (no runtime download) |
| `.dockerignore` | Keeps the build context small |
| `service.yaml` | Optional declarative config with a startup probe (see step 4b) |
| `server.js` | The wrapper (unchanged logic; now binds `0.0.0.0` in-container and exposes `/health/ready`) |
| `setup.sh` | The original VPS installer — still valid if you'd rather run a VPS |

## Prerequisites

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
# Generate the shared token the Netlify functions will send (save it):
KATAGO_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "$KATAGO_TOKEN"
```

## Step 1 — (optional) smoke-test the image locally

The KataGo binary can't be exercised in every CI sandbox, so if you have Docker
locally, verify the build once before deploying:

```sh
docker build -t katago-service katago-service/
docker run --rm -p 8080:8080 -e KATAGO_TOKEN=test katago-service &
# Wait for the model to load, then:
curl -s localhost:8080/health/ready      # → {"ready":true} (503 until loaded)
curl -s localhost:8080/move -H "Authorization: Bearer test" \
  -H 'Content-Type: application/json' \
  -d '{"sgf":"(;GM[1]SZ[9])","color":"B","boardSize":9,"rank":"15 kyu"}'
```

If `/health/ready` returns `{"ready":true}` and `/move` returns a move, the
image is good.

## Step 2 — deploy from source (simplest)

Cloud Build builds the `Dockerfile` for you; no local Docker needed.

```sh
gcloud run deploy katago-service \
  --source katago-service \
  --region us-central1 \
  --cpu 2 --memory 2Gi \
  --concurrency 8 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 2 \
  --allow-unauthenticated \
  --set-env-vars "KATAGO_TOKEN=$KATAGO_TOKEN"
```

Notes:
- `--cpu 2` matches `analysis.cfg` (tuned for 2 threads). `--memory 2Gi` is
  comfortable for the b15c192 network.
- `--allow-unauthenticated` refers to *Google IAM* — the container is still
  protected by the `KATAGO_TOKEN` bearer check in `server.js`. (Skip this flag
  and use IAM instead if you'd rather not expose it publicly, but then Netlify
  functions would need a Google identity token, which they don't have.)
- For a hardened token, use Secret Manager instead of `--set-env-vars`:
  `--set-secrets "KATAGO_TOKEN=katago-token:latest"`.

The command prints a **Service URL** like
`https://katago-service-xxxx-uc.a.run.app` — that's your `KATAGO_SERVICE_URL`.

## Step 3 — verify

```sh
URL=https://katago-service-xxxx-uc.a.run.app   # from the deploy output
curl -s "$URL/health/ready"                    # {"ready":true}
curl -s "$URL/move" -H "Authorization: Bearer $KATAGO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sgf":"(;GM[1]SZ[9])","color":"B","boardSize":9,"rank":"15 kyu"}'
```

## Step 4 — point Netlify at it

In Netlify → Site settings → Environment variables, set:
- `KATAGO_SERVICE_URL` = the Service URL from step 2
- `KATAGO_TOKEN` = the token from Prerequisites

Then trigger a redeploy (functions only pick up env changes on deploy). Confirm
on the live site via `/.netlify/functions/engine-status` and by playing a few
moves.

### 4b — cold starts (choose one)

With `--min-instances 0` the service scales to zero when idle. The first request
after an idle period waits while the container starts and the engine loads its
model. Two ways to handle that:

- **Accept it.** The in-process queue holds early requests, and if the engine
  isn't ready in ~20s the Netlify function degrades honestly (the app no longer
  500s on engine unavailability — that's the recent hardening). One user might
  see "engine warming up" once after a quiet spell.
- **Eliminate it.** Either set `--min-instances 1` (keeps one engine warm — a
  small always-on cost, no user ever waits), or deploy with `service.yaml`
  (step 4c) whose **startup probe** makes Cloud Run withhold traffic until
  `/health/ready` returns 200, so scale-to-zero keeps working but the platform,
  not the user, absorbs the cold start.

### 4c — startup probe via service.yaml (optional)

```sh
REGION=us-central1
IMG="$REGION-docker.pkg.dev/YOUR_PROJECT_ID/goxira/katago-service"
gcloud artifacts repositories create goxira --repository-format=docker --location "$REGION" 2>/dev/null || true
gcloud builds submit katago-service --tag "$IMG"
# Edit service.yaml: set the image ref to $IMG and KATAGO_TOKEN, then:
gcloud run services replace katago-service/service.yaml --region "$REGION"
gcloud run services add-iam-policy-binding katago-service --region "$REGION" \
  --member=allUsers --role=roles/run.invoker
```

## Rollback / keeping the VPS

Nothing here removes the VPS path — `setup.sh` still works, and `server.js`
still defaults to binding `127.0.0.1` (for nginx) when `BIND_HOST` is unset.
The container sets `BIND_HOST=0.0.0.0` via the Dockerfile. To revert Netlify to
a VPS, just point `KATAGO_SERVICE_URL`/`KATAGO_TOKEN` back at it and redeploy.
