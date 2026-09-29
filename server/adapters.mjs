import { createHash } from "node:crypto";
import { fail, Problem } from "./domain.mjs";

export const integrationStatus = {
  bee: {
    connected: false,
    label: "Bee connection is private to its configured account",
    reason: "Open Sources to check your connection. Manual imports never establish Bee provenance.",
  },
  aws: {
    connected: false,
    label: "AWS is not connected",
    reason: "Triage uses conservative local rules, not a model.",
  },
};
const optional = (value, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function conversationId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail("Choose a valid Bee conversation ID.");
  return value;
}
function timestamp(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isFinite(new Date(value).getTime())
  )
    fail("Bee returned a missing or invalid conversation timestamp.", 502);
  return new Date(value).toISOString();
}
export function createBeeAdapter({ proxyUrl, fetchImpl = fetch, fixture = false } = {}) {
  let base;
  if (proxyUrl) {
    try {
      base = new URL(proxyUrl);
    } catch {
      throw new Error("BEE_PROXY_URL must be a loopback HTTP origin.");
    }
    if (
      base.protocol !== "http:" ||
      base.hostname !== "127.0.0.1" ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    )
      throw new Error(
        "BEE_PROXY_URL must be an HTTP origin on 127.0.0.1 with no credentials or path.",
      );
  }
  async function get(path) {
    if (!base)
      fail("Bee is not configured. Ask the operator to connect the official Bee CLI proxy.", 503);
    try {
      const response = await fetchImpl(new URL(path, base), {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        if (response.status === 404)
          fail(
            "This conversation is no longer available in Bee. Existing notebook copies are unchanged.",
            404,
          );
        if ([401, 403].includes(response.status))
          fail(
            "Bee authorization expired. Sign in again with the official Bee CLI, then retry.",
            502,
          );
        if (response.status === 429)
          fail("Bee is limiting requests. Wait a moment before trying again.", 429);
        fail("Bee could not complete the request. Your notebook is unchanged.", 502);
      }
      const reader = response.body?.getReader();
      if (!reader) fail("Bee returned an empty response.", 502);
      let total = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 1500000)
            fail("This Bee response is too large. Choose a shorter conversation.", 413);
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail("Bee returned an unreadable response. Nothing was imported.", 502);
      }
    } catch (error) {
      if (error instanceof Problem) throw error;
      fail(
        "Cannot reach Bee. Check that the authenticated local Bee proxy is running, then retry.",
        502,
      );
    }
  }
  async function list(cursor = "") {
    if (typeof cursor !== "string" || cursor.length > 1000) fail("The Bee page cursor is invalid.");
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const data = await get("/v1/conversations?" + query);
    if (
      !Array.isArray(data?.conversations) ||
      data.conversations.length > 20 ||
      data.conversations.some((c) => !record(c) || !Number.isSafeInteger(c.id) || c.id <= 0) ||
      new Set(data.conversations.map((c) => c.id)).size !== data.conversations.length
    )
      fail("Bee returned an unexpected conversation list.", 502);
    const nextCursor = data.next_cursor ?? "";
    if (
      typeof nextCursor !== "string" ||
      nextCursor.length > 1000 ||
      (nextCursor && nextCursor === cursor)
    )
      fail("Bee returned invalid pagination. Refresh the conversation list before retrying.", 502);
    return {
      conversations: data.conversations.map((c) => ({
        id: conversationId(c.id),
        title: optional(c.title, 160) || `Conversation ${c.id}`,
        occurredAt: timestamp(c.start_time ?? c.created_at),
        summary: optional(c.summary, 1200),
        state: optional(c.state, 40),
        ready: ["processed", "completed"].includes(String(c.state).toLowerCase()),
      })),
      nextCursor,
    };
  }
  async function detail(requestedId) {
    const providerId = conversationId(requestedId);
    const data = await get(`/v1/conversations/${providerId}`);
    const c = data?.conversation;
    if (!record(c) || c.id !== providerId)
      fail("Bee returned an unexpected conversation record. Nothing was imported.", 502);
    if (!["processed", "completed"].includes(String(c.state).toLowerCase()))
      fail("Bee has not finished processing this conversation. Try again when it is ready.", 409);
    const transcription =
      Array.isArray(c.transcriptions) && c.transcriptions.find((t) => record(t) && t.realtime === false);
    if (
      !transcription ||
      !Array.isArray(transcription.utterances) ||
      !transcription.utterances.length
    )
      fail("A processed Bee transcript is not available for this conversation.", 409);
    if (transcription.utterances.length > 3000)
      fail("This Bee transcript exceeds 3,000 segments. Choose a shorter conversation.", 413);
    const utterances = transcription.utterances
      .map((u) => {
        if (!record(u) || typeof u.text !== "string" || !u.text.trim() || u.text.length > 20000)
          fail("Bee returned an invalid transcript segment.", 502);
        return {
          id: Number.isSafeInteger(u.id) ? u.id : null,
          text: u.text.trim(),
          speaker: optional(u.speaker, 100),
          spokenAt: typeof u.spoken_at === "number" ? u.spoken_at : null,
          start: typeof u.start === "number" ? u.start : null,
          end: typeof u.end === "number" ? u.end : null,
        };
      })
      .sort((a, b) => {
        const time = (a.spokenAt ?? a.start ?? 0) - (b.spokenAt ?? b.start ?? 0);
        // Keep known IDs ordered together; a mixed-ID comparator must be transitive.
        const identity = a.id === null
          ? (b.id === null ? 0 : 1)
          : (b.id === null ? -1 : a.id - b.id);
        // Missing/duplicate IDs use content, never upstream position. The final
        // metadata tie-break keeps identical words from different speakers stable.
        return time || identity || compareText(a.text, b.text) ||
          compareText(JSON.stringify(a), JSON.stringify(b));
      });
    const text = utterances.map((u) => u.text).join("\n");
    const summary = optional(c.summary || c.short_summary, 20000);
    if (!summary.trim())
      fail(
        "Bee has not supplied processed conversation context yet. Retry after processing finishes.",
        409,
      );
    if (text.length > 100000)
      fail("This transcript exceeds 100,000 characters. Import a shorter conversation.", 413);
    const occurredAt = timestamp(c.start_time ?? c.created_at);
    const provider = {
      conversationId: providerId,
      deviceType: optional(c.device_type, 80) || "not reported",
      state: optional(c.state, 40),
      summary,
      utterances,
      transcriptionId: Number.isSafeInteger(transcription.id) ? transcription.id : null,
      fetchedAt: new Date().toISOString(),
      updatedAt: typeof c.updated_at === "number" ? timestamp(c.updated_at) : null,
      transport: fixture ? "test_fixture" : "official_cli_proxy",
    };
    // Identity includes processed context and date; fetchedAt is a receipt, not content.
    const digest = createHash("sha256")
      .update(
        JSON.stringify({ text, occurredAt, summary, utterances, deviceType: provider.deviceType }),
      )
      .digest("hex");
    return {
      title:
        optional(c.title, 160) ||
        optional(c.short_summary, 160) ||
        `Bee conversation ${providerId}`,
      text,
      occurredAt,
      digest,
      provider,
    };
  }
  return { configured: Boolean(base), fixture, list, detail };
}
