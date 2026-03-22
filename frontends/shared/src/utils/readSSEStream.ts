// Mirror the JS demo: read a fetch response body as SSE chunks,
// parse "data: {...}" lines, and yield parsed JSON events.
export async function* readSSEStream(
  response: Response
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const jsonData = line.substring(5).trim();
        if (jsonData) {
          try {
            yield JSON.parse(jsonData) as Record<string, unknown>;
          } catch {
            // malformed JSON — skip
          }
        }
      }
    }
  }
}
