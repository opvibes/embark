# GitHub Secrets

Documentation for environment variables (secrets) required for each deploy type in Embark.

> **Where to configure:** GitHub → Settings → Secrets and variables → Actions

---

## Google Cloud Run (GCP)

The GCP flow is **Dockerfile → workflow → Cloud Run deploy**. The service is
served at its generated Cloud Run URL; Embark does not configure a custom domain
for GCP, so there is no subdomain and no DNS secret to set.

| Secret | Description | Example |
|--------|-------------|---------|
| `GCP_PROJECT_ID` | Google Cloud project ID | `my-project-123456` |
| `GCP_SA_KEY` | Service Account JSON with deploy permissions | `{"type": "service_account", ...}` |
| `GCP_REGION` | Cloud Run region | `us-central1` |

---

## Netlify

### Basic Deploy (without custom domain)

| Secret | Description | Where to find |
|--------|-------------|----------------|
| `NETLIFY_TOKEN` | Personal Access Token | Netlify → User Settings → Applications → Personal access tokens |
| `DOMAIN` | Base domain | e.g. `embark.dev` |

#### NETLIFY_TOKEN Permissions
The token is created with full account access. There's no granular permissions.

### Deploy with Custom Domain (Cloudflare DNS)

Add the secrets above **+** those from the [Cloudflare DNS Manager](#cloudflare-dns-manager) section.

---

## Cloudflare Pages

Static site deployment directly to Cloudflare Pages with automatic DNS configuration.

| Secret | Description | Where to find |
|--------|-------------|----------------|
| `CF_TOKEN_PAGES` | API Token with Pages + DNS permissions | Cloudflare → My Profile → API Tokens |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | Cloudflare Dashboard → Overview (right side) |
| `CF_ZONE_ID` | Domain Zone ID | Cloudflare → Your domain → Overview (right side) |
| `DOMAIN` | Base domain | e.g. `embark.dev` |

> **Note:** The project name is automatically derived from your domain. For example, if `DOMAIN=openvibes.tech` and subdomain is `myapp`, the project will be `blpsoares-myapp`.

### CF_TOKEN_PAGES Permissions

When creating the token in **My Profile → API Tokens → Create Token → Create Custom Token**:

| Scope | Resource | Permission |
|-------|----------|------------|
| Account | Cloudflare Pages | **Edit** |
| Zone | DNS | **Edit** |

**Account Resources:** Include → Your account
**Zone Resources:** Include → Specific zone → Your domain (or All zones)

---

## Cloudflare Workers

Serverless backend deployment to Cloudflare Workers.

| Secret | Description | Where to find |
|--------|-------------|----------------|
| `CF_WORKER_TOKEN` | API Token with Workers + DNS permissions | Cloudflare → My Profile → API Tokens |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | Cloudflare Dashboard → Overview (right side) |
| `CF_ZONE_ID` | Domain Zone ID (only if custom domain) | Cloudflare → Your domain → Overview (right side) |
| `DOMAIN` | Base domain (only if custom domain) | e.g. `embark.dev` |

### CF_WORKER_TOKEN Permissions

When creating the token in **My Profile → API Tokens → Create Token → Create Custom Token**:

#### Basic Deploy (without custom domain)

| Scope | Resource | Permission |
|-------|----------|------------|
| Account | Worker Scripts | **Edit** |

#### Deploy with Custom Domain

| Scope | Resource | Permission |
|-------|----------|------------|
| Account | Worker Scripts | **Edit** |
| Account | Account Settings | **Read** |
| Zone | DNS | **Edit** |
| Zone | Workers Routes | **Edit** |

**Account Resources:** Include → Your account
**Zone Resources:** Include → Specific zone → Your domain (or All zones)

> **Note:** If you only give Workers Scripts (Edit) permission, the Worker will deploy fine but the custom domain setup in the DNS job will fail with "Authentication error".

---

## Cloudflare DNS Manager

Used to configure custom subdomains for Netlify deploys.

| Secret | Description | Where to find |
|--------|-------------|----------------|
| `CF_TOKEN` | API Token with DNS permission | Cloudflare → My Profile → API Tokens |
| `CF_ZONE_ID` | Domain Zone ID | Cloudflare → Your domain → Overview (right side) |
| `DOMAIN` | Base domain | e.g. `embark.dev` |

### CF_TOKEN Permissions

When creating the token in **My Profile → API Tokens → Create Token → Create Custom Token**:

| Scope | Resource | Permission |
|-------|----------|------------|
| Zone | DNS | **Edit** |

**Zone Resources:** Include → Specific zone → Your domain (or All zones)

---

## Token for private submodules

Embark's `bun run new-package` can wire a package as a **Git submodule** instead of
scaffolding it locally (`git submodule add <url> packages/<name>`). If that URL points
to a **private repository, or any repository inside an organization**, plain `git`
has no credentials for it and the command fails — and GitHub returns the *same*
"not found" response both for a repo that truly doesn't exist and for one you simply
aren't authenticated for, so the failure looks like a typo even when it isn't.

There are **two separate tokens** here, for two separate machines — don't conflate them:

| | Runs on | Needed for |
|---|---|---|
| **Case A** | your laptop | `bun run new-package` locally running `git submodule add` |
| **Case B** | GitHub Actions | the deploy workflow checking out the private submodule in CI |

> **Verification note:** the steps below were checked against GitHub's own docs
> (docs.github.com) while writing this section. GitHub's UI wording and menu layout
> do change over time — if a label below doesn't match what you see, search
> [GitHub Docs](https://docs.github.com) for "fine-grained personal access token" /
> "Actions secrets" rather than assuming the old path still applies, and please fix
> this doc.

### Case A — local `git submodule add` (your machine)

Use a **fine-grained Personal Access Token** scoped to just the submodule repo(s).

1. github.com → your profile photo (top right) → **Settings**.
2. Left sidebar, scroll to the bottom → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. **Resource owner**: pick the organization the submodule repo lives in (not your
   personal account) — this field controls whose repos you can select next.
5. **Repository access** → **Only select repositories** → pick the submodule repo(s).
6. **Permissions** → **Repository permissions** → set **Contents** to **Read-only**
   (**Read and write** only if this token also needs to push to that repo).
7. Generate the token and copy it immediately — GitHub only shows it once.

**Org approval step (often required — this is the part people miss):** fine-grained
tokens that request access to an organization's repos require an organization owner
to approve them **by default**. If your token doesn't work right away, it's likely
sitting in a pending queue:

- *You (token requester):* the token creation page shows it as pending; GitHub also
  emails organization owners daily about tokens awaiting approval.
- *Org owner (approves it):* profile photo → **Organizations** → select the org →
  **Settings** → left sidebar, under **Personal access tokens** → **Pending requests**
  → open the token → **Approve** (or **Deny**).
- An org can turn this requirement off (org **Settings** → **Personal access tokens**
  → **Settings** → **Fine-grained tokens** tab → **Require approval of fine-grained
  personal access tokens**), but it's on unless someone has explicitly disabled it.

Once the token is active, export it:

```bash
export GITHUB_TOKEN=<the token you just generated>
```

This alone is only enough if `git` actually reads that variable. Plain `git` does
**not** automatically use `GITHUB_TOKEN` for HTTPS auth — it relies on whatever
credential helper is configured:

- **If you use the `gh` CLI and have run `gh auth setup-git`** (common if you already
  use `gh` for PRs in this repo — see the root `CLAUDE.md`), you're covered: `gh`'s
  credential helper checks `GH_TOKEN`/`GITHUB_TOKEN` before its stored login, so the
  export above is picked up automatically.
- **Otherwise**, configure a credential helper directly (e.g.
  `git config --global credential.helper store`, then authenticate once), or embed
  the token in the URL as a one-off: `https://<token>@github.com/org/repo.git`.

### Case B — CI / GitHub Actions checking out the submodule

The generated workflow's `Checkout` step (`actions/checkout@v4`, `submodules: recursive`)
uses the job's default `secrets.GITHUB_TOKEN` unless told otherwise — and that
auto-issued token **cannot** read a *different* private repo in the same org, which is
exactly what a submodule is. You need a **repository or organization Actions secret**
holding a token with access to the submodule repo:

| Secret | Description | Where to configure |
|--------|-------------|---------------------|
| A token of your choosing (e.g. `SUBMODULE_TOKEN`) — **not** `GITHUB_TOKEN`: GitHub rejects any secret name starting with `GITHUB_` as reserved | Fine-grained PAT (Case A steps above) or a GitHub App installation token, with read access to the submodule repo | Repo: **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Org (shared across repos): **Settings → Secrets and variables → Actions → Secrets → New organization secret** (scope it to the repos that need it) |

Then pass it to the checkout step so it's used for the submodule clone too:

```yaml
- name: Checkout
  uses: actions/checkout@v4
  with:
    submodules: recursive
    token: ${{ secrets.SUBMODULE_TOKEN }}
```

This is a manual edit to the generated workflow (inside an `# EMBARK:CUSTOM` block —
see the root `CLAUDE.md`'s workflow sync rules) — `create-package`/`generate-workflows`
don't set this up automatically.

---

## Summary by Scenario

| Scenario | Required Secrets |
|----------|------------------|
| GCP (Cloud Run) | `GCP_PROJECT_ID`, `GCP_SA_KEY`, `GCP_REGION` |
| Netlify basic | `NETLIFY_TOKEN`, `DOMAIN` |
| Netlify + Cloudflare DNS | Netlify basic + `CF_TOKEN`, `CF_ZONE_ID` |
| Cloudflare Pages | `CF_TOKEN_PAGES`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`, `DOMAIN` |
| CF Workers basic | `CF_WORKER_TOKEN`, `CF_ACCOUNT_ID` |
| CF Workers + custom domain | CF Workers basic + `CF_ZONE_ID`, `DOMAIN` |

---

## Tips

### Reusing Secrets

If you already have secrets configured:

| Already have | Can reuse in |
|--------------|--------------|
| `CF_ZONE_ID` | All Cloudflare scenarios |
| `DOMAIN` | All scenarios |
| `CF_TOKEN` | Only DNS (Netlify + Cloudflare) |

### Security

- **Never** commit secrets to repository files
- Use tokens with **minimal scope** permissions
- Rotate tokens periodically
- For GCP, create a dedicated Service Account for CI/CD
