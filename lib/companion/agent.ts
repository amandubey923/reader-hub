/**
 * The companion agent loop: model → (catalog tools run on the server | reader actions validated and handed
 * to the client) → model, for a bounded number of steps. The model call is injected so the loop is testable.
 */

import { ACTION_NAMES, ACTION_SPECS, validateAction } from "./tools";
import { CATALOG_TOOL_DECLARATIONS, CATALOG_TOOL_NAMES, catalogBookExists, getCatalogBook, runCatalogTool, toBookCard } from "./catalog-tools";
import { getBookContentPolicy } from "./content-policy";
import { buildReaderContextBlock, buildSystemInstruction } from "./prompt";
import { enforceCitations } from "./citations";
import type { CompanionAction, CompanionBookCard, CompanionRequest, CompanionResponse, CompanionSource } from "./types";

export interface ModelFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
}

export interface GenerateResult {
  text: string;
  functionCalls: ModelFunctionCall[];
  /** The model's raw content, echoed back verbatim so provider metadata (e.g. thought signatures) is preserved. */
  content?: unknown;
}

export type GenerateFn = (input: { systemInstruction: string; contents: unknown[]; tools: unknown[] }) => Promise<GenerateResult>;

const MAX_STEPS = 4;
const MAX_ACTIONS = 2;

export async function runCompanionAgent(request: CompanionRequest, generate: GenerateFn): Promise<CompanionResponse> {
  const reader = request.reader;
  const book = reader ? getCatalogBook(reader.bookId) : undefined;
  const policy = reader ? getBookContentPolicy(reader.bookId) : undefined;

  // Book-wide passages are only honoured for rights-cleared titles, whatever the client sends
  if (reader && !policy?.bookWideAllowed) reader.retrieved = [];

  const actionDeclarations = ACTION_NAMES.filter((name) => reader || !ACTION_SPECS[name].needsReader).map((name) => ({
    name,
    description: ACTION_SPECS[name].description,
    parametersJsonSchema: ACTION_SPECS[name].parameters,
  }));
  const tools = [{ functionDeclarations: [...CATALOG_TOOL_DECLARATIONS, ...actionDeclarations] }];

  const history = request.messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  const latest = request.messages[request.messages.length - 1];
  const contents: unknown[] = [
    ...history,
    { role: "user", parts: [{ text: `${buildReaderContextBlock(reader, book, policy)}\n\nReader's message:\n${latest.text}` }] },
  ];

  const actionEnv = {
    reader: reader ? { totalPages: reader.totalPages, currentPage: reader.currentPage } : undefined,
    bookExists: catalogBookExists,
  };

  const actions: CompanionAction[] = [];
  const seenBooks = new Map<string, CompanionBookCard>();
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await generate({ systemInstruction: buildSystemInstruction(), contents, tools });
    if (result.text) reply += (reply ? "\n\n" : "") + result.text.trim();
    const calls = (result.functionCalls || []).filter((c) => typeof c?.name === "string").slice(0, 4);
    if (calls.length === 0) break;

    const responses = calls.map((call) => {
      const name = call.name as string;
      const args = call.args && typeof call.args === "object" ? call.args : {};
      let response: Record<string, unknown>;

      if (CATALOG_TOOL_NAMES.has(name)) {
        response = runCatalogTool(name, args) as Record<string, unknown>;
        const found = [
          ...(((response as any).results as any[]) || []),
          ...((response as any).book ? [(response as any).book] : []),
        ];
        for (const b of found) {
          const catalogBook = getCatalogBook(b.id);
          if (catalogBook) seenBooks.set(catalogBook.id, toBookCard(catalogBook));
        }
      } else {
        const check = validateAction({ name, args }, actionEnv);
        if (!check.ok) {
          response = { error: check.error };
        } else if (actions.length >= MAX_ACTIONS || actions.some((a) => a.name === check.action.name)) {
          response = { error: "Only one action of each kind can be queued per reply." };
        } else {
          actions.push(check.action);
          response = { status: "pending", note: "The app will carry this out and show the reader the real result. Do not say it is done." };
        }
      }
      return { functionResponse: { name, id: call.id, response } };
    });

    contents.push(result.content ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });
    contents.push({ role: "user", parts: responses });
  }

  // Page citations must be backed by text that was actually supplied
  const supported = new Map<number, CompanionSource>();
  for (const p of reader?.visiblePages || []) {
    if (p.text.trim()) supported.set(p.pageNum, { pageNum: p.pageNum, snippet: p.text.slice(0, 160), kind: "visible" });
  }
  if (reader?.selection?.pageNum) {
    supported.set(reader.selection.pageNum, { pageNum: reader.selection.pageNum, snippet: reader.selection.text.slice(0, 160), kind: "selection" });
  }
  for (const p of reader?.retrieved || []) {
    if (!supported.has(p.pageNum)) supported.set(p.pageNum, { pageNum: p.pageNum, snippet: p.text.slice(0, 160), kind: "retrieved" });
  }
  const checked = enforceCitations(reply, supported.keys());

  const replyLower = checked.reply.toLowerCase();
  const openIds = new Set(actions.filter((a) => a.name === "open_book").map((a) => String(a.args.bookId)));
  const books = Array.from(seenBooks.values())
    .filter((b) => openIds.has(b.id) || replyLower.includes(b.title.toLowerCase()))
    .slice(0, 4);

  return {
    reply: checked.reply || (actions.length ? "" : "I couldn't put together an answer this time. Could you rephrase that?"),
    actions,
    sources: checked.citedPages.map((p) => supported.get(p)!).filter(Boolean),
    books,
  };
}
