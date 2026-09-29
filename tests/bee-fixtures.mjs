/** Explicitly authored contract fixtures. Never recorded or processed by Bee. */
export const baseline = "The venue has reliable internet for the walkthrough.";
export const later = "The organizer confirmed the venue internet is unavailable.";
export function conversation(id = 101, text = baseline) {
  const time = Date.parse(id === 101 ? "2026-09-05T12:00:00Z" : "2026-09-06T12:00:00Z");
  return {
    conversation: {
      id,
      title: id === 101 ? "Fixture · Launch planning" : "Fixture · Venue check",
      start_time: time,
      end_time: time + 60000,
      updated_at: time + 120000,
      state: "processed",
      device_type: "fixture-not-a-device",
      summary:
        id === 101
          ? "Explicit fixture: the launch team expects reliable internet and chooses an online walkthrough."
          : "Explicit fixture: the organizer reports unavailable internet. The team discusses an offline alternative.",
      transcriptions: [
        {
          id: id * 10,
          realtime: true,
          utterances: [{ id: 1, text: "Temporary live transcript must not be used." }],
        },
        {
          id: id * 10 + 1,
          realtime: false,
          utterances: [
            {
              id: id * 100,
              spoken_at: time,
              start: time,
              end: time + 1000,
              speaker: "fixture-speaker",
              text,
            },
          ],
        },
      ],
    },
  };
}
export function fixtureFetch(records, calls = []) {
  return async (url, options) => {
    calls.push({
      path: url.pathname,
      search: url.search,
      method: options.method,
      redirect: options.redirect,
    });
    if (url.pathname === "/v1/conversations")
      return Response.json({
        conversations: [...records.values()].map((r) => r.conversation),
        next_cursor: null,
      });
    const found = records.get(Number(url.pathname.split("/").at(-1)));
    return found
      ? Response.json(found)
      : Response.json({ error: "Fixture missing" }, { status: 404 });
  };
}
