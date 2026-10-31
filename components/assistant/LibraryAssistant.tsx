"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { AssistantBook } from "@/lib/library-assistant";
import { useEntitlement } from "@/context/EntitlementContext";
import { getAuthHeader } from "@/lib/firebase";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  books?: AssistantBook[];
  suggestedActions?: string[];
  timestamp: string;
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: "welcome",
    sender: "assistant",
    text: "Hi! I'm the **Library Assistant**. Ask me to find a book, an author, or a category. For help while reading, ask Bodhi.",
    suggestedActions: ["Find a book", "Browse categories", "Books by author", "What's available?"],
    timestamp: "Just now",
  },
];

export default function LibraryAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  const { isPro, canUseAiAssistant, recordAiQuery, openProModal } = useEntitlement();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText || input).trim();
    if (!textToSend || isLoading) return;

    if (textToSend.includes("Upgrade to Reader Pro") || textToSend.includes("Reader Pro")) {
      openProModal("Unlock unlimited AI Reader Assistant questions with Reader Pro.");
      return;
    }

    // Check daily limit for free tier
    if (!canUseAiAssistant()) {
      const limitMessage: Message = {
        id: `limit-${Date.now()}`,
        sender: "assistant",
        text: "You have reached today's free limit of 5 AI questions. Upgrade to **Reader Pro** for unlimited conversations with the AI Reader Assistant!",
        suggestedActions: ["✨ Upgrade to Reader Pro", "Browse categories", "What's available?"],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, limitMessage]);
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({ message: textToSend }),
      });

      // Rate-limit responses carry a user-facing reply
      if (res.status === 429) {
        const limited = await res.json().catch(() => null);
        setMessages((prev) => [
          ...prev,
          {
            id: `limit-${Date.now()}`,
            sender: "assistant",
            text: limited?.reply || "Too many requests. Please wait a moment and try again.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        return;
      }

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();
      recordAiQuery();

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        sender: "assistant",
        text: data.reply || "Here is what I found in the library.",
        books: (data.books || []).slice(0, 3),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      if (!isOpen) setHasUnread(true);
    } catch (err) {
      console.error("Chat error:", err);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        sender: "assistant",
        text: "I'm having a brief connection trouble. You can search directly in the Reader's HUB search bar or browse all categories in the Library!",
        suggestedActions: ["Browse categories", "What's available?"],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Helper to format basic markdown (bold and bullets)
  const formatText = (text: string) => {
    return text.split("\n").map((line, lineIdx) => {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <span key={lineIdx} className="block min-h-[1.2em]">
          {parts.map((part, pIdx) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return (
                <strong key={pIdx} className="font-semibold text-[var(--foreground)]">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return part;
          })}
        </span>
      );
    });
  };

  return (
    <>
      {/* -------------------------------------------------------------
       * Desktop Floating Library Assistant Trigger Button
       * ------------------------------------------------------------- */}
      <div className="hidden sm:block fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`group relative flex items-center gap-2.5 px-4 py-3 rounded-full glass-card border border-[var(--border)] hover:border-[var(--accent)] text-[var(--foreground)] shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer backdrop-blur-xl ${
            isOpen ? "border-[var(--accent)] shadow-[0_0_20px_var(--theme-glow)]" : ""
          }`}
          aria-label="Open Reader's HUB Library Assistant"
          aria-expanded={isOpen}
          title="Ask Library Assistant"
        >
          {/* Subtle Ambient Pulse */}
          <span
            className="absolute -inset-1 rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-300 blur-sm pointer-events-none"
            style={{
              background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
            }}
          />

          {/* Sparkle Icon */}
          <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] transition-transform group-hover:rotate-12">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>

          <div className="text-left">
            <div className="text-xs font-bold leading-tight tracking-wide flex items-center gap-1.5">
              <span>Library Assistant</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-[10px] text-[var(--text-secondary)] font-normal">
              Ask about books
            </div>
          </div>

          {/* Unread notification pip */}
          {hasUnread && !isOpen && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[var(--accent)] border-2 border-[var(--background)] rounded-full shadow-sm" />
          )}
        </button>
      </div>

      {/* -------------------------------------------------------------
       * Mobile Phone Floating AI Assistant Trigger Button (sm:hidden)
       * Clear "AI" label, recognizable sparkle icon, compact & fitted
       * ------------------------------------------------------------- */}
      <div className="block sm:hidden fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`group relative flex items-center gap-2 px-3 py-2 rounded-full glass-card border border-[var(--accent)]/40 bg-[var(--card)]/95 shadow-xl text-[var(--foreground)] transition-transform active:scale-95 cursor-pointer backdrop-blur-xl ${
            isOpen ? "border-[var(--accent)] shadow-[0_0_15px_var(--theme-glow)] ring-1 ring-[var(--accent)]" : ""
          }`}
          aria-label="Open Reader's HUB AI Assistant"
          aria-expanded={isOpen}
        >
          {/* Subtle Ambient Pulse */}
          <span
            className="absolute -inset-0.5 rounded-full opacity-35 transition-opacity blur-xs pointer-events-none"
            style={{
              background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
            }}
          />

          {/* Bold AI Badge */}
          <span className="relative px-1.5 py-0.5 rounded-md bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-[10px] font-black tracking-wider uppercase shadow-xs">
            AI
          </span>

          {/* Sparkle Icon + Label */}
          <div className="relative flex items-center gap-1 text-[11px] font-bold text-[var(--foreground)] pr-0.5">
            <span>Assistant</span>
            <span className="text-xs text-[var(--accent)]">✨</span>
          </div>

          {/* Unread notification pip */}
          {hasUnread && !isOpen && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--accent)] border-2 border-[var(--background)] rounded-full shadow-xs" />
          )}
        </button>
      </div>

      {/* -------------------------------------------------------------
       * Floating Chat Modal Panel
       * Desktop: Fixed right-6 bottom-20 (410px width)
       * Mobile: inset-x-3 bottom-16, perfectly fitted, zero overflow
       * ------------------------------------------------------------- */}
      {isOpen && (
        <div className="fixed inset-x-3 bottom-16 sm:inset-auto sm:bottom-20 sm:right-6 w-auto sm:w-[410px] max-h-[75dvh] sm:max-h-[82vh] h-[480px] sm:h-[580px] rounded-2xl sm:rounded-3xl glass-panel shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-up border border-[var(--border)] max-w-full">
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2.5 sm:py-3.5 border-b border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-xl flex-shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl sm:rounded-2xl bg-gradient-to-tr from-[var(--primary)] to-[var(--accent-secondary)] flex items-center justify-center text-[var(--primary-foreground)] shadow-md flex-shrink-0">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <h3 className="text-xs font-bold text-[var(--foreground)] tracking-wide truncate">
                  Reader&#39;s HUB Assistant
                </h3>
                <p className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="truncate">Library Grounded AI</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setMessages(INITIAL_MESSAGES)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors text-xs cursor-pointer"
                title="Reset conversation"
              >
                ↺
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors cursor-pointer"
                aria-label="Close Assistant"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 text-xs min-h-0">
            {messages.map((msg) => {
              const isUser = msg.sender === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-2`}
                >
                  {/* Bubble */}
                  <div
                    className={`max-w-[88%] sm:max-w-[85%] rounded-2xl px-3 sm:px-3.5 py-2 sm:py-2.5 leading-relaxed shadow-sm ${
                      isUser
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-br-xs font-medium text-left"
                        : "bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-bl-xs text-left"
                    }`}
                  >
                    {formatText(msg.text)}
                  </div>

                  {/* Embedded Book Result Cards with [Read Now] & [Favorite] */}
                  {msg.books && msg.books.length > 0 && (
                    <div className="w-full space-y-2 pt-1 animate-fade-in text-left">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] px-1">
                        Matching Library Volumes ({msg.books.length})
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {msg.books.map((b) => {
                          return (
                            <div
                              key={b.id}
                              className="flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-[var(--card)]/90 border border-[var(--border)] hover:border-[var(--accent)]/40 transition-all shadow-sm w-full min-w-0"
                            >
                              <div className="relative w-9 h-14 sm:w-11 sm:h-16 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--muted)] shadow-inner">
                                <Image
                                  src={b.cover}
                                  alt={b.title}
                                  fill
                                  className="object-cover"
                                  sizes="44px"
                                />
                              </div>
                              <div className="min-w-0 flex-1 text-left">
                                <h4 className="text-xs font-bold text-[var(--foreground)] truncate">
                                  {b.title}
                                </h4>
                                <p className="text-[10px] text-[var(--text-secondary)] truncate">
                                  by {b.author}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5 sm:mt-1">
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[var(--secondary)] text-[var(--accent)] font-bold truncate max-w-[90px]">
                                    {b.category}
                                  </span>
                                  <span className="text-[9px] text-[var(--text-secondary)] flex-shrink-0">
                                    ★ {b.rating}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <Link
                                  href={`/book/${b.id}`}
                                  onClick={() => setIsOpen(false)}
                                  className="px-2 sm:px-2.5 py-1 rounded-lg bg-[var(--primary)] hover:opacity-90 text-[var(--primary-foreground)] font-bold text-[10px] transition-transform hover:scale-105 shadow-xs"
                                >
                                  Read ↗
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Suggested Follow-up Action Chips */}
                  {msg.id === "welcome" && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {msg.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSend(action)}
                          className="px-2.5 py-1 rounded-full bg-[var(--secondary)] hover:bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/50 text-[10px] font-medium transition-all cursor-pointer shadow-xs"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs animate-fade-in pl-1">
                <div className="flex items-center gap-1 bg-[var(--card)] border border-[var(--border)] px-3 py-2 rounded-2xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.4s]" />
                </div>
                <span className="text-[10px]">Consulting library catalog...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="p-2.5 sm:p-3 border-t border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-xl flex-shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2 bg-[var(--background)] p-1.5 rounded-2xl border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors shadow-inner"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask about books, authors, or categories..."
                disabled={isLoading}
                className="w-full bg-transparent px-2 sm:px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder-[var(--text-secondary)] focus:outline-hidden resize-none max-h-20 sm:max-h-24 min-h-[32px]"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
                  input.trim() && !isLoading
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm hover:scale-105"
                    : "bg-[var(--muted)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
                }`}
                aria-label="Send message"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </form>
            <div className="flex items-center justify-between px-1 pt-1.5 text-[9px] text-[var(--text-secondary)]">
              <span>Press <kbd className="font-mono">Enter</kbd> to send</span>
              <span>Reader&#39;s HUB Digital Library</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
