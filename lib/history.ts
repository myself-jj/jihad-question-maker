import type { ExamParams, MCQ } from "./types";

export interface HistoryItem {
  id: string;
  createdAt: string; // ISO date
  exam: ExamParams;
  questions: MCQ[];
}

const KEY = "jqm-history-v1";
const MAX_ITEMS = 50;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: HistoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked — ignore */
  }
}

export function addHistory(exam: ExamParams, questions: MCQ[]): HistoryItem[] {
  const item: HistoryItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    exam,
    questions,
  };
  const list = [item, ...loadHistory()].slice(0, MAX_ITEMS);
  save(list);
  return list;
}

export function removeHistory(id: string): HistoryItem[] {
  const list = loadHistory().filter((h) => h.id !== id);
  save(list);
  return list;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}
