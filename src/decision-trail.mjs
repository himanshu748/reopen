const fields = ["title", "rationale", "assumptions", "reviewCondition", "sourceId", "quote"];
const copyContent = (value) => {
  const content = {};
  for (const key of fields) {
    if (typeof value[key] === "string") content[key] = value[key];
    if (key === "assumptions" && Array.isArray(value[key])) content[key] = [...value[key]];
  }
  return content;
};
/** Materialize only recorded versions. Missing snapshots are never filled with current wording. */
export function buildDecisionTrail(decision, candidates) {
  const versions = new Map();
  const related = candidates.filter((candidate) => candidate.decisionId === decision.id);
  const upsert = (version, content, metadata) => {
    if (!Number.isInteger(version) || version < 1) return;
    const previous = versions.get(version) || {
      version,
      content: {},
      current: false,
      recordType: "evidence",
      status: "",
      recordedAt: "",
      reviews: [],
    };
    versions.set(version, {
      ...previous,
      ...metadata,
      content: { ...previous.content, ...copyContent(content) },
    });
  };
  for (const candidate of related) {
    if (
      candidate.decisionSnapshot &&
      candidate.decisionSnapshot.version === candidate.decisionVersion
    ) {
      upsert(candidate.decisionVersion, candidate.decisionSnapshot, { recordType: "evidence" });
    }
  }
  for (const saved of decision.history)
    upsert(saved.version, saved, {
      recordType: "archive",
      status: saved.status || "",
      recordedAt: saved.at || "",
    });
  upsert(decision.version, decision, {
    recordType: "current",
    current: true,
    status: decision.status,
    recordedAt: "",
  });
  const result = [...versions.values()].sort((a, b) => a.version - b.version);
  for (let i = 0; i < result.length; i++) {
    const node = result[i];
    node.reviews = related.filter((candidate) => candidate.decisionVersion === node.version);
    node.outcomes = related.filter(
      (candidate) => candidate.reopenedDecisionVersion === node.version,
    );
    node.previousVersion = result[i - 1]?.version ?? null;
    node.complete = fields.every((key) =>
      key === "assumptions"
        ? Array.isArray(node.content[key])
        : typeof node.content[key] === "string",
    );
    node.changes = [];
    if (i > 0) {
      const before = result[i - 1].content;
      for (const key of fields) {
        if (!(key in before) || !(key in node.content)) continue;
        if (JSON.stringify(before[key]) !== JSON.stringify(node.content[key])) {
          node.changes.push({
            field: key,
            before: Array.isArray(before[key]) ? [...before[key]] : before[key],
            after: Array.isArray(node.content[key]) ? [...node.content[key]] : node.content[key],
          });
        }
      }
    }
  }
  return result;
}
