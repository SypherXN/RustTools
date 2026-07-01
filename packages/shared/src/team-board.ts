export type TeamBoardEntryKind = "note" | "link";

export const TEAM_BOARD_CATEGORY_MAX_LEN = 48;
export const TEAM_BOARD_UNCATEGORIZED_LABEL = "Uncategorized";

export interface TeamBoardEntry {
  id: string;
  kind: TeamBoardEntryKind;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function isTeamBoardEntryKind(value: string): value is TeamBoardEntryKind {
  return value === "note" || value === "link";
}

export function normalizeTeamBoardCategory(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, TEAM_BOARD_CATEGORY_MAX_LEN);
}

export function teamBoardCategoryLabel(category: string): string {
  const normalized = normalizeTeamBoardCategory(category);
  return normalized || TEAM_BOARD_UNCATEGORIZED_LABEL;
}

export function compareTeamBoardCategories(a: string, b: string): number {
  const aEmpty = !normalizeTeamBoardCategory(a);
  const bEmpty = !normalizeTeamBoardCategory(b);
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;
  return teamBoardCategoryLabel(a).localeCompare(teamBoardCategoryLabel(b), undefined, {
    sensitivity: "base",
  });
}

export function sortTeamBoardEntries(entries: TeamBoardEntry[]): TeamBoardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const categoryCmp = compareTeamBoardCategories(a.category, b.category);
    if (categoryCmp !== 0) return categoryCmp;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

export function groupTeamBoardEntries(
  entries: TeamBoardEntry[],
): Array<{ category: string; label: string; entries: TeamBoardEntry[] }> {
  const sorted = sortTeamBoardEntries(entries);
  const groups: Array<{ category: string; label: string; entries: TeamBoardEntry[] }> = [];

  for (const entry of sorted) {
    const category = normalizeTeamBoardCategory(entry.category);
    const last = groups[groups.length - 1];
    if (last && last.category === category) {
      last.entries.push(entry);
      continue;
    }
    groups.push({
      category,
      label: teamBoardCategoryLabel(category),
      entries: [entry],
    });
  }

  return groups;
}

export function collectTeamBoardCategories(entries: TeamBoardEntry[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const entry of entries) {
    const category = normalizeTeamBoardCategory(entry.category);
    if (!category || seen.has(category)) continue;
    seen.add(category);
    categories.push(category);
  }
  return categories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function validateTeamBoardLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "URL is required";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
    return null;
  } catch {
    return "Invalid URL";
  }
}
