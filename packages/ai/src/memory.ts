export type MemoryCandidate = {
  content: string;
  kind: "fact" | "preference" | "person" | "project";
};

function terms(content: string) {
  return new Set(
    content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2),
  );
}

export function memorySimilarity(left: string, right: string) {
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return intersection / union;
}

export function findMemoryDuplicate(candidate: MemoryCandidate, existing: MemoryCandidate[]) {
  return existing
    .filter((memory) => memory.kind === candidate.kind)
    .map((memory) => ({ memory, similarity: memorySimilarity(candidate.content, memory.content) }))
    .sort((left, right) => right.similarity - left.similarity)
    .find((result) => result.similarity >= 0.55)?.memory;
}
