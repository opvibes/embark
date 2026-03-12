const REPO = "opvibes/embark";
const CACHE_KEY = "embark_latest_version";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedVersion {
  tag: string;
  ts: number;
}

async function fetchLatestTag(): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedVersion;
      if (Date.now() - parsed.ts < CACHE_TTL_MS) {
        return parsed.tag;
      }
    }
  } catch {
    // ignore storage errors
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    const tag = data.tag_name ?? null;
    if (tag) {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ tag, ts: Date.now() } satisfies CachedVersion));
      } catch {
        // ignore
      }
    }
    return tag;
  } catch {
    return null;
  }
}

export function initVersionBadge() {
  const badge = document.getElementById("version-badge") as HTMLAnchorElement | null;
  if (!badge) return;

  fetchLatestTag().then((tag) => {
    if (tag) {
      badge.textContent = tag;
      badge.title = `Latest release: ${tag}`;
    }
  });
}
