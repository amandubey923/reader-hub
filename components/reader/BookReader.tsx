"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Book } from "@/data/books";
import { useLibrary } from "@/context/LibraryContext";
import { useEntitlement } from "@/context/EntitlementContext";
import DrawingCanvas from "@/components/reader/DrawingCanvas";
import AnnotationDrawer from "@/components/reader/AnnotationDrawer";
import BookReadingMemory from "@/components/memory/BookReadingMemory";
import { SESSION_PRESETS } from "@/components/reader/ReadingSessionTimer";
import { TranslationDrawer, TranslationPosition } from "@/components/reader/TranslationDrawer";
import { pageSound } from "@/lib/pageSound";
import {
  TranslationTarget,
  TranslationResult,
  PageExtract,
  normalizePdfText,
  translatePageSpread,
  getCachedTranslation,
} from "@/lib/translator";
import {
  getBookAnnotations,
  addHighlight,
  deleteHighlight,
  addNote,
  updateNote,
  deleteNote,
  savePageDrawings,
  clearPageDrawings,
  getSavedProgress,
  saveProgress,
  getBookmarks,
  saveBookmark,
  deleteBookmark,
  BookAnnotations,
  BookmarkItem,
  HighlightItem,
  DrawingStroke,
  DrawingPoint,
  AnnotationToolType,
} from "@/lib/reader-storage";
import {
  syncAnnotationsToCloud,
  syncBookmarksToCloud,
} from "@/lib/firestore-sync";
import { registerReaderBridge, notifyReaderChanged, ReaderSnapshot } from "@/lib/companion/reader-bridge";

interface BookReaderProps {
  book: Book;
}

type ReadingMode = "default" | "sepia" | "dark" | "dim";
type LayoutMode = "double" | "single";

interface ReaderPrefs {
  brightness: number; // 60 - 130
  warmth: number;     // 0 - 60
  contrast: number;   // 80 - 120
  zoom: number;       // 70 - 150
  readingMode: ReadingMode;
  layoutMode: LayoutMode;
}

interface TocItem {
  title: string;
  page: number;
}

interface SearchMatch {
  page: number;
  matchSnippet: string;
}

type FocusSessionStatus = "IDLE" | "ACTIVE" | "EXIT_CONFIRM" | "COMPLETED";

const SESSION_DURATION_SECONDS = 15 * 60; // 900 seconds (15 minutes)

const DEFAULT_PREFS: ReaderPrefs = {
  brightness: 100,
  warmth: 0,
  contrast: 100,
  zoom: 100,
  readingMode: "default",
  layoutMode: "double",
};

const PREFS_KEY = "readers_hub_reader_prefs_v3";
const TIMER_PREFS_KEY = "readers_hub_focus_timer_prefs_v1";
const EMPTY_DRAWINGS: DrawingStroke[] = [];

export default function BookReader({ book }: BookReaderProps) {
  const {
    user,
    getReadingProgress,
    updateReadingProgress,
    showToast,
    recordActiveReading,
    activeSession,
    startReadingSession,
    endReadingSession,
    recordSessionEvent,
    checkOfflineStatus,
    saveBookOffline,
    removeBookOffline,
    addBookReadingTime,
  } = useLibrary();

  const { isPro, canTranslateSpread, recordTranslationSpread, openProModal } = useEntitlement();

  // Load saved position from centralized storage or context (prioritize user context if authenticated)
  const savedContextProgress = getReadingProgress(book.id);
  const savedLocalProgress = getSavedProgress(book.id, user?.uid);
  const initialPage =
    user && savedContextProgress?.page && savedContextProgress.page > 0
      ? savedContextProgress.page
      : savedLocalProgress?.page && savedLocalProgress.page > 0
      ? savedLocalProgress.page
      : savedContextProgress?.page && savedContextProgress.page > 0
      ? savedContextProgress.page
      : 1;

  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [numPages, setNumPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingText, setLoadingText] = useState<string>("Loading document...");
  const [isFlipping, setIsFlipping] = useState<boolean>(false);
  const [flipDirection, setFlipDirection] = useState<"next" | "prev">("next");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showJumpModal, setShowJumpModal] = useState<boolean>(false);
  const [jumpPageInput, setJumpPageInput] = useState<string>("");
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [pdfJsReady, setPdfJsReady] = useState<boolean>(false);

  // -------------------------------------------------------------
  // P1: Focus Mode, Search Inside Book & Reading Memory
  // -------------------------------------------------------------
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState<boolean>(false);
  const [isOfflineSaved, setIsOfflineSaved] = useState<boolean>(false);

  // Search Inside Book State
  const [isSearchInBookOpen, setIsSearchInBookOpen] = useState<boolean>(false);
  const [bookSearchQuery, setBookSearchQuery] = useState<string>("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [isSearchingBook, setIsSearchingBook] = useState<boolean>(false);
  const pdfTextCacheRef = useRef<Record<number, string>>({});

  // Dedicated Focus Session State (configurable countdown, lifecycle & exit protection)
  const [sessionStatus, setSessionStatus] = useState<FocusSessionStatus>("IDLE");
  const [sessionTargetMinutes, setSessionTargetMinutes] = useState<number>(15);
  const sessionDurationRef = useRef<number>(SESSION_DURATION_SECONDS);
  const [sessionRemainingSeconds, setSessionRemainingSeconds] = useState<number>(SESSION_DURATION_SECONDS);
  const sessionEndTimeRef = useRef<number | null>(null);
  const sessionStatusRef = useRef<FocusSessionStatus>("IDLE");
  const [isSessionModalOpen, setIsSessionModalOpen] = useState<boolean>(false);
  const [isSessionCompleteOpen, setIsSessionCompleteOpen] = useState<boolean>(false);
  const sessionStartPageRef = useRef<number>(initialPage);
  const sessionMarksCountRef = useRef<number>(0);

  // Focus Mode Floating Timer Draggable & Visibility State
  const timerOverlayRef = useRef<HTMLDivElement>(null);
  const [timerPosition, setTimerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isTimerVisible, setIsTimerVisible] = useState<boolean>(true);
  const isDraggingTimerRef = useRef<boolean>(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  // Load timer preferences on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TIMER_PREFS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          const clampedX = Math.min(Math.max(12, parsed.x), window.innerWidth - 180);
          const clampedY = Math.min(Math.max(12, parsed.y), window.innerHeight - 70);
          setTimerPosition({ x: clampedX, y: clampedY });
        }
        if (typeof parsed.isVisible === "boolean") {
          setIsTimerVisible(parsed.isVisible);
        }
      }
    } catch {}
  }, []);

  const saveTimerPrefs = useCallback((updates: { x?: number; y?: number; isVisible?: boolean }) => {
    try {
      const saved = localStorage.getItem(TIMER_PREFS_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      localStorage.setItem(TIMER_PREFS_KEY, JSON.stringify({ ...parsed, ...updates }));
    } catch {}
  }, []);

  // Table of Contents State
  const [isTocOpen, setIsTocOpen] = useState<boolean>(false);
  const [tocActiveTab, setTocActiveTab] = useState<"toc" | "annotated">("toc");
  const [tableOfContents, setTableOfContents] = useState<TocItem[]>([]);

  // Page Thumbnail Navigator State
  const [isThumbnailDrawerOpen, setIsThumbnailDrawerOpen] = useState<boolean>(false);
  const [thumbnailFilter, setThumbnailFilter] = useState<"all" | "annotated" | "bookmarked">("all");
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Contextual Page Translation State
  // -------------------------------------------------------------
  const [isTranslateOpen, setIsTranslateOpen] = useState<boolean>(false);
  const [translationTarget, setTranslationTarget] = useState<TranslationTarget>("hindi");
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [currentSpreadExtracts, setCurrentSpreadExtracts] = useState<PageExtract[]>([]);
  const [translationPosition, setTranslationPosition] = useState<TranslationPosition>("right");
  const translationAbortControllerRef = useRef<AbortController | null>(null);
  const translationReqIdRef = useRef<number>(0);

  // -------------------------------------------------------------
  // Advanced Study, Annotations & Bookmarks State
  // -------------------------------------------------------------
  const [annotations, setAnnotations] = useState<BookAnnotations>({
    highlights: [],
    notes: [],
    drawings: {},
    bookmarks: [],
  });
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isAnnotationDrawerOpen, setIsAnnotationDrawerOpen] = useState<boolean>(false);
  const [showAnnotationsOverlay, setShowAnnotationsOverlay] = useState<boolean>(true);

  // Study Tools State
  const [isStudyMode, setIsStudyMode] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<AnnotationToolType | "eraser" | "select">("pen");
  const [penColor, setPenColor] = useState<string>("#f59e0b");
  const [highlighterColor, setHighlighterColor] = useState<string>("#facc15");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [opacity, setOpacity] = useState<number>(1.0);
  const [fillMode, setFillMode] = useState<boolean>(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);

  // Undo / Redo Stacks per page
  const [undoStack, setUndoStack] = useState<Record<number, DrawingStroke[][]>>({});
  const [redoStack, setRedoStack] = useState<Record<number, DrawingStroke[][]>>({});

  // Text Box Annotation Dialog State
  const [textBoxDialog, setTextBoxDialog] = useState<{
    isOpen: boolean;
    page: number;
    point: DrawingPoint | null;
    text: string;
  }>({
    isOpen: false,
    page: 1,
    point: null,
    text: "",
  });

  // Text Selection & Floating Annotation Popover
  const [selectionPopover, setSelectionPopover] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    page: number;
  } | null>(null);

  // Note Modal State
  const [noteModal, setNoteModal] = useState<{
    isOpen: boolean;
    page: number;
    selectedText?: string;
    noteText: string;
  }>({
    isOpen: false,
    page: 1,
    noteText: "",
  });

  // Canvas Dimensions & Gesture Pan Offset
  const [pageCanvasSize, setPageCanvasSize] = useState<{ width: number; height: number }>({
    width: 450,
    height: 600,
  });
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactiveScale, setInteractiveScale] = useState<number>(1);
  const [isPinching, setIsPinching] = useState<boolean>(false);
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(100);
  const touchStartPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const isPinchingRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const pendingScaleRef = useRef<number | null>(null);
  const targetZoomRef = useRef<number>(100);

  // Fullscreen Integrated Cursor Position
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: -100,
    y: -100,
    visible: false,
  });

  // Active Reading Streak Tracker Refs
  const lastActivityTimestampRef = useRef<number>(Date.now());
  const pageDwellStartRef = useRef<number>(Date.now());
  const accumulatedSecondsRef = useRef<number>(0);
  const activeSessionRef = useRef(activeSession);
  const sessionCompletedRef = useRef<boolean>(false);
  const handleCompleteSessionRef = useRef<((customTargetSecs?: number) => void) | null>(null);
  const currentPageRef = useRef(currentPage);
  const numPagesRef = useRef(numPages);
  const isSessionCompleteOpenRef = useRef(isSessionCompleteOpen);
  const showToastRef = useRef(showToast);
  const recordSessionEventRef = useRef(recordSessionEvent);
  const endReadingSessionRef = useRef(endReadingSession);
  const recordActiveReadingRef = useRef(recordActiveReading);
  const addBookReadingTimeRef = useRef(addBookReadingTime);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    currentPageRef.current = currentPage;
    pageDwellStartRef.current = Date.now();
  }, [currentPage]);

  useEffect(() => {
    numPagesRef.current = numPages;
  }, [numPages]);

  useEffect(() => {
    isSessionCompleteOpenRef.current = isSessionCompleteOpen;
  }, [isSessionCompleteOpen]);

  useEffect(() => {
    showToastRef.current = showToast;
    recordSessionEventRef.current = recordSessionEvent;
    endReadingSessionRef.current = endReadingSession;
    recordActiveReadingRef.current = recordActiveReading;
    addBookReadingTimeRef.current = addBookReadingTime;
  }, [showToast, recordSessionEvent, endReadingSession, recordActiveReading, addBookReadingTime]);

  const registerActivity = useCallback(() => {
    lastActivityTimestampRef.current = Date.now();
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const canvasSingleRef = useRef<HTMLCanvasElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const renderTasksRef = useRef<Record<string, any>>({});
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 1. Load Initial Annotations, Bookmarks, Offline Status & Screen Size
  useEffect(() => {
    const loaded = getBookAnnotations(book.id, user?.uid);
    const bms = getBookmarks(book.id, user?.uid);
    setAnnotations(loaded);
    setBookmarks(bms);

    if (book.pdf) {
      checkOfflineStatus(book.id, book.pdf).then(setIsOfflineSaved);
    }

    const checkScreen = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
    };

    checkScreen();
    window.addEventListener("resize", checkScreen);

    try {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) {
        setPrefs((prev) => ({ ...prev, ...JSON.parse(saved) }));
      }
    } catch {
      // Ignore
    }

    return () => window.removeEventListener("resize", checkScreen);
  }, [book.id, book.pdf, checkOfflineStatus, user?.uid]);

  // Desktop / Laptop Trackpad Pinch & Ctrl+Wheel Zoom Listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.15;
        setPrefs((prev) => {
          const newZoom = Math.min(220, Math.max(70, Math.round(prev.zoom + delta)));
          try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, zoom: newZoom }));
          } catch {}
          return { ...prev, zoom: newZoom };
        });
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const updatePref = <K extends keyof ReaderPrefs>(key: K, val: ReaderPrefs[K]) => {
    setPrefs((prev) => {
      const updated = { ...prev, [key]: val };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
      } catch {
        // Ignore
      }
      return updated;
    });
  };

  const zoomIn = () => updatePref("zoom", Math.min(150, prefs.zoom + 10));
  const zoomOut = () => updatePref("zoom", Math.max(70, prefs.zoom - 10));
  const resetZoom = () => updatePref("zoom", 100);

  // Derived Annotated Pages Index
  const annotatedPagesList = useMemo(() => {
    const pageMap: Record<number, { highlights: number; notes: number; drawings: number; bookmark: boolean; noteSnippets: string[] }> = {};
    (annotations.highlights || []).forEach((h) => {
      if (!pageMap[h.page]) pageMap[h.page] = { highlights: 0, notes: 0, drawings: 0, bookmark: false, noteSnippets: [] };
      pageMap[h.page].highlights++;
    });
    (annotations.notes || []).forEach((n) => {
      if (!pageMap[n.page]) pageMap[n.page] = { highlights: 0, notes: 0, drawings: 0, bookmark: false, noteSnippets: [] };
      pageMap[n.page].notes++;
      if (n.note) pageMap[n.page].noteSnippets.push(n.note);
    });
    Object.keys(annotations.drawings || {}).forEach((pStr) => {
      const p = Number(pStr);
      if ((annotations.drawings[p] || []).length > 0) {
        if (!pageMap[p]) pageMap[p] = { highlights: 0, notes: 0, drawings: 0, bookmark: false, noteSnippets: [] };
        pageMap[p].drawings += annotations.drawings[p].length;
      }
    });
    (bookmarks || []).forEach((b) => {
      if (!pageMap[b.page]) pageMap[b.page] = { highlights: 0, notes: 0, drawings: 0, bookmark: false, noteSnippets: [] };
      pageMap[b.page].bookmark = true;
    });

    return Object.entries(pageMap)
      .map(([pageStr, data]) => ({ page: Number(pageStr), ...data }))
      .sort((a, b) => a.page - b.page);
  }, [annotations, bookmarks]);

  // 1.5. Intelligent Active Reading Timer (Diwali Diya & Book Memory Tracker)
  useEffect(() => {
    const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes grace period for stationary reading
    pageDwellStartRef.current = Date.now();

    const timer = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        !loading &&
        pdfDocRef.current
      ) {
        const now = Date.now();
        const timeSinceLastActivity = now - lastActivityTimestampRef.current;
        const pageDwellSeconds = (now - pageDwellStartRef.current) / 1000;

        // User must be actively dwell-reading on current page for at least 3 seconds (avoiding rapid flips) and not idle
        if (timeSinceLastActivity < IDLE_TIMEOUT_MS && pageDwellSeconds >= 3) {
          accumulatedSecondsRef.current += 1;

          if (accumulatedSecondsRef.current >= 5) {
            const secs = accumulatedSecondsRef.current;
            accumulatedSecondsRef.current = 0;
            const res = recordActiveReadingRef.current(secs);
            addBookReadingTimeRef.current(book.id, secs);
            updateReadingProgress(book.id, currentPageRef.current, numPagesRef.current);
            if (res.justQualified) {
              showToastRef.current("🪔 15-minute daily reading goal reached! Your Diwali Diya is lit! ✨");
            }
          }

          // Check if structured reading session completed
          const curSession = activeSessionRef.current;
          if (curSession && curSession.isActive && curSession.bookId === book.id) {
            const totalSecs = curSession.elapsedSeconds + accumulatedSecondsRef.current;
            if (totalSecs >= curSession.targetMinutes * 60 && !sessionCompletedRef.current) {
              handleCompleteSessionRef.current?.(curSession.targetMinutes * 60);
            }
          }
        }
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      if (accumulatedSecondsRef.current >= 5) {
        const secs = accumulatedSecondsRef.current;
        accumulatedSecondsRef.current = 0;
        recordActiveReadingRef.current(secs);
        addBookReadingTimeRef.current(book.id, secs);
        updateReadingProgress(book.id, currentPageRef.current, numPagesRef.current);
      } else {
        accumulatedSecondsRef.current = 0;
      }
    };
  }, [loading, book.id, updateReadingProgress]);

  // 2. Load Standalone PDF.js Library
  useEffect(() => {
    if ((window as any).pdfjsLib) {
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      setPdfJsReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/pdfjs/pdf.min.js";
    script.async = true;
    script.onload = () => {
      if ((window as any).pdfjsLib) {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
        setPdfJsReady(true);
      }
    };
    script.onerror = () => {
      const cdnScript = document.createElement("script");
      cdnScript.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      cdnScript.async = true;
      cdnScript.onload = () => {
        if ((window as any).pdfjsLib) {
          (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          setPdfJsReady(true);
        }
      };
      document.head.appendChild(cdnScript);
    };

    document.head.appendChild(script);
  }, []);

  // 3. Load PDF Document & Extract Table of Contents
  useEffect(() => {
    if (!pdfJsReady || !book.pdf) return;

    let isCancelled = false;
    setLoading(true);
    setLoadingText("Fetching pages...");

    const pdfjsLib = (window as any).pdfjsLib;

    const loadingTask = pdfjsLib.getDocument({
      url: book.pdf,
      cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
      cMapPacked: true,
      rangeChunkSize: 65536,
      disableAutoFetch: false,
      disableStream: false,
    });

    loadingTask.onProgress = (progressData: any) => {
      if (progressData.total > 0) {
        const percent = Math.round((progressData.loaded / progressData.total) * 100);
        setLoadingText(`Loading book (${percent}%)...`);
      }
    };

    loadingTask.promise
      .then(async (doc: any) => {
        if (isCancelled) return;
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);

        const targetPage = Math.min(doc.numPages, Math.max(1, initialPage));
        setCurrentPage(targetPage);
        saveProgress(book.id, targetPage, doc.numPages, user?.uid);

        // Extract PDF Outline
        try {
          const outline = await doc.getOutline();
          if (outline && outline.length > 0) {
            const parsedToc: TocItem[] = [];
            for (const item of outline) {
              if (item.title) {
                let pageIndex = 1;
                if (typeof item.dest === "string") {
                  const dest = await doc.getDestination(item.dest);
                  if (dest) {
                    const pageRef = dest[0];
                    pageIndex = (await doc.getPageIndex(pageRef)) + 1;
                  }
                } else if (Array.isArray(item.dest)) {
                  const pageRef = item.dest[0];
                  pageIndex = (await doc.getPageIndex(pageRef)) + 1;
                }
                parsedToc.push({ title: item.title, page: Math.max(1, pageIndex) });
              }
            }
            if (parsedToc.length > 0) {
              setTableOfContents(parsedToc);
            }
          } else {
            const step = Math.max(10, Math.ceil(doc.numPages / 8));
            const milestones: TocItem[] = [];
            for (let p = 1; p <= doc.numPages; p += step) {
              milestones.push({
                title: p === 1 ? "Opening & Front Matter" : `Section — Page ${p}`,
                page: p,
              });
            }
            setTableOfContents(milestones);
          }
        } catch {
          const step = Math.max(10, Math.ceil(doc.numPages / 8));
          const milestones: TocItem[] = [];
          for (let p = 1; p <= doc.numPages; p += step) {
            milestones.push({
              title: p === 1 ? "Opening & Front Matter" : `Section — Page ${p}`,
              page: p,
            });
          }
          setTableOfContents(milestones);
        }
      })
      .catch((err: any) => {
        console.error("Error loading PDF document:", err);
        if (!isCancelled) {
          setPdfLoadError(err?.message || "Unable to fetch or parse document.");
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      if (loadingTask) {
        try {
          loadingTask.destroy();
        } catch {
          // Ignore
        }
      }
    };
  }, [pdfJsReady, book.pdf, book.id]);

  // 4. Render Single Page to Canvas with Retina DPI & Adjacent Prefetch
  const renderPageToCanvas = useCallback(
    async (pageNum: number, canvas: HTMLCanvasElement | null, slot: string) => {
      if (!canvas || !pdfDocRef.current || pageNum < 1 || pageNum > numPages) {
        if (canvas) {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          canvas.style.display = pageNum < 1 ? "none" : "block";
        }
        return;
      }

      try {
        canvas.style.display = "block";

        if (renderTasksRef.current[slot]) {
          try {
            renderTasksRef.current[slot].cancel();
          } catch {
            // Ignore
          }
        }

        const page = await pdfDocRef.current.getPage(pageNum);

        const container = containerRef.current;
        const containerWidth = container ? container.clientWidth : 1000;
        const containerHeight = container ? container.clientHeight : 700;

        const isDouble = prefs.layoutMode === "double" && !isMobile;
        // Two-page spreads keep a clear 72px lane on each side for the ‹ › page-turn buttons (16px inset + 48px button + 8px gap)
        const NAV_LANES = 2 * 72;
        const availableWidth = isDouble ? (containerWidth - 90 - NAV_LANES) / 2 : containerWidth - (isMobile ? 0 : 40);
        const availableHeight = (isFocusMode || isFullscreen)
          ? containerHeight - (isMobile ? 48 : 70)
          : containerHeight - (isMobile ? 60 : 120);

        const baseViewport = page.getViewport({ scale: 1.0 });
        const scaleX = availableWidth / baseViewport.width;
        const scaleY = availableHeight / baseViewport.height;
        const fitScale = isMobile ? scaleX : Math.min(scaleX, scaleY);

        const userScale = (prefs.zoom / 100) * (isMobile ? 1.0 : 0.96);
        const finalScale = Math.max(0.4, fitScale * userScale);

        const viewport = page.getViewport({ scale: finalScale });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        setPageCanvasSize({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
        });

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTasksRef.current[slot] = renderTask;
        await renderTask.promise;

        // P0: Prefetch adjacent pages into memory in background
        if (pdfDocRef.current) {
          if (pageNum + 1 <= numPages) pdfDocRef.current.getPage(pageNum + 1).catch(() => {});
          if (pageNum - 1 >= 1) pdfDocRef.current.getPage(pageNum - 1).catch(() => {});
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.warn(`Render error on page ${pageNum}:`, err);
        }
      }
    },
    [numPages, prefs.layoutMode, prefs.zoom, isMobile, isFocusMode]
  );

  // 5. Trigger Page Renders
  useEffect(() => {
    if (loading || !pdfDocRef.current || numPages === 0) return;

    const isDouble = prefs.layoutMode === "double" && !isMobile;

    if (isDouble) {
      let leftPage: number;
      let rightPage: number;

      if (currentPage === 1) {
        leftPage = 0;
        rightPage = 1;
      } else {
        leftPage = currentPage % 2 === 0 ? currentPage : currentPage - 1;
        rightPage = leftPage + 1;
      }

      renderPageToCanvas(leftPage, canvasLeftRef.current, "left");
      renderPageToCanvas(rightPage, canvasRightRef.current, "right");
    } else {
      renderPageToCanvas(currentPage, canvasSingleRef.current, "single");
    }

    saveProgress(book.id, currentPage, numPages, user?.uid);
  }, [
    currentPage,
    numPages,
    prefs.layoutMode,
    prefs.zoom,
    isMobile,
    isFocusMode,
    loading,
    renderPageToCanvas,
    book.id,
    user?.uid,
  ]);

  // 6. Navigation Logic
  const handleNext = () => {
    if (isFlipping) return;
    registerActivity();
    const isDouble = prefs.layoutMode === "double" && !isMobile;
    const step = isDouble ? (currentPage === 1 ? 1 : 2) : 1;

    if (currentPage + step <= numPages + 1) {
      pageSound.playPageTurnSound();
      setSelectionPopover(null);
      setFlipDirection("next");
      setIsFlipping(true);
      setTimeout(() => {
        setCurrentPage((prev) => Math.min(numPages, prev + step));
        setIsFlipping(false);
      }, 360);
    }
  };

  const handlePrev = () => {
    if (isFlipping) return;
    registerActivity();
    const isDouble = prefs.layoutMode === "double" && !isMobile;
    const step = isDouble ? (currentPage <= 2 ? 1 : 2) : 1;

    if (currentPage - step >= 1) {
      pageSound.playPageTurnSound();
      setSelectionPopover(null);
      setFlipDirection("prev");
      setIsFlipping(true);
      setTimeout(() => {
        setCurrentPage((prev) => Math.max(1, prev - step));
        setIsFlipping(false);
      }, 360);
    }
  };

  const handleJumpToPage = (target: number) => {
    registerActivity();
    if (target >= 1 && target <= numPages) {
      setSelectionPopover(null);
      setCurrentPage(target);
      setShowJumpModal(false);
      setIsTocOpen(false);
      setIsSearchInBookOpen(false);
    }
  };

  // 7. Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // 7b. Focus Mode Toggle with Automatic Native Fullscreen
  const toggleFocusMode = useCallback(
    (enable?: boolean) => {
      const nextState = typeof enable === "boolean" ? enable : !isFocusMode;
      setIsFocusMode(nextState);

      if (nextState) {
        if (!document.fullscreenElement && containerRef.current) {
          containerRef.current.requestFullscreen().catch(() => {});
          setIsFullscreen(true);
        }
        showToast("Focus Mode On ✨");
      } else {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          setIsFullscreen(false);
        }
        showToast("Focus Mode Off");
      }
    },
    [isFocusMode, showToast]
  );

  // 7c. Focus Session Countdown & Lifecycle Helpers
  const formatSessionTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, []);

  const handleCompleteSession = useCallback((explicitTargetSecs?: number) => {
    if (sessionCompletedRef.current) return;
    sessionCompletedRef.current = true;

    setSessionStatus("COMPLETED");
    sessionEndTimeRef.current = null;
    setIsSessionCompleteOpen(true);

    const targetSecs = explicitTargetSecs || sessionDurationRef.current || SESSION_DURATION_SECONDS;
    const targetMins = Math.max(1, Math.round(targetSecs / 60));

    // 1. Flush any pending un-flushed seconds from the 1s interval
    let flushed = 0;
    if (accumulatedSecondsRef.current > 0) {
      flushed = accumulatedSecondsRef.current;
      accumulatedSecondsRef.current = 0;
      recordActiveReadingRef.current(flushed);
      addBookReadingTimeRef.current(book.id, flushed);
    }

    // 2. Guarantee full session duration is credited to today's reading activity
    const curSession = activeSessionRef.current;
    const currentSessionElapsed = (curSession?.elapsedSeconds || 0) + flushed;
    const missingDelta = Math.max(0, targetSecs - currentSessionElapsed);

    if (missingDelta > 0) {
      recordActiveReadingRef.current(missingDelta);
      addBookReadingTimeRef.current(book.id, missingDelta);
    }

    // 3. Record completed session in memory timeline
    recordSessionEventRef.current({
      bookId: book.id,
      timestamp: Date.now(),
      startPage: sessionStartPageRef.current,
      endPage: currentPageRef.current,
      durationSeconds: targetSecs,
      highlightsAdded: sessionMarksCountRef.current,
      notesAdded: 0,
      bookmarksAdded: 0,
    });

    // 4. End session in context
    endReadingSessionRef.current();

    // 5. Success and Streak Toast Notifications
    showToastRef.current(`🎉 ${targetMins}-minute Focus Session Successfully Completed!`);

    setTimeout(() => {
      showToastRef.current("🔥 Streak is ON! Your Diwali Diya is lit! ✨");
    }, 1200);
  }, [book.id]);

  useEffect(() => {
    handleCompleteSessionRef.current = handleCompleteSession;
  }, [handleCompleteSession]);

  const handleStartFocusSession = useCallback((chosenMinutes?: number) => {
    sessionCompletedRef.current = false;
    const mins = chosenMinutes || sessionTargetMinutes || 15;
    const targetSecs = mins * 60;
    sessionDurationRef.current = targetSecs;
    const endTime = Date.now() + targetSecs * 1000;
    sessionEndTimeRef.current = endTime;
    sessionStartPageRef.current = currentPage;
    sessionMarksCountRef.current = 0;
    setSessionRemainingSeconds(targetSecs);
    setSessionStatus("ACTIVE");
    setIsSessionModalOpen(false);

    // 1. Activate Focus Mode
    setIsFocusMode(true);

    // 2. Request native browser Fullscreen
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    }

    // 3. Sync structured session with context
    startReadingSession(book.id, currentPage, mins);
    showToast(`Focus Session Started: ${mins}:00 countdown active ⏱️✨`);
  }, [currentPage, sessionTargetMinutes, startReadingSession, book.id, showToast]);

  const requestExitFocusMode = useCallback(() => {
    if (sessionStatusRef.current === "ACTIVE") {
      setSessionStatus("EXIT_CONFIRM");
    } else {
      toggleFocusMode(false);
    }
  }, [toggleFocusMode]);

  const handleContinueSession = useCallback(() => {
    setSessionStatus("ACTIVE");
    setIsFocusMode(true);
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    }
  }, []);

  const handleAbandonSession = useCallback(() => {
    sessionCompletedRef.current = false;
    setSessionStatus("IDLE");
    sessionEndTimeRef.current = null;
    const resetSecs = sessionDurationRef.current || SESSION_DURATION_SECONDS;
    setSessionRemainingSeconds(resetSecs);
    endReadingSession();
    toggleFocusMode(false);
    showToast("Session cancelled. Reading progress was preserved.");
  }, [endReadingSession, toggleFocusMode, showToast]);

  // Floating Focus Timer Drag Handlers
  const handleTimerDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!timerOverlayRef.current) return;
    const rect = timerOverlayRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    isDraggingTimerRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTimerRef.current) return;
      const newX = Math.min(Math.max(12, moveEvent.clientX - dragOffsetRef.current.x), window.innerWidth - 190);
      const newY = Math.min(Math.max(12, moveEvent.clientY - dragOffsetRef.current.y), window.innerHeight - 70);
      setTimerPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      isDraggingTimerRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      const finalX = Math.min(Math.max(12, upEvent.clientX - dragOffsetRef.current.x), window.innerWidth - 190);
      const finalY = Math.min(Math.max(12, upEvent.clientY - dragOffsetRef.current.y), window.innerHeight - 70);
      saveTimerPrefs({ x: finalX, y: finalY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleTimerTouchStart = (e: React.TouchEvent) => {
    if (!timerOverlayRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = timerOverlayRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
    isDraggingTimerRef.current = true;

    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (!isDraggingTimerRef.current || moveEvent.touches.length === 0) return;
      const t = moveEvent.touches[0];
      const newX = Math.min(Math.max(12, t.clientX - dragOffsetRef.current.x), window.innerWidth - 190);
      const newY = Math.min(Math.max(12, t.clientY - dragOffsetRef.current.y), window.innerHeight - 70);
      setTimerPosition({ x: newX, y: newY });
    };

    const handleTouchEnd = () => {
      isDraggingTimerRef.current = false;
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      if (timerPosition) {
        saveTimerPrefs({ x: timerPosition.x, y: timerPosition.y });
      }
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
  };

  // Dedicated Session Countdown Timer Effect
  useEffect(() => {
    if (sessionStatus !== "ACTIVE" || !sessionEndTimeRef.current) return;

    const updateCountdown = () => {
      if (!sessionEndTimeRef.current) return;
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((sessionEndTimeRef.current - now) / 1000));
      setSessionRemainingSeconds(remaining);

      if (remaining === 0) {
        // 00:00 -> SUCCESSFUL COMPLETION
        handleCompleteSessionRef.current?.();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 500);
    return () => clearInterval(interval);
  }, [sessionStatus]);

  // 7c. Contextual Page Spread Text Extractor (Current Spread Only)
  const extractSpreadText = useCallback(async () => {
    if (!pdfDocRef.current || numPages === 0) return [];
    const isDouble = prefs.layoutMode === "double" && !isMobile;
    const pageNums: number[] = [];

    if (isDouble) {
      const left = currentPage === 1 ? 0 : currentPage % 2 === 0 ? currentPage : currentPage - 1;
      const right = currentPage === 1 ? 1 : left + 1;
      if (left >= 1 && left <= numPages) pageNums.push(left);
      if (right >= 1 && right <= numPages) pageNums.push(right);
    } else {
      if (currentPage >= 1 && currentPage <= numPages) pageNums.push(currentPage);
    }

    const extracts: PageExtract[] = [];
    for (const pNum of pageNums) {
      try {
        const page = await pdfDocRef.current.getPage(pNum);
        const textContent = await page.getTextContent();
        const text = normalizePdfText(textContent.items as any);
        extracts.push({ pageNum: pNum, text });
      } catch (err) {
        console.warn(`Failed to extract text for page ${pNum}`, err);
      }
    }
    return extracts;
  }, [currentPage, numPages, prefs.layoutMode, isMobile]);

  // 7d. Perform Contextual Translation
  const handlePerformTranslation = useCallback(
    async (target?: TranslationTarget) => {
      const targetLang = target || translationTarget;
      if (translationAbortControllerRef.current) {
        translationAbortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      translationAbortControllerRef.current = abortController;
      const reqId = ++translationReqIdRef.current;

      setIsTranslating(true);
      const extracts = await extractSpreadText();
      setCurrentSpreadExtracts(extracts);

      // Check cache first for instant load
      const cached = getCachedTranslation(book.id, extracts, targetLang);
      if (cached) {
        setTranslationResult(cached);
        setIsTranslating(false);
        return;
      }

      if (!canTranslateSpread()) {
        setIsTranslating(false);
        openProModal("You have reached today's free limit of 10 translated page spreads. Upgrade to Reader Pro for unlimited translations.");
        return;
      }

      const res = await translatePageSpread({
        bookId: book.id,
        pages: extracts,
        targetLanguage: targetLang,
        signal: abortController.signal,
      });

      // Stale request protection (Phase 37)
      if (reqId === translationReqIdRef.current) {
        if (res.success) {
          recordTranslationSpread();
        }
        setTranslationResult(res);
        setIsTranslating(false);
      }
    },
    [book.id, extractSpreadText, translationTarget, canTranslateSpread, recordTranslationSpread, openProModal]
  );

  // 7e. Auto-Reset Translation on Page Flip (Phase 4 & 36)
  useEffect(() => {
    setTranslationResult(null);
    setIsTranslating(false);
    if (translationAbortControllerRef.current) {
      translationAbortControllerRef.current.abort();
    }
  }, [currentPage]);

  // 7f. Fullscreen-Only Translation Handler (Requirement 1: Smooth Fullscreen + Translation)
  const handleOpenTranslation = useCallback(async () => {
    if (!document.fullscreenElement && containerRef.current) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.warn("Fullscreen request error:", err);
      }
    }
    setIsTranslateOpen(true);
    const extracts = await extractSpreadText();
    setCurrentSpreadExtracts(extracts);
    const cached = getCachedTranslation(book.id, extracts, translationTarget);
    if (cached) {
      setTranslationResult(cached);
    }
  }, [book.id, extractSpreadText, translationTarget]);

  // 7g. Fullscreen change listener to auto-close translation on exit
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      if (!isFs) {
        setIsTranslateOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // 8. Bookmarks Toggle
  const handleToggleBookmark = () => {
    registerActivity();
    sessionMarksCountRef.current += 1;
    const isCurrentBookmarked = bookmarks.some((b) => b.page === currentPage);
    if (isCurrentBookmarked) {
      const bm = bookmarks.find((b) => b.page === currentPage);
      if (bm) {
        deleteBookmark(book.id, bm.id, user?.uid);
        const updatedBms = getBookmarks(book.id, user?.uid);
        setBookmarks(updatedBms);
        if (user?.uid) {
          syncBookmarksToCloud(user.uid, book.id, updatedBms);
        }
        showToast(`Removed bookmark from Page ${currentPage} 🔖`);
      }
    } else {
      saveBookmark(book.id, currentPage, `Page ${currentPage} Bookmark`, user?.uid);
      const updatedBms = getBookmarks(book.id, user?.uid);
      setBookmarks(updatedBms);
      if (user?.uid) {
        syncBookmarksToCloud(user.uid, book.id, updatedBms);
      }
      showToast(`Bookmarked Page ${currentPage} 🔖`);
    }
  };

  // 9. Offline Cache Toggle
  const handleToggleOffline = async () => {
    if (!book.pdf) return;
    if (isOfflineSaved) {
      await removeBookOffline(book.id, book.pdf);
      setIsOfflineSaved(false);
    } else {
      const ok = await saveBookOffline(book.id, book.pdf);
      if (ok) setIsOfflineSaved(true);
    }
  };

  // 10. Search Inside Book Logic (Ctrl+F)
  const handleSearchInBook = async (queryText: string) => {
    if (!queryText.trim() || !pdfDocRef.current) {
      setSearchMatches([]);
      return;
    }

    setIsSearchingBook(true);
    const q = queryText.toLowerCase().trim();
    const matches: SearchMatch[] = [];

    try {
      for (let p = 1; p <= numPages; p++) {
        let text = pdfTextCacheRef.current[p];
        if (!text) {
          const page = await pdfDocRef.current.getPage(p);
          const content = await page.getTextContent();
          text = content.items.map((it: any) => it.str).join(" ");
          pdfTextCacheRef.current[p] = text;
        }

        if (text.toLowerCase().includes(q)) {
          const idx = text.toLowerCase().indexOf(q);
          const snippet = text.substring(Math.max(0, idx - 30), Math.min(text.length, idx + q.length + 40));
          matches.push({
            page: p,
            matchSnippet: snippet,
          });
        }
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(0);
      if (matches.length > 0) {
        setCurrentPage(matches[0].page);
        showToast(`Found ${matches.length} matches in "${book.title}"`);
      } else {
        showToast(`No matches found for "${queryText}"`);
      }
    } catch (e) {
      console.warn("Search inside book error:", e);
    } finally {
      setIsSearchingBook(false);
    }
  };

  const handleNextSearchMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIdx);
    setCurrentPage(searchMatches[nextIdx].page);
  };

  const handlePrevSearchMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIdx);
    setCurrentPage(searchMatches[prevIdx].page);
  };

  // 11. Undo & Redo Handlers
  const handleStrokesChange = (page: number, newStrokes: DrawingStroke[]) => {
    registerActivity();
    sessionMarksCountRef.current += 1;
    const prevStrokes = annotations.drawings[page] || [];

    setUndoStack((prev) => ({
      ...prev,
      [page]: [...(prev[page] || []), prevStrokes],
    }));

    setRedoStack((prev) => ({
      ...prev,
      [page]: [],
    }));

    savePageDrawings(book.id, page, newStrokes, user?.uid);
    const updated = getBookAnnotations(book.id, user?.uid);
    setAnnotations(updated);
    if (user?.uid) {
      syncAnnotationsToCloud(user.uid, book.id, updated);
    }
  };

  const handleUndo = (page: number) => {
    const pageUndo = undoStack[page] || [];
    if (pageUndo.length === 0) return;

    const previousState = pageUndo[pageUndo.length - 1];
    const currentStrokes = annotations.drawings[page] || [];

    setRedoStack((prev) => ({
      ...prev,
      [page]: [...(prev[page] || []), currentStrokes],
    }));

    setUndoStack((prev) => ({
      ...prev,
      [page]: pageUndo.slice(0, -1),
    }));

    savePageDrawings(book.id, page, previousState, user?.uid);
    const updated = getBookAnnotations(book.id, user?.uid);
    setAnnotations(updated);
    if (user?.uid) {
      syncAnnotationsToCloud(user.uid, book.id, updated);
    }
    showToast("Undo action ↩️");
  };

  const handleRedo = (page: number) => {
    const pageRedo = redoStack[page] || [];
    if (pageRedo.length === 0) return;

    const nextState = pageRedo[pageRedo.length - 1];
    const currentStrokes = annotations.drawings[page] || [];

    setUndoStack((prev) => ({
      ...prev,
      [page]: [...(prev[page] || []), currentStrokes],
    }));

    setRedoStack((prev) => ({
      ...prev,
      [page]: pageRedo.slice(0, -1),
    }));

    savePageDrawings(book.id, page, nextState, user?.uid);
    const updated = getBookAnnotations(book.id, user?.uid);
    setAnnotations(updated);
    if (user?.uid) {
      syncAnnotationsToCloud(user.uid, book.id, updated);
    }
    showToast("Redo action ↪️");
  };

  const handleClearPageWithConfirmation = (page: number) => {
    const currentStrokes = annotations.drawings[page] || [];
    if (currentStrokes.length === 0) return;

    if (window.confirm(`Clear all drawings on Page ${page}?`)) {
      handleStrokesChange(page, []);
      showToast(`Page ${page} drawings cleared 🗑️`);
    }
  };

  // 12. Text Box Placement
  const handleSaveTextBox = () => {
    if (!textBoxDialog.text.trim() || !textBoxDialog.point) return;
    const currentStrokes = annotations.drawings[textBoxDialog.page] || [];
    const newStroke: DrawingStroke = {
      id: `text_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: "text",
      points: [textBoxDialog.point],
      color: penColor,
      width: 2,
      text: textBoxDialog.text.trim(),
      fontSize: 14,
    };
    handleStrokesChange(textBoxDialog.page, [...currentStrokes, newStroke]);
    setTextBoxDialog({ isOpen: false, page: 1, point: null, text: "" });
    showToast("Text annotation placed 🔤");
  };

  // 13. Keyboard Listeners (Ctrl+F for in-book search, Z for Focus Mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName);

      // Search Inside Book Shortcut (Ctrl+F or Cmd+F)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsSearchInBookOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      if (isInput) return;

      registerActivity();

      // Focus Mode Shortcut (Z)
      if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Zoom Shortcuts (Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0)
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        const nextZoom = Math.min(150, prefs.zoom + 10);
        updatePref("zoom", nextZoom);
        showToast(`Zoom: ${nextZoom}% 🔍`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        const nextZoom = Math.max(70, prefs.zoom - 10);
        updatePref("zoom", nextZoom);
        showToast(`Zoom: ${nextZoom}% 🔍`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "0")) {
        e.preventDefault();
        updatePref("zoom", 100);
        showToast("Zoom: 100% (Reset) 🔍");
        return;
      }

      // Undo / Redo Shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) handleRedo(currentPage);
        else handleUndo(currentPage);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        handleRedo(currentPage);
        return;
      }

      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          handleToggleBookmark();
          break;
        case "p":
          setIsStudyMode(true);
          setActiveTool("pen");
          break;
        case "h":
          setIsStudyMode(true);
          setActiveTool("highlighter");
          break;
        case "l":
          setIsStudyMode(true);
          setActiveTool("line");
          break;
        case "a":
          setIsStudyMode(true);
          setActiveTool("arrow");
          break;
        case "c":
          setIsStudyMode(true);
          setActiveTool("circle");
          break;
        case "r":
          setIsStudyMode(true);
          setActiveTool("rectangle");
          break;
        case "t":
          if (isStudyMode) {
            setActiveTool("text");
          } else {
            e.preventDefault();
            if (isTranslateOpen) {
              setIsTranslateOpen(false);
            } else {
              handleOpenTranslation();
            }
          }
          break;
        case "e":
          setIsStudyMode(true);
          setActiveTool("eraser");
          break;
        case "arrowright":
        case "pagedown":
        case " ":
          if (!isStudyMode) {
            e.preventDefault();
            handleNext();
          }
          break;
        case "arrowleft":
        case "pageup":
          if (!isStudyMode) {
            e.preventDefault();
            handlePrev();
          }
          break;
        case "home":
          e.preventDefault();
          setCurrentPage(1);
          break;
        case "end":
          e.preventDefault();
          if (numPages > 0) setCurrentPage(numPages);
          break;
        case "z":
          e.preventDefault();
          if (isFocusMode) {
            requestExitFocusMode();
          } else {
            toggleFocusMode(true);
          }
          break;
        case "escape":
          if (sessionStatusRef.current === "EXIT_CONFIRM") {
            handleContinueSession();
            break;
          }
          if (isTranslateOpen) { setIsTranslateOpen(false); break; }
          if (isSearchInBookOpen) { setIsSearchInBookOpen(false); break; }
          if (showSettings) { setShowSettings(false); break; }
          if (showJumpModal) { setShowJumpModal(false); break; }
          if (isAnnotationDrawerOpen) { setIsAnnotationDrawerOpen(false); break; }
          if (isTocOpen) { setIsTocOpen(false); break; }
          if (isMemoryOpen) { setIsMemoryOpen(false); break; }
          if (isSessionModalOpen) { setIsSessionModalOpen(false); break; }
          if (isSessionCompleteOpen) { setIsSessionCompleteOpen(false); break; }
          if (selectionPopover) { setSelectionPopover(null); break; }
          if (noteModal.isOpen) { setNoteModal((prev) => ({ ...prev, isOpen: false })); break; }
          if (textBoxDialog.isOpen) { setTextBoxDialog((prev) => ({ ...prev, isOpen: false })); break; }
          if (isStudyMode) { setIsStudyMode(false); break; }
          if (isFocusMode) { requestExitFocusMode(); break; }
          break;
      }
    };

    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement);
      setIsFullscreen(isFull);
      if (!isFull && sessionStatusRef.current === "ACTIVE") {
        setSessionStatus("EXIT_CONFIRM");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    numPages,
    currentPage,
    prefs.layoutMode,
    prefs.zoom,
    isMobile,
    isFlipping,
    showSettings,
    showJumpModal,
    isAnnotationDrawerOpen,
    isTocOpen,
    isMemoryOpen,
    isSessionModalOpen,
    isSessionCompleteOpen,
    isSearchInBookOpen,
    isFocusMode,
    toggleFocusMode,
    requestExitFocusMode,
    handleContinueSession,
    selectionPopover,
    noteModal.isOpen,
    textBoxDialog.isOpen,
    isStudyMode,
    undoStack,
    redoStack,
    bookmarks,
    registerActivity,
  ]);

  // 14. Pointer & Cursor Listeners
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    registerActivity();
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (
        !showSettings &&
        !showJumpModal &&
        !isAnnotationDrawerOpen &&
        !isTocOpen &&
        !isMemoryOpen &&
        !isSearchInBookOpen &&
        !isStudyMode &&
        !selectionPopover?.visible
      ) {
        setShowControls(false);
      }
    }, 4500);

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (cursorDotRef.current) {
        cursorDotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      }

      if (!cursorPos.visible) {
        setCursorPos({ x, y, visible: true });
      }
    }
  };

  const handlePointerLeave = () => {
    setCursorPos((prev) => ({ ...prev, visible: false }));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    registerActivity();
    if (isStudyMode) return;

    if (e.touches.length === 2) {
      setIsPinching(true);
      isPinchingRef.current = true;
      isPanningRef.current = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchStartDistRef.current = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchStartZoomRef.current = prefs.zoom;
      targetZoomRef.current = prefs.zoom;
      touchStartPanRef.current = { ...panOffset };
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartXRef.current = touch.clientX;
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      touchStartPanRef.current = { ...panOffset };
      isPinchingRef.current = false;
      if (prefs.zoom > 100) {
        isPanningRef.current = true;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isStudyMode) return;

    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const ratio = dist / touchStartDistRef.current;
      pendingScaleRef.current = ratio;
      targetZoomRef.current = Math.min(250, Math.max(70, Math.round(touchStartZoomRef.current * ratio)));

      if (!panRafRef.current) {
        panRafRef.current = requestAnimationFrame(() => {
          if (pendingScaleRef.current !== null) {
            setInteractiveScale(pendingScaleRef.current);
          }
          panRafRef.current = null;
        });
      }
    } else if (e.touches.length === 1 && isPanningRef.current && touchStartPosRef.current && prefs.zoom > 100) {
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPosRef.current.x;
      const dy = touch.clientY - touchStartPosRef.current.y;
      const zoomFactor = prefs.zoom / 100;
      const maxPanX = Math.max(60, (pageCanvasSize.width * zoomFactor - pageCanvasSize.width) / 2 + 60);
      const maxPanY = Math.max(60, (pageCanvasSize.height * zoomFactor - pageCanvasSize.height) / 2 + 60);

      const newX = Math.max(-maxPanX, Math.min(maxPanX, touchStartPanRef.current.x + dx));
      const newY = Math.max(-maxPanY, Math.min(maxPanY, touchStartPanRef.current.y + dy));
      pendingPanRef.current = { x: newX, y: newY };

      if (!panRafRef.current) {
        panRafRef.current = requestAnimationFrame(() => {
          if (pendingPanRef.current) {
            setPanOffset(pendingPanRef.current);
          }
          panRafRef.current = null;
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isStudyMode) return;

    if (e.touches.length === 0) {
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      setIsPinching(false);
      setInteractiveScale(1);

      // Commit final zoom once after gesture finishes so PDF.js re-renders crisp canvas only on lift
      if (isPinchingRef.current && targetZoomRef.current !== prefs.zoom) {
        updatePref("zoom", targetZoomRef.current);
      }

      const now = Date.now();
      if (now - lastTapTimeRef.current < 320) {
        if (prefs.zoom > 100) {
          updatePref("zoom", 100);
          setPanOffset({ x: 0, y: 0 });
        } else {
          updatePref("zoom", 150);
        }
      }
      lastTapTimeRef.current = now;

      if (prefs.zoom <= 100 && touchStartXRef.current !== null && e.changedTouches.length > 0) {
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartXRef.current - touchEndX;
        if (Math.abs(diff) > 45) {
          if (diff > 0) handleNext();
          else handlePrev();
        }
      }

      touchStartXRef.current = null;
      touchStartDistRef.current = null;
      touchStartPosRef.current = null;
      isPinchingRef.current = false;
      isPanningRef.current = false;
    }
  };

  // 15. Text Selection
  const handlePageMouseUp = (e: React.MouseEvent, pageNum: number) => {
    if (isStudyMode) return;
    registerActivity();
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";

    if (selectedText.length > 2 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top - 50;

      setSelectionPopover({
        visible: true,
        x: Math.max(80, Math.min(rect.width - 160, x)),
        y: Math.max(60, y),
        text: selectedText,
        page: pageNum,
      });
    }
  };

  const handleCreateHighlight = (color: HighlightItem["color"]) => {
    if (!selectionPopover) return;
    registerActivity();
    sessionMarksCountRef.current += 1;
    const newItem = addHighlight(
      book.id,
      {
        bookId: book.id,
        page: selectionPopover.page,
        text: selectionPopover.text,
        color,
      },
      user?.uid
    );
    setAnnotations((prev) => {
      const next = {
        ...prev,
        highlights: [...prev.highlights, newItem],
      };
      if (user?.uid) {
        syncAnnotationsToCloud(user.uid, book.id, next);
      }
      return next;
    });
    window.getSelection()?.removeAllRanges();
    setSelectionPopover(null);
    showToast("Text highlighted 🌟");
  };

  const handleOpenNoteModal = () => {
    if (!selectionPopover) return;
    setNoteModal({
      isOpen: true,
      page: selectionPopover.page,
      selectedText: selectionPopover.text,
      noteText: "",
    });
    setSelectionPopover(null);
  };

  const handleSaveNote = () => {
    if (!noteModal.noteText.trim()) return;
    registerActivity();
    sessionMarksCountRef.current += 1;
    const newNote = addNote(
      book.id,
      {
        bookId: book.id,
        page: noteModal.page,
        selectedText: noteModal.selectedText,
        note: noteModal.noteText.trim(),
      },
      user?.uid
    );
    setAnnotations((prev) => {
      const next = {
        ...prev,
        notes: [...prev.notes, newNote],
      };
      if (user?.uid) {
        syncAnnotationsToCloud(user.uid, book.id, next);
      }
      return next;
    });
    setNoteModal({ isOpen: false, page: 1, noteText: "" });
    showToast("Note saved 📝");
  };

  // ---------------------------------------------------------------------------
  // AI Reading Companion bridge (components/companion). Read-only context plus a few
  // allow-listed actions that reuse this reader's own navigation, bookmark and note logic.
  // ---------------------------------------------------------------------------
  const companionLastSelectionRef = useRef<{ text: string; pageNum: number } | null>(null);

  const getCompanionVisiblePages = (): number[] => {
    if (numPages === 0) return [];
    if (prefs.layoutMode === "double" && !isMobile) {
      const left = currentPage === 1 ? 0 : currentPage % 2 === 0 ? currentPage : currentPage - 1;
      const right = currentPage === 1 ? 1 : left + 1;
      return [left, right].filter((p) => p >= 1 && p <= numPages);
    }
    return currentPage >= 1 && currentPage <= numPages ? [currentPage] : [];
  };

  const companionLiveRef = useRef({
    snapshot: null as ReaderSnapshot | null,
    next: () => {},
    prev: () => {},
    jump: (_page: number) => {},
    addBookmarkAt: (_page: number): { ok: boolean; alreadyExisted?: boolean } => ({ ok: false }),
    addNoteAt: (_page: number, _text: string): boolean => false,
  });

  // Publish the latest committed reader state and handlers (runs before the notify effect below)
  useLayoutEffect(() => {
    if (selectionPopover?.text) {
      companionLastSelectionRef.current = { text: selectionPopover.text, pageNum: selectionPopover.page };
    }
    const visiblePages = getCompanionVisiblePages();
    const lastSelection = companionLastSelectionRef.current;
    // Real outline entries only (the fallback "Section — Page N" milestones are not chapters)
    const chapter = tableOfContents
      .filter((t) => t.page <= currentPage && !/^(Section — Page \d+|Opening & Front Matter)$/.test(t.title))
      .pop()?.title;

    companionLiveRef.current = {
      snapshot: {
        bookId: book.id,
        title: book.title,
        author: book.author,
        currentPage,
        totalPages: numPages,
        visiblePages,
        layout: prefs.layoutMode === "double" && !isMobile ? "double" : "single",
        chapter,
        selection: lastSelection && visiblePages.includes(lastSelection.pageNum) ? lastSelection : undefined,
        isLoaded: !loading && numPages > 0,
      },
      next: handleNext,
      prev: handlePrev,
      jump: handleJumpToPage,
      addBookmarkAt: (page: number) => {
        if (getBookmarks(book.id, user?.uid).some((b) => b.page === page)) return { ok: true, alreadyExisted: true };
        saveBookmark(book.id, page, `Page ${page} Bookmark`, user?.uid);
        const updatedBms = getBookmarks(book.id, user?.uid);
        setBookmarks(updatedBms);
        if (user?.uid) syncBookmarksToCloud(user.uid, book.id, updatedBms);
        showToast(`Bookmarked Page ${page} 🔖`);
        return { ok: updatedBms.some((b) => b.page === page) };
      },
      addNoteAt: (page: number, text: string) => {
        const newNote = addNote(book.id, { bookId: book.id, page, note: text }, user?.uid);
        if (!newNote) return false;
        setAnnotations((prev) => {
          const next = { ...prev, notes: [...prev.notes, newNote] };
          if (user?.uid) syncAnnotationsToCloud(user.uid, book.id, next);
          return next;
        });
        showToast("Note saved 📝");
        return true;
      },
    };
  });

  useEffect(() => {
    const textCache = new Map<number, string>();
    const live = () => companionLiveRef.current;
    const inRange = (page: number) => Number.isInteger(page) && page >= 1 && page <= numPagesRef.current;

    return registerReaderBridge({
      getSnapshot: () => live().snapshot!,
      getPageText: async (pageNum: number) => {
        if (!pdfDocRef.current || !inRange(pageNum)) return "";
        const cached = textCache.get(pageNum);
        if (cached !== undefined) return cached;
        try {
          const page = await pdfDocRef.current.getPage(pageNum);
          const content = await page.getTextContent();
          const text = normalizePdfText(content.items as any);
          textCache.set(pageNum, text);
          return text;
        } catch {
          return "";
        }
      },
      goToPage: (pageNum: number) => {
        if (!pdfDocRef.current || !inRange(pageNum)) return false;
        live().jump(pageNum);
        return true;
      },
      nextPage: () => {
        if (!pdfDocRef.current || currentPageRef.current >= numPagesRef.current) return false;
        live().next();
        return true;
      },
      previousPage: () => {
        if (!pdfDocRef.current || currentPageRef.current <= 1) return false;
        live().prev();
        return true;
      },
      addBookmark: (pageNum: number) => (inRange(pageNum) ? live().addBookmarkAt(pageNum) : { ok: false }),
      addNote: (pageNum: number, text: string) => (inRange(pageNum) && text.trim() ? live().addNoteAt(pageNum, text.trim()) : false),
    });
  }, [book.id]);

  useEffect(() => {
    notifyReaderChanged();
  }, [currentPage, numPages, loading, prefs.layoutMode, isMobile, tableOfContents, selectionPopover]);

  // Visual Tone Filter
  const getFilterStyle = (): React.CSSProperties => {
    const filters: string[] = [];
    if (prefs.brightness !== 100) filters.push(`brightness(${prefs.brightness}%)`);
    if (prefs.contrast !== 100) filters.push(`contrast(${prefs.contrast}%)`);
    if (prefs.readingMode === "sepia") {
      filters.push(`sepia(${Math.max(45, prefs.warmth || 45)}%) brightness(95%) contrast(94%)`);
    } else if (prefs.readingMode === "dark") {
      filters.push(`invert(88%) hue-rotate(180deg) brightness(92%) contrast(88%)`);
    } else if (prefs.readingMode === "dim") {
      filters.push(`brightness(80%) sepia(18%)`);
    } else if (prefs.warmth > 0) {
      filters.push(`sepia(${prefs.warmth}%)`);
    }
    return {
      filter: filters.length > 0 ? filters.join(" ") : undefined,
      transition: "filter 0.3s ease",
    };
  };

  const getPageBgColor = () => {
    switch (prefs.readingMode) {
      case "sepia": return "#f5eedd";
      case "dark": return "#151821";
      case "dim": return "#ded7cc";
      default: return "#ffffff";
    }
  };

  const isDouble = prefs.layoutMode === "double" && !isMobile;
  const progressPercent = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;
  const isBookComplete = numPages > 0 && currentPage >= numPages;

  const activeLeftPage = isDouble ? (currentPage === 1 ? 0 : currentPage % 2 === 0 ? currentPage : currentPage - 1) : currentPage;
  const activeRightPage = isDouble ? (currentPage === 1 ? 1 : activeLeftPage + 1) : currentPage;

  const pageAnnotationCount = (p: number) => {
    const hlCount = annotations.highlights.filter((h) => h.page === p).length;
    const noteCount = annotations.notes.filter((n) => n.page === p).length;
    const drawCount = annotations.drawings[p]?.length || 0;
    const bmCount = bookmarks.filter((b) => b.page === p).length;
    return hlCount + noteCount + drawCount + bmCount;
  };

  const isCurrentPageBookmarked = bookmarks.some((b) => b.page === currentPage);
  const totalAnnotationsCount =
    (annotations.highlights?.length || 0) +
    (annotations.notes?.length || 0) +
    Object.keys(annotations.drawings || {}).length +
    bookmarks.length;

  const currentColor = activeTool === "highlighter" ? highlighterColor : penColor;

  return (
    <div
      ref={containerRef}
      data-study-active={isStudyMode ? "true" : "false"}
      onMouseMove={handlePointerMove}
      onMouseEnter={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative select-none overflow-hidden rounded-3xl border border-[var(--border)] bg-[#0a0c10] shadow-2xl flex flex-col justify-between transition-all duration-300 ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none h-screen w-screen" : "w-full min-h-[540px] sm:min-h-[640px] h-[700px] sm:h-[830px]"
      }`}
      style={{
        background: isMobile
          ? getPageBgColor()
          : prefs.readingMode === "sepia"
          ? "radial-gradient(ellipse at center, #261f18 0%, #100d09 100%)"
          : prefs.readingMode === "dark"
          ? "radial-gradient(ellipse at center, #0e111a 0%, #040508 100%)"
          : "radial-gradient(ellipse at center, #151924 0%, #06080c 100%)",
      }}
    >
      {/* -------------------------------------------------------------
       * Study Mode Tool Reticle (Pen / Highlighter / Eraser preview)
       * ------------------------------------------------------------- */}
      {isStudyMode && (
        <div
          ref={cursorDotRef}
          className={`pointer-events-none absolute top-0 left-0 z-[9999] transition-opacity duration-150 ${
            cursorPos.visible ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          <div className="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
            <div
              className="rounded-full border border-white shadow-md transition-all"
              style={{
                width: `${activeTool === "highlighter" ? Math.max(14, strokeWidth * 3) : Math.max(8, strokeWidth * 2)}px`,
                height: `${activeTool === "highlighter" ? Math.max(14, strokeWidth * 3) : Math.max(8, strokeWidth * 2)}px`,
                backgroundColor: activeTool === "eraser" ? "rgba(255,255,255,0.75)" : currentColor,
                opacity: activeTool === "highlighter" ? 0.6 : 1.0,
              }}
            />
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Focus Mode Floating Top Status & Controls (Mobile Edge-to-Edge Wireframe Compliant)
       * ------------------------------------------------------------- */}
      {isFocusMode && (
        <div className="absolute top-2 sm:top-4 inset-x-2 sm:inset-x-auto sm:right-4 z-40 flex items-center justify-between sm:justify-end gap-1.5 sm:gap-2 animate-fade-in bg-[var(--card)]/95 sm:bg-transparent p-1.5 sm:p-0 rounded-2xl border sm:border-0 border-[var(--border)] backdrop-blur-xl sm:backdrop-blur-none shadow-xl sm:shadow-none">
          {/* Mobile Left: Study/Drawing Suite Toggle & Bookmark */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsStudyMode(!isStudyMode)}
              aria-label="Toggle Drawing and Annotations"
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                isStudyMode
                  ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)] shadow-md"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Toggle Drawing & Annotation Suite (P)"
            >
              <span>🎨</span>
              <span className="hidden sm:inline">Draw</span>
            </button>

            {/* Quick Bookmark Toggle in Focus Mode */}
            <button
              onClick={handleToggleBookmark}
              aria-label={isCurrentPageBookmarked ? "Remove Bookmark" : "Bookmark this Page"}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer ${
                isCurrentPageBookmarked
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-xs"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Bookmark this Page (B)"
            >
              <span>{isCurrentPageBookmarked ? "🔖" : "📑"}</span>
              <span className="hidden md:inline">Bookmark</span>
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Structured Reading Session in Focus Mode */}
            <button
              onClick={() => {
                if (sessionStatus === "ACTIVE") {
                  if (!isTimerVisible) {
                    setIsTimerVisible(true);
                    saveTimerPrefs({ isVisible: true });
                  }
                } else {
                  setIsSessionModalOpen(true);
                }
              }}
              aria-label="Structured Reading Session"
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer shadow-md ${
                sessionStatus === "ACTIVE"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title={sessionStatus === "ACTIVE" ? "Active Focus Session Timer" : "Start Dedicated Reading Session"}
            >
              <span>⏱️</span>
              <span className="hidden sm:inline">
                {sessionStatus === "ACTIVE"
                  ? `${formatSessionTime(sessionRemainingSeconds)} left`
                  : "Session"}
              </span>
            </button>

            {/* Contextual Translation Button in Focus Mode */}
            <button
              onClick={() => {
                if (isTranslateOpen) {
                  setIsTranslateOpen(false);
                } else {
                  handleOpenTranslation();
                }
              }}
              aria-label="Translate Current Spread in Focus Mode"
              className={`p-1.5 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold transition-all shadow-md flex items-center gap-1 cursor-pointer ${
                isTranslateOpen
                  ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)]"
                  : "bg-[var(--secondary)] border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)]"
              }`}
              title="Translate Current Spread (T)"
            >
              <span>🌐</span>
              <span className="hidden sm:inline">Translate</span>
            </button>

            {/* Eye Comfort & Lighting Controls in Focus Mode */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Eye Comfort and Lighting Controls"
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer shadow-md ${
                showSettings
                  ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)]"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Eye Comfort & Lighting Controls"
            >
              <span>🔆</span>
            </button>

            {/* Exit Focus Mode Button */}
            <button
              onClick={requestExitFocusMode}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold hover:opacity-95 shadow-md flex items-center gap-1 cursor-pointer"
              title={sessionStatus === "ACTIVE" ? "End Active Focus Session" : "Exit Focus Mode (Z)"}
            >
              <span>✕</span>
              <span>{sessionStatus === "ACTIVE" ? "End" : "Exit"}</span>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Focus Mode Floating Draggable Timer Overlay (Theme Adaptive & Viewport Fixed)
       * ------------------------------------------------------------- */}
      {isFocusMode && sessionStatus === "ACTIVE" && isTimerVisible && (
        <div
          ref={timerOverlayRef}
          style={{
            position: "fixed",
            left: timerPosition ? `${timerPosition.x}px` : "auto",
            top: timerPosition ? `${timerPosition.y}px` : "5rem",
            right: timerPosition ? "auto" : "1.5rem",
            zIndex: 50,
            touchAction: "none",
          }}
          className="select-none animate-fade-in"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[var(--card)]/90 backdrop-blur-2xl border border-[var(--border)] shadow-2xl hover:border-[var(--accent)]/50 transition-colors">
            {/* Drag Handle */}
            <div
              onMouseDown={handleTimerDragStart}
              onTouchStart={handleTimerTouchStart}
              className="cursor-grab active:cursor-grabbing text-[var(--text-secondary)] hover:text-[var(--foreground)] flex items-center pr-1 border-r border-[var(--border)]/60 select-none py-0.5"
              title="Drag to reposition timer"
              aria-label="Drag Timer"
            >
              <span className="text-xs font-mono tracking-tighter opacity-70">⋮⋮</span>
            </div>

            {/* Pulsing Theme Accent Dot & Live Countdown */}
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]" />
              </span>

              <span className="font-mono text-sm sm:text-base font-extrabold text-[var(--foreground)] tracking-wider tabular-nums">
                {formatSessionTime(sessionRemainingSeconds)}
              </span>
            </div>

            {/* Hide / Minimize Button */}
            <button
              onClick={() => {
                setIsTimerVisible(false);
                saveTimerPrefs({ isVisible: false });
              }}
              className="ml-0.5 p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors cursor-pointer"
              title="Hide Floating Timer"
              aria-label="Hide Timer"
            >
              <span className="text-[11px] block font-bold leading-none">✕</span>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Top Floating Minimalist Reader Toolbar (Hidden in Focus Mode)
       * ------------------------------------------------------------- */}
      {!isFocusMode && (
        <div
          className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between px-2.5 sm:px-6 py-2 sm:py-2.5 bg-[var(--card)]/90 backdrop-blur-xl border-b border-[var(--border)]/70 transition-all duration-300 gap-2 ${
            showControls ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
          }`}
        >
          {/* Chapter Outline & Search inside Book (Hidden on mobile phones, visible on tablet/desktop) */}
          <div className="hidden sm:flex items-center gap-1 sm:gap-2.5 min-w-0 flex-shrink-0">
            <button
              onClick={() => setIsTocOpen(true)}
              className="p-1.5 sm:p-2 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border border-[var(--border)] transition-all cursor-pointer flex items-center gap-1 text-xs"
              title="Table of Contents & Chapters"
            >
              <span>📑</span>
              <span className="hidden sm:inline font-semibold">Chapters</span>
            </button>

            <button
              onClick={() => {
                setIsSearchInBookOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className="p-1.5 sm:p-2 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border border-[var(--border)] transition-all cursor-pointer flex items-center gap-1 text-xs"
              title="Search Inside Book (Ctrl+F)"
            >
              <span>🔍</span>
              <span className="hidden sm:inline font-semibold">Find</span>
            </button>

            {/* Page Thumbnail Navigator */}
            <button
              onClick={() => setIsThumbnailDrawerOpen(true)}
              className="p-1.5 sm:p-2 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border border-[var(--border)] transition-all cursor-pointer flex items-center gap-1 text-xs"
              title="Page Grid Navigator"
            >
              <span>▦</span>
              <span className="hidden sm:inline font-semibold">Pages</span>
            </button>

            <div className="hidden md:flex flex-col text-left truncate ml-1">
              <h3 className="text-xs sm:text-sm font-bold font-serif text-[var(--foreground)] truncate max-w-[110px] sm:max-w-xs">
                {book.title}
              </h3>
              <p className="text-[10px] text-[var(--text-secondary)] truncate">
                {book.author}
              </p>
            </div>
          </div>

          {/* Quick Toolbar Actions (Edge-to-edge touch scrollable on mobile) */}
          <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none max-w-full py-0.5 min-w-0">
            {/* Structured Reading Session */}
            <button
              onClick={() => {
                if (sessionStatus === "ACTIVE") {
                  setIsFocusMode(true);
                  if (!document.fullscreenElement && containerRef.current) {
                    containerRef.current.requestFullscreen().catch(() => {});
                    setIsFullscreen(true);
                  }
                } else {
                  setIsSessionModalOpen(true);
                }
              }}
              aria-label="Start Structured Reading Session"
              className={`p-1.5 sm:px-3 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
                sessionStatus === "ACTIVE"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-xs animate-pulse"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Start 15-minute Dedicated Focus Session"
            >
              <span>⏱️</span>
              <span className="hidden sm:inline">
                {sessionStatus === "ACTIVE"
                  ? `${formatSessionTime(sessionRemainingSeconds)} left`
                  : "15m Session"}
              </span>
            </button>

            {/* Focus Mode Button */}
            <button
              onClick={() => toggleFocusMode(true)}
              aria-label="Enter Distraction-Free Focus Mode"
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs font-semibold border border-[var(--border)] transition-all flex items-center gap-1 cursor-pointer flex-shrink-0"
              title="Enter Distraction-Free Focus Mode (Z)"
            >
              <span>🎯</span>
              <span className="hidden md:inline">Focus</span>
            </button>

            {/* Offline Save */}
            <button
              onClick={handleToggleOffline}
              aria-label={isOfflineSaved ? "Remove Offline Copy" : "Save Book for Offline Reading"}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
                isOfflineSaved
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border-[var(--border)]"
              }`}
              title={isOfflineSaved ? "Available Offline (Click to remove)" : "Save Book for Offline Reading"}
            >
              <span>{isOfflineSaved ? "✓" : "📦"}</span>
              <span className="hidden md:inline">{isOfflineSaved ? "Offline" : "Save"}</span>
            </button>

            {/* Reading Memory */}
            <button
              onClick={() => setIsMemoryOpen(true)}
              aria-label="Open My Reading Memory"
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs font-semibold border border-[var(--border)] transition-all flex items-center gap-1 cursor-pointer flex-shrink-0"
              title="Open My Reading Memory"
            >
              <span>🧠</span>
              <span className="hidden md:inline">Memory</span>
            </button>

            {/* Bookmark Button */}
            <button
              onClick={handleToggleBookmark}
              aria-label={isCurrentPageBookmarked ? "Remove Bookmark" : "Bookmark this Page"}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
                isCurrentPageBookmarked
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-xs"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Bookmark this Page (B)"
            >
              <span>{isCurrentPageBookmarked ? "🔖" : "📑"}</span>
            </button>

            {/* Layout Mode Toggle */}
            {!isMobile && (
              <button
                onClick={() => updatePref("layoutMode", isDouble ? "single" : "double")}
                aria-label={isDouble ? "Switch to Single Page" : "Switch to Open Book 2-Page"}
                className="px-2 py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs font-semibold border border-[var(--border)] transition-all cursor-pointer hidden md:flex items-center gap-1 flex-shrink-0"
                title={isDouble ? "Switch to Single Page" : "Switch to Open Book (2-Page)"}
              >
                <span>{isDouble ? "📖" : "📄"}</span>
              </button>
            )}

            {/* Contextual Translation Button */}
            <button
              onClick={() => {
                if (isTranslateOpen) {
                  setIsTranslateOpen(false);
                } else {
                  handleOpenTranslation();
                }
              }}
              aria-label="Translate Current Page Spread"
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
                isTranslateOpen
                  ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)] shadow-md"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Translate Current Pages (T)"
            >
              <span>🌐</span>
              <span className="hidden md:inline">Translate</span>
            </button>

            {/* Study Mode Toggle */}
            <button
              onClick={() => setIsStudyMode(!isStudyMode)}
              aria-label="Toggle Study and Annotation Suite"
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
                isStudyMode
                  ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)] shadow-md"
                  : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
              }`}
              title="Toggle Study & Annotation Suite (P)"
            >
              <span>🎨</span>
            </button>

            {/* Notes Drawer */}
            <button
              onClick={() => setIsAnnotationDrawerOpen(true)}
              aria-label="View Highlights, Notes and Bookmarks"
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs font-semibold border border-[var(--border)] transition-all flex items-center gap-1 cursor-pointer flex-shrink-0"
              title="View Highlights, Notes & Bookmarks"
            >
              <span>📌</span>
              {totalAnnotationsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[var(--accent)] text-[var(--primary-foreground)] text-[10px] font-bold">
                  {totalAnnotationsCount}
                </span>
              )}
            </button>

            {/* Lighting Controls */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Eye Comfort and Lighting Controls"
              className="p-1.5 sm:p-2 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs border border-[var(--border)] transition-all cursor-pointer flex-shrink-0"
              title="Eye Comfort & Lighting Controls"
            >
              <span>🔆</span>
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              aria-label="Toggle Fullscreen"
              className="p-1.5 sm:p-2 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] text-xs border border-[var(--border)] transition-all cursor-pointer flex-shrink-0"
              title="Toggle Fullscreen (F)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Search Inside Book Floating Bar (Ctrl+F)
       * ------------------------------------------------------------- */}
      {isSearchInBookOpen && (
        <div className="absolute top-14 inset-x-0 z-40 p-3 bg-[var(--card)]/95 backdrop-blur-2xl border-b border-[var(--border)] shadow-2xl flex items-center justify-between gap-3 animate-fade-in text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <span className="text-base">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              value={bookSearchQuery}
              onChange={(e) => setBookSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearchInBook(bookSearchQuery);
              }}
              placeholder="Find inside this book... (Press Enter)"
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => handleSearchInBook(bookSearchQuery)}
              disabled={isSearchingBook}
              className="px-3 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold cursor-pointer"
            >
              {isSearchingBook ? "..." : "Search"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-secondary)]">
                <span>
                  {currentMatchIndex + 1} of {searchMatches.length} matches (Page {searchMatches[currentMatchIndex]?.page})
                </span>
                <button
                  onClick={handlePrevSearchMatch}
                  className="p-1 rounded bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)]"
                  title="Previous Match"
                >
                  ↑
                </button>
                <button
                  onClick={handleNextSearchMatch}
                  className="p-1 rounded bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)]"
                  title="Next Match"
                >
                  ↓
                </button>
              </div>
            )}
            <button
              onClick={() => setIsSearchInBookOpen(false)}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Structured Focus Reading Session Setup Modal
       * ------------------------------------------------------------- */}
      {isSessionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in text-left">
          <div className="glass-card rounded-3xl p-6 border border-[var(--border)] bg-[var(--card)] max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">⏱️</span>
                <h4 className="font-serif font-bold text-base text-[var(--foreground)]">
                  Focus Reading Session
                </h4>
              </div>
              <button
                onClick={() => setIsSessionModalOpen(false)}
                className="w-7 h-7 rounded-xl bg-[var(--secondary)] text-xs hover:text-[var(--foreground)] flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Enter a dedicated distraction-free reading session with full immersion, countdown tracking, and reading memory logging.
            </p>

            {/* Duration Selector: 15 min / 25 min / 30 min / 45 min / 60 min */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--foreground)] block">
                Select Session Duration
              </label>
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {SESSION_PRESETS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setSessionTargetMinutes(mins)}
                    className={`py-2 px-1 sm:px-2 rounded-2xl text-xs font-bold font-mono transition-all border cursor-pointer flex flex-col items-center gap-0.5 ${
                      sessionTargetMinutes === mins
                        ? "bg-[var(--accent)] text-[var(--primary-foreground)] border-[var(--accent)] shadow-md scale-[1.02]"
                        : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] border-[var(--border)]"
                    }`}
                  >
                    <span>{mins}m</span>
                    <span className="text-[10px] font-sans font-normal opacity-80">goal</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-[var(--secondary)]/50 border border-[var(--border)] flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-[var(--foreground)]">Environment</span>
                <p className="text-[11px] text-[var(--text-secondary)]">Fullscreen &amp; Focus Mode</p>
              </div>
              <span className="px-3 py-1 rounded-xl bg-[var(--primary)]/15 border border-[var(--primary)]/30 text-[var(--primary)] text-xs font-mono font-bold">
                {sessionTargetMinutes} Minutes
              </span>
            </div>

            <div className="flex justify-end gap-2 text-xs pt-2">
              <button
                onClick={() => setIsSessionModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStartFocusSession(sessionTargetMinutes)}
                className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-md hover:scale-105 transition-transform cursor-pointer flex items-center gap-1.5"
              >
                <span>Start Session</span>
                <span>→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Force Exit Warning Confirmation Modal
       * ------------------------------------------------------------- */}
      {sessionStatus === "EXIT_CONFIRM" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in text-left">
          <div className="glass-card rounded-3xl p-6 border border-amber-500/40 bg-[var(--card)] max-w-sm w-full shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-2xl flex items-center justify-center mx-auto shadow-inner">
              ⚠️
            </div>
            <h4 className="font-serif font-bold text-lg text-[var(--foreground)]">
              End Session?
            </h4>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Leaving Focus Mode will end your current session. This session will not be counted toward your completed sessions.
            </p>

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={handleContinueSession}
                className="flex-1 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:scale-[1.02] transition-transform cursor-pointer"
              >
                Continue Session
              </button>
              <button
                onClick={handleAbandonSession}
                className="flex-1 py-2.5 rounded-xl bg-[var(--secondary)] hover:bg-rose-500/20 text-[var(--text-secondary)] hover:text-rose-400 border border-[var(--border)] hover:border-rose-500/30 text-xs font-bold transition-all cursor-pointer"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Session Completion Celebration Modal
       * ------------------------------------------------------------- */}
      {isSessionCompleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in text-left">
          <div className="glass-card rounded-3xl p-6 border border-emerald-500/40 bg-[var(--card)] max-w-sm w-full shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-3xl flex items-center justify-center mx-auto shadow-inner">
              🎉
            </div>
            <h4 className="font-serif font-bold text-base text-[var(--foreground)]">
              Reading Session Complete!
            </h4>
            <p className="text-xs text-[var(--text-secondary)]">
              You completed your {sessionTargetMinutes}-minute focus session on &ldquo;{book.title}&rdquo;.
            </p>

            <div className="grid grid-cols-2 gap-2 bg-[var(--secondary)]/40 p-3 rounded-2xl border border-[var(--border)] text-xs">
              <div>
                <span className="text-[10px] text-[var(--text-secondary)] block">Pages Covered</span>
                <strong className="text-sm font-bold text-[var(--foreground)] font-mono">
                  {Math.abs(currentPage - sessionStartPageRef.current) + 1} pages
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-secondary)] block">Session Duration</span>
                <strong className="text-sm font-bold text-emerald-400 font-mono">
                  {sessionTargetMinutes}:00 Completed
                </strong>
              </div>
            </div>

            <button
              onClick={() => {
                setIsSessionCompleteOpen(false);
                setSessionStatus("IDLE");
                setSessionRemainingSeconds(sessionTargetMinutes * 60);
              }}
              className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:scale-105 transition-transform cursor-pointer"
            >
              Continue Reading →
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * My Reading Memory Drawer Modal
       * ------------------------------------------------------------- */}
      <BookReadingMemory
        book={book}
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        onJumpToPage={handleJumpToPage}
      />

      {/* -------------------------------------------------------------
       * Table of Contents & Annotated Page Index Drawer
       * ------------------------------------------------------------- */}
      {isTocOpen && (
        <div className="fixed inset-0 z-50 flex justify-start bg-black/60 backdrop-blur-sm animate-fade-in text-left">
          <div className="w-full max-w-sm h-full bg-[var(--card)] border-r border-[var(--border)] shadow-2xl flex flex-col justify-between overflow-hidden animate-slide-left z-50">
            <div className="p-4 border-b border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">📑</span>
                  <h4 className="font-serif font-bold text-sm text-[var(--foreground)]">
                    Navigation &amp; Index
                  </h4>
                </div>
                <button
                  onClick={() => setIsTocOpen(false)}
                  className="w-7 h-7 rounded-xl bg-[var(--secondary)] text-xs hover:text-[var(--foreground)] flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Tabs: Chapters vs Annotated Pages */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--secondary)]/60 border border-[var(--border)] text-xs font-semibold">
                <button
                  onClick={() => setTocActiveTab("toc")}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    tocActiveTab === "toc"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Chapters ({tableOfContents.length})
                </button>
                <button
                  onClick={() => setTocActiveTab("annotated")}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    tocActiveTab === "annotated"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <span>Annotated</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-[var(--accent)] text-[var(--primary-foreground)] text-[9px] font-bold">
                    {annotatedPagesList.length}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {tocActiveTab === "toc" ? (
                tableOfContents.map((item, idx) => (
                  <button
                    key={`${item.page}_${idx}`}
                    onClick={() => {
                      handleJumpToPage(item.page);
                      setIsTocOpen(false);
                    }}
                    className={`w-full p-3 rounded-2xl text-left text-xs transition-all flex items-center justify-between border cursor-pointer ${
                      currentPage >= item.page && (idx === tableOfContents.length - 1 || currentPage < tableOfContents[idx + 1].page)
                        ? "bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)] font-bold shadow-xs"
                        : "bg-[var(--secondary)]/40 hover:bg-[var(--secondary)] border-[var(--border)] text-[var(--foreground)] font-medium"
                    }`}
                  >
                    <span className="truncate mr-3">{item.title}</span>
                    <span className="text-[10px] font-mono opacity-80 whitespace-nowrap">Page {item.page}</span>
                  </button>
                ))
              ) : (
                annotatedPagesList.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[var(--text-secondary)]">
                    No annotated pages yet. Highlight, add notes, or draw on pages to index them here.
                  </div>
                ) : (
                  annotatedPagesList.map((item) => (
                    <button
                      key={item.page}
                      onClick={() => {
                        handleJumpToPage(item.page);
                        setIsTocOpen(false);
                      }}
                      className={`w-full p-3 rounded-2xl text-left text-xs transition-all border space-y-1.5 cursor-pointer ${
                        currentPage === item.page
                          ? "bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)] font-bold shadow-xs"
                          : "bg-[var(--secondary)]/40 hover:bg-[var(--secondary)] border-[var(--border)] text-[var(--foreground)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold font-serif">Page {item.page}</span>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {item.bookmark && <span>🔖</span>}
                          {item.highlights > 0 && <span className="text-amber-400">🖍️ {item.highlights}</span>}
                          {item.notes > 0 && <span className="text-sky-400">📝 {item.notes}</span>}
                          {item.drawings > 0 && <span className="text-purple-400">🎨 {item.drawings}</span>}
                        </div>
                      </div>
                      {item.noteSnippets.length > 0 && (
                        <p className="text-[10px] text-[var(--text-secondary)] italic line-clamp-1 border-l border-[var(--border)] pl-1.5">
                          &ldquo;{item.noteSnippets[0]}&rdquo;
                        </p>
                      )}
                    </button>
                  ))
                )
              )}
            </div>
          </div>
          <div className="flex-1" onClick={() => setIsTocOpen(false)} />
        </div>
      )}

      {/* -------------------------------------------------------------
       * Page Thumbnail Navigator Drawer (▦)
       * ------------------------------------------------------------- */}
      {isThumbnailDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-fade-in text-left">
          <div className="flex-1" onClick={() => setIsThumbnailDrawerOpen(false)} />
          <div className="w-full max-w-md h-full bg-[var(--card)] border-l border-[var(--border)] shadow-2xl flex flex-col justify-between overflow-hidden animate-slide-right z-50">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border)] space-y-3 bg-[var(--card)]/95 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">▦</span>
                  <div>
                    <h4 className="font-serif font-bold text-sm text-[var(--foreground)]">
                      Page Thumbnail Navigator
                    </h4>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      Jump across {numPages || "all"} pages with study markers
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsThumbnailDrawerOpen(false)}
                  className="w-7 h-7 rounded-xl bg-[var(--secondary)] text-xs hover:text-[var(--foreground)] flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 text-xs">
                {[
                  { id: "all", label: `All (${numPages})` },
                  { id: "annotated", label: `Marked (${annotatedPagesList.length})` },
                  { id: "bookmarked", label: `Bookmarked (${bookmarks.length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setThumbnailFilter(f.id as any)}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                      thumbnailFilter === f.id
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                        : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Thumbnail Grid */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: numPages || 1 }).map((_, idx) => {
                const pageNum = idx + 1;
                const isCurrent = pageNum === currentPage;
                const isBookmarked = (bookmarks || []).some((b) => b.page === pageNum);
                const annCount = pageAnnotationCount(pageNum);
                const isAnnotated = annCount > 0 || isBookmarked;

                if (thumbnailFilter === "annotated" && !isAnnotated) return null;
                if (thumbnailFilter === "bookmarked" && !isBookmarked) return null;

                return (
                  <button
                    key={pageNum}
                    onClick={() => {
                      handleJumpToPage(pageNum);
                      setIsThumbnailDrawerOpen(false);
                    }}
                    className={`group relative flex flex-col items-center p-3 rounded-2xl border transition-all text-center cursor-pointer ${
                      isCurrent
                        ? "bg-[var(--accent)]/15 border-[var(--accent)] ring-2 ring-[var(--accent)] text-[var(--foreground)] shadow-md"
                        : "bg-[var(--secondary)]/30 hover:bg-[var(--secondary)] border-[var(--border)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {/* Simulated page preview container */}
                    <div className="w-full aspect-[3/4] rounded-lg bg-[var(--background)] border border-[var(--border)]/80 flex flex-col items-center justify-between p-2 mb-2 relative overflow-hidden group-hover:scale-102 transition-transform shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)]">
                        P. {pageNum}
                      </span>

                      {/* Mini skeleton lines */}
                      <div className="w-full space-y-1 my-auto opacity-40">
                        <div className="h-1 bg-[var(--foreground)] rounded w-full" />
                        <div className="h-1 bg-[var(--foreground)] rounded w-4/5" />
                        <div className="h-1 bg-[var(--foreground)] rounded w-3/4" />
                      </div>

                      {/* Study Indicator Badges on Thumbnail */}
                      <div className="flex items-center gap-1 text-[10px] z-10">
                        {isBookmarked && <span title="Bookmarked">🔖</span>}
                        {annCount > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-[var(--accent)] shadow-xs animate-pulse"
                            title={`${annCount} study markings`}
                          />
                        )}
                      </div>
                    </div>

                    <span className="text-xs font-serif font-bold text-[var(--foreground)]">
                      Page {pageNum}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Study & Annotation Suite Sub-Toolbar (Study Mode)
       * ------------------------------------------------------------- */}
      {isStudyMode && !isFocusMode && (
        <div className="absolute top-14 inset-x-0 z-30 flex flex-wrap items-center justify-between p-2 sm:px-6 bg-[var(--card)]/95 backdrop-blur-xl border-b border-[var(--border)] gap-2 animate-fade-in text-xs shadow-lg">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "select", label: "Select", icon: "↖️", shortcut: "V" },
              { id: "pen", label: "Pen", icon: "✏️", shortcut: "P" },
              { id: "highlighter", label: "Highlighter", icon: "🖍️", shortcut: "H" },
              { id: "line", label: "Line", icon: "📏", shortcut: "L" },
              { id: "arrow", label: "Arrow", icon: "↗️", shortcut: "A" },
              { id: "circle", label: "Circle", icon: "⭕", shortcut: "C" },
              { id: "rectangle", label: "Rect", icon: "▭", shortcut: "R" },
              { id: "square", label: "Square", icon: "▢", shortcut: "" },
              { id: "diamond", label: "Diamond", icon: "💎", shortcut: "D" },
              { id: "text", label: "Text", icon: "🔤", shortcut: "T" },
              { id: "eraser", label: "Eraser", icon: "🧹", shortcut: "E" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTool(t.id as any)}
                className={`px-2.5 py-1 rounded-xl font-bold transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  activeTool === t.id
                    ? "bg-[var(--accent)] text-[var(--primary-foreground)] shadow-xs"
                    : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              {(activeTool === "highlighter"
                ? ["#facc15", "#34d399", "#38bdf8", "#f472b6", "#c084fc"]
                : ["#f59e0b", "#10b981", "#06b6d4", "#f43f5e", "#a855f7", "#ffffff"]
              ).map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    if (activeTool === "highlighter") setHighlighterColor(color);
                    else setPenColor(color);
                  }}
                  className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full border transition-transform cursor-pointer ${
                    (activeTool === "highlighter" ? highlighterColor : penColor) === color
                      ? "scale-125 ring-2 ring-white"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="h-4 w-px bg-[var(--border)]" />

            <div className="flex items-center gap-1">
              <button
                onClick={() => handleUndo(currentPage)}
                disabled={(undoStack[currentPage] || []).length === 0}
                className="p-1.5 rounded-lg border bg-[var(--secondary)] text-[var(--foreground)] cursor-pointer"
                title="Undo (Ctrl+Z)"
              >
                ↩️
              </button>
              <button
                onClick={() => handleRedo(currentPage)}
                disabled={(redoStack[currentPage] || []).length === 0}
                className="p-1.5 rounded-lg border bg-[var(--secondary)] text-[var(--foreground)] cursor-pointer"
                title="Redo (Ctrl+Y)"
              >
                ↪️
              </button>
            </div>

            <button
              onClick={() => handleClearPageWithConfirmation(currentPage)}
              className="px-2 py-1 rounded-lg bg-[var(--secondary)] hover:bg-rose-500/20 hover:text-rose-400 text-[var(--text-secondary)] font-bold transition-all cursor-pointer text-[11px]"
            >
              🗑️ Clear
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Text Box Dialog
       * ------------------------------------------------------------- */}
      {textBoxDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in text-left">
          <div className="glass-card rounded-3xl p-6 border border-[var(--border)] bg-[var(--card)] max-w-sm w-full shadow-2xl space-y-4">
            <h4 className="font-serif font-bold text-sm text-[var(--foreground)] flex items-center gap-2">
              <span>🔤</span>
              <span>Place Text Annotation — Page {textBoxDialog.page}</span>
            </h4>
            <input
              type="text"
              value={textBoxDialog.text}
              onChange={(e) => setTextBoxDialog({ ...textBoxDialog, text: e.target.value })}
              placeholder="e.g. Key formula, exam note, key concept..."
              autoFocus
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setTextBoxDialog({ isOpen: false, page: 1, point: null, text: "" })}
                className="px-3.5 py-1.5 rounded-xl text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTextBox}
                className="px-4 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold cursor-pointer"
              >
                Place Text →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Floating Contextual Selection Popover
       * ------------------------------------------------------------- */}
      {selectionPopover?.visible && (
        <div
          className="absolute z-40 flex items-center gap-1.5 p-1.5 rounded-2xl glass-card border border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-xl shadow-2xl animate-scale-up text-xs"
          style={{
            left: `${selectionPopover.x}px`,
            top: `${selectionPopover.y}px`,
          }}
        >
          <button
            onClick={() => handleCreateHighlight("amber")}
            className="w-6 h-6 rounded-full bg-amber-400/80 hover:scale-110 border border-amber-300 shadow-sm transition-transform cursor-pointer"
            title="Highlight Amber"
          />
          <button
            onClick={() => handleCreateHighlight("mint")}
            className="w-6 h-6 rounded-full bg-emerald-400/80 hover:scale-110 border border-emerald-300 shadow-sm transition-transform cursor-pointer"
            title="Highlight Mint"
          />
          <button
            onClick={() => handleCreateHighlight("cyan")}
            className="w-6 h-6 rounded-full bg-cyan-400/80 hover:scale-110 border border-cyan-300 shadow-sm transition-transform cursor-pointer"
            title="Highlight Cyan"
          />
          <button
            onClick={() => handleCreateHighlight("purple")}
            className="w-6 h-6 rounded-full bg-purple-400/80 hover:scale-110 border border-purple-300 shadow-sm transition-transform cursor-pointer"
            title="Highlight Purple"
          />

          <div className="h-4 w-px bg-[var(--border)] mx-1" />

          <button
            onClick={handleOpenNoteModal}
            className="px-2.5 py-1 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] font-bold transition-all flex items-center gap-1 cursor-pointer"
          >
            <span>📝</span>
            <span>Note</span>
          </button>

          <button
            onClick={() => setSelectionPopover(null)}
            className="px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Note Creation Modal
       * ------------------------------------------------------------- */}
      {noteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in text-left">
          <div className="glass-card rounded-3xl p-6 border border-[var(--border)] bg-[var(--card)] max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
              <h4 className="font-serif font-bold text-sm text-[var(--foreground)] flex items-center gap-2">
                <span>📝</span>
                <span>Add Note — Page {noteModal.page}</span>
              </h4>
              <button
                onClick={() => setNoteModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {noteModal.selectedText && (
              <blockquote className="text-xs text-[var(--text-secondary)] italic font-serif pl-2.5 border-l-2 border-[var(--accent)] line-clamp-3 bg-[var(--background)]/50 p-2 rounded-r-xl">
                &ldquo;{noteModal.selectedText}&rdquo;
              </blockquote>
            )}

            <textarea
              rows={4}
              value={noteModal.noteText}
              onChange={(e) => setNoteModal({ ...noteModal, noteText: e.target.value })}
              placeholder="Write your personal thoughts, study notes, or questions..."
              autoFocus
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-2xl p-3.5 text-xs sm:text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
            />

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setNoteModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                className="px-5 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-md hover:scale-105 transition-transform cursor-pointer"
              >
                Save Note →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Eye Comfort Settings Popover
       * ------------------------------------------------------------- */}
      {showSettings && (
        <div className="fixed sm:absolute top-14 sm:top-16 right-2 sm:right-6 z-50 w-80 max-w-[calc(100vw-1rem)] p-5 rounded-3xl glass-panel shadow-2xl border border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-2xl animate-scale-up space-y-4 text-left">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
            <h4 className="text-xs font-bold font-serif text-[var(--foreground)] uppercase tracking-wider">
              Eye Comfort &amp; Display
            </h4>
            <button
              onClick={() => setShowSettings(false)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Reading Atmosphere</span>
            <div className="grid grid-cols-4 gap-1.5">
              {(["default", "sepia", "dark", "dim"] as ReadingMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updatePref("readingMode", mode)}
                  className={`py-1.5 rounded-xl text-[10px] font-bold capitalize border transition-all cursor-pointer ${
                    prefs.readingMode === mode
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--secondary)] text-[var(--text-secondary)]"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-medium text-[var(--text-secondary)]">
              <span>Brightness</span>
              <span className="text-[var(--foreground)] font-bold">{prefs.brightness}%</span>
            </div>
            <input
              type="range"
              min={60}
              max={130}
              value={prefs.brightness}
              onChange={(e) => updatePref("brightness", Number(e.target.value))}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-medium text-[var(--text-secondary)]">
              <span>Warmth</span>
              <span className="text-[var(--foreground)] font-bold">{prefs.warmth}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              value={prefs.warmth}
              onChange={(e) => updatePref("warmth", Number(e.target.value))}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
          </div>

          <button
            onClick={() => setPrefs(DEFAULT_PREFS)}
            className="w-full py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] text-[11px] font-semibold transition-all cursor-pointer"
          >
            Reset Defaults
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Page Jump Modal
       * ------------------------------------------------------------- */}
      {showJumpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="glass-card rounded-3xl p-6 border border-[var(--border)] bg-[var(--card)] max-w-xs w-full shadow-2xl text-left space-y-4">
            <h4 className="font-serif font-bold text-sm text-[var(--foreground)]">
              Go to Page
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={numPages || 999}
                value={jumpPageInput}
                onChange={(e) => setJumpPageInput(e.target.value)}
                placeholder={`1 - ${numPages}`}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJumpToPage(Number(jumpPageInput));
                }}
                className="w-full bg-[var(--background)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                / {numPages}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowJumpModal(false)}
                className="px-3 py-1.5 rounded-xl text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleJumpToPage(Number(jumpPageInput))}
                className="px-4 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-sm hover:scale-105 transition-transform cursor-pointer"
              >
                Go →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
       * Annotation Drawer
       * ------------------------------------------------------------- */}
      <AnnotationDrawer
        isOpen={isAnnotationDrawerOpen}
        onClose={() => setIsAnnotationDrawerOpen(false)}
        bookTitle={book.title}
        annotations={annotations}
        bookmarks={bookmarks}
        onJumpToPage={handleJumpToPage}
        onDeleteHighlight={(id) => {
          deleteHighlight(book.id, id, user?.uid);
          const updated = getBookAnnotations(book.id, user?.uid);
          setAnnotations(updated);
          if (user?.uid) {
            syncAnnotationsToCloud(user.uid, book.id, updated);
          }
        }}
        onUpdateNote={(id, text) => {
          updateNote(book.id, id, text, user?.uid);
          const updated = getBookAnnotations(book.id, user?.uid);
          setAnnotations(updated);
          if (user?.uid) {
            syncAnnotationsToCloud(user.uid, book.id, updated);
          }
        }}
        onDeleteNote={(id) => {
          deleteNote(book.id, id, user?.uid);
          const updated = getBookAnnotations(book.id, user?.uid);
          setAnnotations(updated);
          if (user?.uid) {
            syncAnnotationsToCloud(user.uid, book.id, updated);
          }
        }}
        onClearDrawing={(page) => {
          clearPageDrawings(book.id, page, user?.uid);
          const updated = getBookAnnotations(book.id, user?.uid);
          setAnnotations(updated);
          if (user?.uid) {
            syncAnnotationsToCloud(user.uid, book.id, updated);
          }
        }}
        onDeleteBookmark={(id) => {
          deleteBookmark(book.id, id, user?.uid);
          const updated = getBookmarks(book.id, user?.uid);
          setBookmarks(updated);
          if (user?.uid) {
            syncBookmarksToCloud(user.uid, book.id, updated);
          }
        }}
      />

      {/* -------------------------------------------------------------
       * Movable Contextual Translation Overlay Panel (Docked Left/Right)
       * ------------------------------------------------------------- */}
      <TranslationDrawer
        isOpen={isTranslateOpen}
        onClose={() => setIsTranslateOpen(false)}
        pages={currentSpreadExtracts}
        selectedTarget={translationTarget}
        onTargetChange={(newTarget) => {
          setTranslationTarget(newTarget);
          handlePerformTranslation(newTarget);
        }}
        onTranslate={() => handlePerformTranslation()}
        isLoading={isTranslating}
        result={translationResult}
        theme={prefs.readingMode}
        position={translationPosition}
        onPositionChange={setTranslationPosition}
      />

      {/* -------------------------------------------------------------
       * Main Book Viewport Canvas (100% Stable, Full Size)
       * ------------------------------------------------------------- */}
      <div className="flex-1 flex items-center justify-center relative p-0.5 sm:p-6 w-full h-full overflow-hidden touch-none">
        {pdfLoadError ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto glass-card rounded-3xl border border-rose-500/30 bg-[var(--card)] space-y-4 shadow-2xl animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-3xl flex items-center justify-center text-rose-400">
              ⚠️
            </div>
            <h4 className="font-serif font-bold text-base text-[var(--foreground)]">
              Unable to Open Book
            </h4>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              We encountered a network or loading interruption while reading &ldquo;{book.title}&rdquo;.
            </p>
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              <button
                onClick={() => {
                  setPdfLoadError(null);
                  setLoading(true);
                  setLoadingText("Retrying connection...");
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:scale-105 transition-transform cursor-pointer"
              >
                Retry Loading ↻
              </button>
              <Link
                href={`/book/${book.id}`}
                className="px-4 py-2 rounded-xl bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs font-semibold border border-[var(--border)]"
              >
                Book Overview →
              </Link>
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center gap-3 text-center animate-pulse">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-2xl flex items-center justify-center text-[var(--accent)]">
              📖
            </div>
            <p className="text-xs font-bold text-[var(--foreground)] font-serif">
              Opening &ldquo;{book.title}&rdquo;...
            </p>
            <span className="text-[10px] text-[var(--text-secondary)]">
              {loadingText}
            </span>
          </div>
        ) : (
          <div
            className="relative flex items-center justify-center transition-all duration-300 w-full h-full"
            style={{
              perspective: "2000px",
              transformStyle: "preserve-3d",
              ...getFilterStyle(),
            }}
          >
            {isDouble ? (
              <div
                className="relative flex items-center rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.75)] border border-[#2b221a]/40 transition-transform duration-300 overflow-hidden"
                style={{ backgroundColor: getPageBgColor(), transformStyle: "preserve-3d" }}
              >
                {/* Left Page */}
                <div
                  onMouseUp={(e) => handlePageMouseUp(e, activeLeftPage)}
                  className={`relative flex items-center justify-center p-2 sm:p-4 border-r border-[#cfc4b4]/50 overflow-hidden min-h-[380px] sm:min-h-[500px] transition-all duration-300 ${
                    isFlipping && flipDirection === "prev" ? "animate-page-flip-prev z-20" : "z-10"
                  }`}
                >
                  {currentPage === 1 ? (
                    <div className="w-[300px] sm:w-[360px] h-[460px] sm:h-[540px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#cfc4b4]/40 rounded-xl bg-black/[0.02] relative overflow-hidden">
                      <div className="relative w-28 h-40 rounded-lg overflow-hidden book-shadow mb-4 border border-[var(--border)]">
                        <Image src={book.cover} alt={book.title} fill className="object-cover" sizes="120px" />
                      </div>
                      <h4 className="font-serif font-bold text-sm text-[#3b2f20] mb-1 line-clamp-2">
                        {book.title}
                      </h4>
                      <p className="text-xs text-[#6b5840]">by {book.author}</p>
                    </div>
                  ) : (
                    <div
                      className="relative transition-transform duration-75 origin-center will-change-transform"
                      style={{
                        transform: prefs.zoom > 100 ? `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)` : undefined,
                      }}
                    >
                      <canvas ref={canvasLeftRef} className="block max-w-full h-auto object-contain rounded-sm" />
                      <DrawingCanvas
                        pageNumber={activeLeftPage}
                        initialStrokes={annotations.drawings[activeLeftPage] || EMPTY_DRAWINGS}
                        onStrokesChange={(strokes) => handleStrokesChange(activeLeftPage, strokes)}
                        width={pageCanvasSize.width}
                        height={pageCanvasSize.height}
                        isDrawingActive={isStudyMode}
                        activeTool={activeTool}
                        activeColor={currentColor}
                        strokeWidth={strokeWidth}
                        opacity={opacity}
                        fillMode={fillMode}
                        selectedStrokeId={selectedStrokeId}
                        onSelectStroke={setSelectedStrokeId}
                        visible={showAnnotationsOverlay}
                        onTextPrompt={(pt) => {
                          setTextBoxDialog({
                            isOpen: true,
                            page: activeLeftPage,
                            point: pt,
                            text: "",
                          });
                        }}
                      />
                    </div>
                  )}
                  <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/15 to-transparent pointer-events-none" />
                </div>

                {/* Center Spine */}
                <div
                  className="w-2.5 self-stretch relative z-10 pointer-events-none"
                  style={{
                    background: "linear-gradient(to right, rgba(0,0,0,0.3), rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.3))",
                    boxShadow: "inset 0 0 4px rgba(0,0,0,0.35)",
                  }}
                />

                {/* Right Page */}
                <div
                  onMouseUp={(e) => handlePageMouseUp(e, activeRightPage)}
                  className={`relative flex items-center justify-center p-2 sm:p-4 overflow-hidden min-h-[380px] sm:min-h-[500px] transition-all duration-300 ${
                    isFlipping && flipDirection === "next" ? "animate-page-flip-next z-20" : "z-10"
                  }`}
                >
                  <div
                    className="relative transition-transform duration-75 origin-center will-change-transform"
                    style={{
                      transform: prefs.zoom > 100 ? `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)` : undefined,
                    }}
                  >
                    <canvas ref={canvasRightRef} className="block max-w-full h-auto object-contain rounded-sm" />
                    <DrawingCanvas
                      pageNumber={activeRightPage}
                      initialStrokes={annotations.drawings[activeRightPage] || EMPTY_DRAWINGS}
                      onStrokesChange={(strokes) => handleStrokesChange(activeRightPage, strokes)}
                      width={pageCanvasSize.width}
                      height={pageCanvasSize.height}
                      isDrawingActive={isStudyMode}
                      activeTool={activeTool}
                      activeColor={currentColor}
                      strokeWidth={strokeWidth}
                      opacity={opacity}
                      fillMode={fillMode}
                      selectedStrokeId={selectedStrokeId}
                      onSelectStroke={setSelectedStrokeId}
                      visible={showAnnotationsOverlay}
                      onTextPrompt={(pt) => {
                        setTextBoxDialog({
                          isOpen: true,
                          page: activeRightPage,
                          point: pt,
                          text: "",
                        });
                      }}
                    />
                  </div>
                  <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/15 to-transparent pointer-events-none" />
                </div>
              </div>
            ) : (
              /* Single Page Mode */
              <div
                onMouseUp={(e) => handlePageMouseUp(e, currentPage)}
                className={`relative w-full h-full overflow-hidden flex items-center justify-center ${
                  isMobile
                    ? "rounded-none border-0 shadow-none p-0"
                    : "rounded-xl sm:rounded-2xl shadow-[0_20px_55px_rgba(0,0,0,0.7)] border border-[#2b221a]/30 p-1 sm:p-4"
                } ${
                  isFlipping ? (flipDirection === "next" ? "animate-page-flip-next" : "animate-page-flip-prev") : ""
                }`}
                style={{ backgroundColor: getPageBgColor() }}
              >
                <div
                  className="relative origin-center will-change-transform flex items-center justify-center"
                  style={{
                    transform: `scale(${interactiveScale}) translate3d(${panOffset.x}px, ${panOffset.y}px, 0)`,
                    transition: (isPinching || isPanningRef.current) ? "none" : "transform 0.12s cubic-bezier(0.2, 0, 0, 1)",
                  }}
                >
                  <canvas ref={canvasSingleRef} className="block max-w-none h-auto object-contain rounded-sm" />
                  <DrawingCanvas
                    pageNumber={currentPage}
                    initialStrokes={annotations.drawings[currentPage] || EMPTY_DRAWINGS}
                    onStrokesChange={(strokes) => handleStrokesChange(currentPage, strokes)}
                    width={pageCanvasSize.width}
                    height={pageCanvasSize.height}
                    isDrawingActive={isStudyMode}
                    activeTool={activeTool}
                    activeColor={currentColor}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                    fillMode={fillMode}
                    selectedStrokeId={selectedStrokeId}
                    onSelectStroke={setSelectedStrokeId}
                    visible={showAnnotationsOverlay}
                    onTextPrompt={(pt) => {
                      setTextBoxDialog({
                        isOpen: true,
                        page: currentPage,
                        point: pt,
                        text: "",
                      });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Side Click Targets */}
        {!loading && (
          <>
            <button
              onClick={handlePrev}
              disabled={currentPage <= 1}
              className={`absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-10 sm:w-12 h-16 sm:h-20 rounded-2xl glass-card border border-[var(--border)] text-[var(--foreground)] flex items-center justify-center transition-all duration-300 cursor-pointer ${
                currentPage <= 1
                  ? "opacity-0 pointer-events-none"
                  : showControls || isFocusMode
                  ? "opacity-80 hover:opacity-100 hover:scale-105 shadow-xl hover:border-[var(--accent)]"
                  : "opacity-0 hover:opacity-100"
              }`}
              title="Previous Page (←)"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              onClick={handleNext}
              disabled={numPages > 0 && currentPage >= numPages}
              className={`absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-10 sm:w-12 h-16 sm:h-20 rounded-2xl glass-card border border-[var(--border)] text-[var(--foreground)] flex items-center justify-center transition-all duration-300 cursor-pointer ${
                numPages > 0 && currentPage >= numPages
                  ? "opacity-0 pointer-events-none"
                  : showControls || isFocusMode
                  ? "opacity-80 hover:opacity-100 hover:scale-105 shadow-xl hover:border-[var(--accent)]"
                  : "opacity-0 hover:opacity-100"
              }`}
              title="Next Page (→)"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* -------------------------------------------------------------
       * Bottom Progress & Navigation Toolbar
       * ------------------------------------------------------------- */}
      <div
        className={`absolute bottom-0 inset-x-0 z-30 flex flex-col gap-2 p-3 sm:p-4 bg-[var(--card)]/90 backdrop-blur-xl border-t border-[var(--border)]/70 transition-all duration-300 ${
          showControls && (!isFocusMode || !isMobile) ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto w-full">
          <button
            onClick={handlePrev}
            disabled={currentPage <= 1}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              currentPage <= 1
                ? "opacity-30 cursor-not-allowed bg-[var(--secondary)] text-[var(--text-secondary)]"
                : "bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--foreground)] hover:scale-105 border border-[var(--border)] shadow-xs"
            }`}
          >
            <span>←</span>
            <span className="hidden sm:inline">Prev</span>
          </button>

          {/* Center Page Indicator with P1 Annotation Density Dots */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setJumpPageInput(String(currentPage));
                setShowJumpModal(true);
              }}
              className="px-4 py-1.5 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] border border-[var(--border)] text-xs font-bold text-[var(--foreground)] transition-all cursor-pointer flex items-center gap-2 shadow-xs"
              title="Click to jump to specific page"
            >
              <span>
                Page {currentPage}
                {isDouble && currentPage < numPages ? `–${currentPage + 1}` : ""} of {numPages || "..."}
              </span>

              {/* Annotation density dot */}
              {pageAnnotationCount(currentPage) > 0 && (
                <span
                  className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse"
                  title={`${pageAnnotationCount(currentPage)} study notes, highlights or bookmarks on this page`}
                />
              )}

              {isBookComplete ? (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                  Completed ✓
                </span>
              ) : (
                <span className="text-[10px] text-[var(--accent)] font-semibold">({progressPercent}%)</span>
              )}
            </button>
          </div>

          <button
            onClick={handleNext}
            disabled={numPages > 0 && currentPage >= numPages}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              numPages > 0 && currentPage >= numPages
                ? "opacity-30 cursor-not-allowed bg-[var(--secondary)] text-[var(--text-secondary)]"
                : "bg-[var(--primary)] hover:opacity-95 text-[var(--primary-foreground)] hover:scale-105 shadow-md"
            }`}
          >
            <span className="hidden sm:inline">Next</span>
            <span>→</span>
          </button>
        </div>

        <div className="w-full max-w-4xl mx-auto h-1 rounded-full bg-[var(--secondary)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isBookComplete
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : "bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)]"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
