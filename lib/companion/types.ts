/**
 * Reader's HUB — AI Reading Companion ("Bodhi") shared types.
 * Used by the client panel, the reader bridge and the /api/companion route.
 */

export type CompanionRole = "user" | "assistant";

export interface CompanionTurn {
  role: CompanionRole;
  text: string;
}

export interface PageText {
  pageNum: number;
  text: string;
}

export interface RetrievedPassage {
  pageNum: number;
  text: string;
  score?: number;
}

/** What the reader currently shows, gathered client-side from the PDF reader bridge. */
export interface CompanionReaderContext {
  bookId: string;
  currentPage: number;
  totalPages: number;
  visiblePages: PageText[];
  selection?: { text: string; pageNum?: number };
  chapter?: string;
  retrieved?: RetrievedPassage[];
  bookIndexStatus?: "none" | "lexical" | "semantic";
}

export interface CompanionRequest {
  messages: CompanionTurn[];
  reader?: CompanionReaderContext;
}

export type CompanionActionName =
  | "go_to_page"
  | "next_page"
  | "previous_page"
  | "open_book"
  | "bookmark_page"
  | "add_note";

export interface CompanionAction {
  name: CompanionActionName;
  args: Record<string, unknown>;
}

export interface CompanionSource {
  pageNum: number;
  snippet: string;
  kind: "visible" | "selection" | "retrieved";
}

export interface CompanionBookCard {
  id: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  language: string;
}

export interface CompanionResponse {
  reply: string;
  actions: CompanionAction[];
  sources: CompanionSource[];
  books: CompanionBookCard[];
  /** True when the model was unavailable and a fallback answer was produced. */
  degraded?: boolean;
}
