"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthHeader } from "@/lib/firebase";
import { parseDirectCommand } from "@/lib/companion/intents";
import { actionNeedsConfirmation, describeAction, validateAction } from "@/lib/companion/tools";
import { catalogTitle, executeAction, liveActionEnvironment } from "@/lib/companion/executor";
import { getReaderBridge } from "@/lib/companion/reader-bridge";
import { fetchBookPolicy, loadBookIndex, retrievePassages } from "@/lib/companion/book-index";
import { COMPANION_LIMITS } from "@/lib/companion/validate";
import type {
  CompanionAction,
  CompanionBookCard,
  CompanionReaderContext,
  CompanionResponse,
  CompanionSource,
  CompanionTurn,
} from "@/lib/companion/types";

export interface ActionCard {
  action: CompanionAction;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "cancelled";
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: CompanionSource[];
  books?: CompanionBookCard[];
  actions?: ActionCard[];
  notice?: boolean;
}

// Session-only memory: lives in this tab (sessionStorage), never in Firestore or reading data
const SESSION_KEY = "readershub:companion:session:v1";
const MAX_STORED_MESSAGES = 40;
const HISTORY_TURNS = 12;

let idCounter = 0;
const newId = () => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function loadSession(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Unconfirmed actions are never restored (they must be re-requested)
    return parsed.slice(-MAX_STORED_MESSAGES).map((m: ChatMessage) => ({
      ...m,
      actions: m.actions?.map((a) => (a.state === "pending" || a.state === "running" ? { ...a, state: "cancelled" as const } : a)),
    }));
  } catch {
    return [];
  }
}

/** What the model should remember about a past assistant turn, including real action results. */
function turnText(m: ChatMessage): string {
  const results = (m.actions || [])
    .filter((a) => a.state === "done" || a.state === "failed")
    .map((a) => `[${a.state === "done" ? "Done" : "Failed"}: ${a.result}]`);
  return [m.text, ...results].filter(Boolean).join("\n");
}

export type ChatMood = "idle" | "thinking" | "happy" | "error";

export function useCompanionChat(navigate: (href: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<ChatMood>("idle");
  const messagesRef = useRef<ChatMessage[]>([]);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const restored = loadSession();
    messagesRef.current = restored;
    setMessages(restored);
  }, []);

  const commit = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next.slice(-MAX_STORED_MESSAGES)));
    } catch {}
  }, []);

  const flashMood = useCallback((m: ChatMood) => {
    setMood(m);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood("idle"), 1800);
  }, []);

  const patchAction = useCallback(
    (messageId: string, index: number, patch: Partial<ActionCard>) => {
      commit(
        messagesRef.current.map((m) =>
          m.id === messageId && m.actions
            ? { ...m, actions: m.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)) }
            : m
        )
      );
    },
    [commit]
  );

  const runCard = useCallback(
    async (messageId: string, index: number) => {
      const card = messagesRef.current.find((m) => m.id === messageId)?.actions?.[index];
      if (!card || card.state === "running" || card.state === "done") return;
      patchAction(messageId, index, { state: "running" });
      const outcome = await executeAction(card.action, navigate);
      patchAction(messageId, index, { state: outcome.ok ? "done" : "failed", result: outcome.message });
      flashMood(outcome.ok ? "happy" : "error");
    },
    [navigate, patchAction, flashMood]
  );

  const cancelCard = useCallback(
    (messageId: string, index: number) => patchAction(messageId, index, { state: "cancelled", result: "Cancelled." }),
    [patchAction]
  );

  /** Adds assistant-proposed actions: safe navigation runs immediately, writes wait for confirmation. */
  const addAssistantMessage = useCallback(
    async (message: Omit<ChatMessage, "id" | "role" | "actions">, actions: CompanionAction[] = []) => {
      const id = newId();
      const cards: ActionCard[] = actions.map((action) => ({
        action,
        label: describeAction(action, catalogTitle),
        state: "pending",
      }));
      commit([...messagesRef.current, { id, role: "assistant", ...message, actions: cards.length ? cards : undefined }]);
      for (let i = 0; i < cards.length; i++) {
        if (!actionNeedsConfirmation(cards[i].action)) await runCard(id, i);
      }
      return id;
    },
    [commit, runCard]
  );

  const gatherReaderContext = useCallback(async (question: string): Promise<CompanionReaderContext | undefined> => {
    const bridge = getReaderBridge();
    const snap = bridge?.getSnapshot();
    if (!bridge || !snap || !snap.isLoaded) return undefined;

    const visiblePages = await Promise.all(
      snap.visiblePages.map(async (pageNum) => ({
        pageNum,
        text: (await bridge.getPageText(pageNum)).slice(0, COMPANION_LIMITS.pageChars),
      }))
    );

    let retrieved: CompanionReaderContext["retrieved"] = [];
    let bookIndexStatus: CompanionReaderContext["bookIndexStatus"] = "none";
    const policy = await fetchBookPolicy(snap.bookId);
    if (policy.bookWideAllowed) {
      const index = await loadBookIndex(snap.bookId);
      if (index) {
        bookIndexStatus = index.vectors ? "semantic" : "lexical";
        const recentUserText = messagesRef.current
          .filter((m) => m.role === "user")
          .slice(-2)
          .map((m) => m.text)
          .join(" ");
        retrieved = await retrievePassages(snap.bookId, `${question} ${recentUserText}`.slice(0, 600), snap.visiblePages, {
          semantic: Boolean(index.vectors),
        });
      }
    }

    return {
      bookId: snap.bookId,
      currentPage: snap.currentPage,
      totalPages: snap.totalPages,
      visiblePages,
      selection: snap.selection ? { text: snap.selection.text.slice(0, COMPANION_LIMITS.selectionChars), pageNum: snap.selection.pageNum } : undefined,
      chapter: snap.chapter,
      retrieved,
      bookIndexStatus,
    };
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, COMPANION_LIMITS.messageChars);
      if (!text || busy) return;

      const userMessage: ChatMessage = { id: newId(), role: "user", text };
      commit([...messagesRef.current, userMessage]);

      // 1. Short, unambiguous commands run locally (no model call)
      const direct = parseDirectCommand(text);
      if (direct) {
        const check = validateAction(direct, liveActionEnvironment());
        if (check.ok) {
          await addAssistantMessage({ text: "" }, [check.action]);
        } else {
          await addAssistantMessage({ text: check.error });
          flashMood("error");
        }
        return;
      }

      // 2. Everything else goes to the agent with the current reading context
      setBusy(true);
      setMood("thinking");
      try {
        const reader = await gatherReaderContext(text);
        const history: CompanionTurn[] = messagesRef.current
          .filter((m) => !m.notice)
          .slice(-HISTORY_TURNS)
          .map((m) => ({ role: m.role, text: m.role === "assistant" ? turnText(m) : m.text }))
          .filter((t) => t.text);

        const res = await fetch("/api/companion", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
          body: JSON.stringify({ messages: history, reader }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<CompanionResponse> & { error?: string };

        if (!res.ok) {
          await addAssistantMessage({ text: data.error || "Something went wrong. Please try again.", notice: true });
          flashMood("error");
          return;
        }

        // Proposed actions are re-validated here against the live reader before they can run
        const env = liveActionEnvironment();
        const actions = (data.actions || [])
          .map((a) => validateAction(a, env))
          .filter((c): c is { ok: true; action: CompanionAction } => c.ok)
          .map((c) => c.action);

        await addAssistantMessage(
          { text: data.reply || "", sources: data.sources || [], books: data.books || [], notice: data.degraded },
          actions
        );
        setMood("idle");
      } catch {
        await addAssistantMessage({ text: "I couldn't reach the server. Please check your connection and try again.", notice: true });
        flashMood("error");
      } finally {
        setBusy(false);
      }
    },
    [busy, commit, addAssistantMessage, gatherReaderContext, flashMood]
  );

  /** Runs an action the reader triggered directly (e.g. clicking a page citation or "Open" on a book card). */
  const runDirectAction = useCallback(
    async (action: CompanionAction) => {
      await addAssistantMessage({ text: "" }, [action]);
    },
    [addAssistantMessage]
  );

  const clear = useCallback(() => commit([]), [commit]);

  return { messages, busy, mood, send, runCard, cancelCard, runDirectAction, clear };
}
