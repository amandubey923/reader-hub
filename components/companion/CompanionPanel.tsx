"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import BodhiRobot, { BodhiMood } from "./BodhiRobot";
import MessageText from "./MessageText";
import WholeBookSearch from "./WholeBookSearch";
import { useCompanionChat } from "./useCompanionChat";
import { useVoice, VoiceLang } from "./useVoice";
import type { ReaderSnapshot } from "@/lib/companion/reader-bridge";
import { clearAllBookIndexes } from "@/lib/companion/book-index";
import { useAuth } from "@/context/AuthContext";
import { useEntitlement } from "@/context/EntitlementContext";

interface CompanionPanelProps {
  snapshot: ReaderSnapshot | null;
  signedIn: boolean;
  onReaderRoute: boolean;
  voiceReplies: boolean;
  hideOnReader: boolean;
  onToggleVoiceReplies: () => void;
  onToggleHideOnReader: () => void;
  onHideForSession: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onMoodChange: (mood: BodhiMood) => void;
  navigate: (href: string) => void;
}

const iconBtn =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function pageLabel(s: ReaderSnapshot) {
  return s.visiblePages.length > 1 ? `pp. ${s.visiblePages[0]}–${s.visiblePages[s.visiblePages.length - 1]}` : `p. ${s.currentPage}`;
}

export default function CompanionPanel(props: CompanionPanelProps) {
  const { snapshot, signedIn, navigate } = props;
  const { user } = useAuth();
  const { isPro, openProModal } = useEntitlement();
  const chat = useCompanionChat(navigate, { uid: user?.uid ?? null, isPro, onLimitReached: openProModal });
  const voice = useVoice();
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("en-IN");
  const [voiceError, setVoiceError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSpokenRef = useRef<string>("");

  const reading = Boolean(snapshot?.isLoaded);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.busy]);

  // Robot mood mirrors the conversation and voice output
  useEffect(() => {
    props.onMoodChange(voice.speaking ? "speaking" : chat.mood);
  }, [voice.speaking, chat.mood, props.onMoodChange]);

  // Speak new assistant replies when voice replies are on
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!props.voiceReplies || !voice.canSpeak || !last || last.role !== "assistant" || !last.text || lastSpokenRef.current === last.id) return;
    lastSpokenRef.current = last.id;
    voice.speak(last.text);
  }, [chat.messages, props.voiceReplies, voice.canSpeak, voice.speak]);

  useEffect(() => {
    if (!props.voiceReplies) voice.stopSpeaking();
  }, [props.voiceReplies, voice.stopSpeaking]);

  const quickPrompts = useMemo(() => {
    if (reading && snapshot?.selection) {
      return ["Explain my selection simply", "Translate my selection to Hindi", "Hard words in my selection", "Explain like I'm 5"];
    }
    if (reading) {
      return ["Explain this page simply", "Explain like I'm 5", "Summarize this spread", "Quiz me on this page", "Hinglish mein samjhao"];
    }
    return ["Recommend a book for me", "Short Hindi classics?", "Books on Stoicism", "Compare 1984 and The Great Gatsby"];
  }, [reading, snapshot?.selection]);

  const submit = (text = input) => {
    // Not blocked while Bodhi is answering: repeats are dropped and new messages are queued by the chat hook
    if (!text.trim()) return;
    voice.stopSpeaking();
    setInput("");
    chat.send(text);
  };

  const goToPage = (page: number) => chat.runDirectAction({ name: "go_to_page", args: { page } });

  return (
    <div className="flex h-full flex-col" role="dialog" aria-label="Bodhi, your AI reading companion">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3 py-2.5">
        <BodhiRobot mood={voice.speaking ? "speaking" : chat.mood} size={56} interactive={false} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-lg font-bold leading-tight text-[var(--foreground)]">Bodhi</div>
          <div className="truncate text-xs text-[var(--text-secondary)]">
            {chat.busy ? "Thinking…" : reading && snapshot ? `Reading “${snapshot.title}” · ${pageLabel(snapshot)}` : "Your reading companion"}
          </div>
        </div>
        {voice.canSpeak && (
          <button
            type="button"
            className={iconBtn}
            onClick={props.onToggleVoiceReplies}
            aria-pressed={props.voiceReplies}
            aria-label={props.voiceReplies ? "Turn off spoken replies" : "Turn on spoken replies"}
            title={props.voiceReplies ? "Spoken replies on" : "Spoken replies off"}
          >
            {props.voiceReplies ? "🔊" : "🔈"}
          </button>
        )}
        <div className="relative">
          <button type="button" className={iconBtn} onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Companion options">
            ⋯
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-9 z-10 w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 text-xs shadow-xl">
              {[
                { label: "Clear conversation", run: () => chat.clear() },
                { label: props.hideOnReader ? "Show Bodhi on reading pages" : "Don't show Bodhi on reading pages", run: props.onToggleHideOnReader },
                { label: "Hide until I press Alt+K", run: props.onHideForSession },
                { label: "Forget whole-book indexes on this device", run: () => clearAllBookIndexes() },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    item.run();
                  }}
                  className="block w-full cursor-pointer px-3 py-2 text-left text-[var(--foreground)] hover:bg-[var(--secondary)]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={iconBtn} onClick={props.onMinimize} aria-label="Minimize companion" title="Minimize">
          –
        </button>
        <button type="button" className={iconBtn} onClick={props.onClose} aria-label="Close companion" title="Close (Esc)">
          ×
        </button>
      </div>

      {/* Reading context */}
      {reading && snapshot && (
        <div className="space-y-1.5 border-b border-[var(--border)] bg-[var(--secondary)]/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-md bg-[var(--card)] px-2 py-0.5 font-semibold text-[var(--foreground)] shadow-sm">📖 {pageLabel(snapshot)} of {snapshot.totalPages}</span>
            {snapshot.chapter && <span className="max-w-[180px] truncate rounded-md bg-[var(--card)] px-2 py-0.5 text-[var(--text-secondary)]">{snapshot.chapter}</span>}
            {snapshot.selection && (
              <span className="max-w-[200px] truncate rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[var(--accent)]" title={snapshot.selection.text}>
                ✎ “{snapshot.selection.text.slice(0, 40)}”
              </span>
            )}
          </div>
          <WholeBookSearch bookId={snapshot.bookId} totalPages={snapshot.totalPages} signedIn={signedIn} />
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {chat.messages.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-relaxed text-[var(--foreground)]">
            <p className="font-semibold">Namaste! I&apos;m Bodhi 👋</p>
            <p className="mt-1 text-[var(--text-secondary)]">
              {reading
                ? "I can see the pages you have open. Ask me to explain them simply, summarize, quiz you, translate a selection, or turn pages for you. English, Hindi or Hinglish — your choice."
                : "Tell me what you like to read and I'll suggest books from the library, compare titles, or open one for you. Open any book and I'll help you understand it page by page."}
            </p>
          </div>
        )}

        {chat.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#141b2d] px-4 py-2.5 text-sm leading-relaxed text-[#f7f4ec]">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="max-w-[94%] space-y-2">
              {m.text && (
                <div
                  className={`rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-relaxed text-[var(--foreground)] ${
                    m.notice ? "border-[var(--accent)]/30 bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--card)]"
                  }`}
                >
                  <MessageText text={m.text} onCite={goToPage} />
                </div>
              )}

              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                  <span>From the book:</span>
                  {m.sources.map((s) => (
                    <button
                      key={s.pageNum}
                      type="button"
                      onClick={() => goToPage(s.pageNum)}
                      title={s.snippet}
                      className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 font-mono hover:border-[var(--accent)]/50"
                    >
                      p. {s.pageNum}
                      {s.kind === "retrieved" ? " ↗" : ""}
                    </button>
                  ))}
                </div>
              )}

              {m.books && m.books.length > 0 && (
                <div className="grid gap-2">
                  {m.books.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2.5">
                      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md shadow-sm">
                        <Image src={b.cover} alt="" fill sizes="44px" className="object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 font-serif text-sm font-bold leading-snug text-[var(--foreground)]">{b.title}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                          {b.author} · {b.language}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => chat.runDirectAction({ name: "open_book", args: { bookId: b.id } })}
                        className="shrink-0 cursor-pointer rounded-lg bg-[#141b2d] px-3.5 py-1.5 text-xs font-semibold text-[#f7f4ec] hover:opacity-90"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {m.actions?.map((a, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                    a.state === "done"
                      ? "border-emerald-600/30 bg-emerald-600/5 text-[var(--foreground)]"
                      : a.state === "failed"
                      ? "border-[#b4321f]/30 bg-[#b4321f]/5 text-[var(--foreground)]"
                      : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
                  }`}
                >
                  <span className="min-w-0">
                    {a.state === "done" && "✓ "}
                    {a.state === "failed" && "✗ "}
                    {a.state === "running" && "… "}
                    {a.state === "pending" || a.state === "running" ? a.label : a.result || a.label}
                  </span>
                  {a.state === "pending" && (
                    <span className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => chat.runCard(m.id, i)} className="cursor-pointer rounded-lg bg-[#141b2d] px-2.5 py-1 font-semibold text-[#f7f4ec]">
                        Confirm
                      </button>
                      <button type="button" onClick={() => chat.cancelCard(m.id, i)} className="cursor-pointer rounded-lg border border-[var(--border)] px-2.5 py-1 font-semibold">
                        Cancel
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {chat.busy && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-glow)]" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {reading ? "Reading your pages…" : "Thinking…"}
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--border)] px-4 pt-2.5">
        {quickPrompts.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => submit(q)}
            className="shrink-0 cursor-pointer rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 sm:p-4">
        {voiceError && <div className="mb-1.5 text-[11px] text-[#b4321f]">{voiceError}</div>}
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 focus-within:border-[var(--accent)]/60">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              e.stopPropagation();
            }}
            rows={1}
            placeholder={reading ? "Ask about this page… (e.g. ye samajh nahi aa raha)" : "Ask Bodhi about books…"}
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--text-secondary)] focus:outline-none"
            aria-label="Message Bodhi"
          />
          {voice.canListen && (
            <>
              <button
                type="button"
                onClick={() => setVoiceLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
                className="h-9 shrink-0 cursor-pointer rounded-lg px-1.5 text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                title="Voice input language"
                aria-label={`Voice input language: ${voiceLang === "en-IN" ? "English" : "Hindi"}`}
              >
                {voiceLang === "en-IN" ? "EN" : "हिं"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoiceError("");
                  if (voice.listening) voice.stopListening();
                  else voice.listen(voiceLang, (text) => submit(text), setVoiceError);
                }}
                className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors ${
                  voice.listening ? "animate-pulse bg-[#b4321f] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--secondary)]"
                }`}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? "Stop listening" : "Speak your question"}
              >
                🎙
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => submit()}
            disabled={!input.trim()}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent-secondary)] text-white shadow-md transition-opacity disabled:cursor-default disabled:opacity-40"
            aria-label="Send"
          >
            ↑
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-[var(--text-secondary)]">
          Bodhi can make mistakes. Page references point to the text it was given.
        </div>
      </div>
    </div>
  );
}
