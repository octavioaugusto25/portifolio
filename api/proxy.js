export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { url, method = "GET", headers = {}, body } = req.body || {};
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing url" });
      return;
    }

    const upstream = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });

    const contentType = upstream.headers.get("content-type") || "";
    const text = await upstream.text();

    res.status(upstream.status);
    if (contentType.includes("application/json")) {
      try {
        res.setHeader("content-type", "application/json");
        res.send(text);
      } catch {
        res.json({ raw: text });
      }
      return;
    }

    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: "Proxy request failed", detail: String(error?.message || error) });
  }
}
