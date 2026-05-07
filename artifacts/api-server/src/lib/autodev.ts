const BASE = "https://auto.dev/api";

function getKey(): string {
  const key = process.env.AUTODEV_API_KEY?.trim();
  if (!key) throw new Error("AUTODEV_API_KEY is not set");
  return key;
}

export async function autodevGet(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apikey", getKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`auto.dev ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
