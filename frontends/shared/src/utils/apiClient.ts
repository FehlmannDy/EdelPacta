export function makeApiClient(base: string) {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
    return data as T;
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`);
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
    return data as T;
  }

  return { post, get };
}
