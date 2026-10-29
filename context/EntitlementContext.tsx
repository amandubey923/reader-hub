"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  PlanId,
  FREE_TIER_LIMITS,
  getPlanConfig,
  RAZORPAY_PAYMENTS_ENABLED,
  PRO_ENFORCEMENT_ENABLED,
  DONATION_ENABLED,
} from "@/lib/monetization-config";
import {
  UserEntitlement,
  DEFAULT_FREE_ENTITLEMENT,
  isEntitlementActive,
} from "@/lib/entitlements";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

interface EntitlementContextType {
  entitlement: UserEntitlement;
  isPro: boolean;
  isSupporter: boolean;
  isProModalOpen: boolean;
  isSupportModalOpen: boolean;
  isPaymentStatusModalOpen: boolean;
  isRazorpayEnabled: boolean;
  isProEnforcementEnabled: boolean;
  isDonationEnabled: boolean;
  proModalReason: string;
  openProModal: (reason?: string) => void;
  closeProModal: () => void;
  openSupportModal: () => void;
  closeSupportModal: () => void;
  openPaymentStatusModal: () => void;
  closePaymentStatusModal: () => void;
  aiQueriesToday: number;
  translationsToday: number;
  canUseAiAssistant: () => boolean;
  recordAiQuery: () => boolean;
  canTranslateSpread: () => boolean;
  recordTranslationSpread: () => boolean;
  initiateCheckout: (planId: PlanId) => Promise<{ success: boolean; error?: string }>;
  isCheckoutLoading: boolean;
}

const EntitlementContext = createContext<EntitlementContextType | undefined>(undefined);

function getTodayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getAiUsageKey(uid?: string | null): string {
  return `readershub:ai-usage:v1:${uid || "guest"}`;
}

function getTranslateUsageKey(uid?: string | null): string {
  return `readershub:translate-usage:v1:${uid || "guest"}`;
}

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState<UserEntitlement>(DEFAULT_FREE_ENTITLEMENT);
  const [isProModalOpen, setIsProModalOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isPaymentStatusModalOpen, setIsPaymentStatusModalOpen] = useState(false);
  const [proModalReason, setProModalReason] = useState("");
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const openPaymentStatusModal = useCallback(() => setIsPaymentStatusModalOpen(true), []);
  const closePaymentStatusModal = useCallback(() => setIsPaymentStatusModalOpen(false), []);

  const [aiQueriesToday, setAiQueriesToday] = useState<number>(0);
  const [translationsToday, setTranslationsToday] = useState<number>(0);

  // Load today's usage counters (scoped by UID)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const today = getTodayDateKey();
      const aiKey = getAiUsageKey(user?.uid);
      const trKey = getTranslateUsageKey(user?.uid);

      const aiRaw = localStorage.getItem(aiKey);
      if (aiRaw) {
        const parsed = JSON.parse(aiRaw);
        if (parsed.date === today) {
          setAiQueriesToday(parsed.count || 0);
        } else {
          setAiQueriesToday(0);
        }
      } else {
        setAiQueriesToday(0);
      }

      const trRaw = localStorage.getItem(trKey);
      if (trRaw) {
        const parsed = JSON.parse(trRaw);
        if (parsed.date === today) {
          setTranslationsToday(parsed.count || 0);
        } else {
          setTranslationsToday(0);
        }
      } else {
        setTranslationsToday(0);
      }
    } catch {
      setAiQueriesToday(0);
      setTranslationsToday(0);
    }
  }, [user?.uid]);

  // Listen to Firestore entitlement for authenticated users
  useEffect(() => {
    if (!user) {
      setEntitlement(DEFAULT_FREE_ENTITLEMENT);
      return;
    }

    const db = getFirebaseDb();
    if (!db) return;

    try {
      const entRef = doc(db, "users", user.uid, "data", "entitlement");
      const unsubscribe = onSnapshot(
        entRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserEntitlement;
            setEntitlement(data);
          } else {
            setEntitlement(DEFAULT_FREE_ENTITLEMENT);
          }
        },
        (err) => {
          console.warn("[Entitlement] Snapshot notice:", err);
        }
      );

      return () => unsubscribe();
    } catch (e) {
      console.warn("[Entitlement] Listen error:", e);
    }
  }, [user]);

  const isPro = isEntitlementActive(entitlement) && entitlement.isPro;
  const isSupporter = isEntitlementActive(entitlement) && entitlement.isSupporter;

  const openProModal = useCallback((reason?: string) => {
    setProModalReason(reason || "Unlock unlimited reading tools and advanced study utilities.");
    setIsProModalOpen(true);
  }, []);

  const closeProModal = useCallback(() => {
    setIsProModalOpen(false);
    setProModalReason("");
  }, []);

  const openSupportModal = useCallback(() => {
    setIsSupportModalOpen(true);
  }, []);

  const closeSupportModal = useCallback(() => {
    setIsSupportModalOpen(false);
  }, []);

  // Feature Limits — Free & Unrestricted access while Pro enforcement is disabled
  const canUseAiAssistant = useCallback((): boolean => {
    // While Pro enforcement is disabled (pending Razorpay verification), all readers have unrestricted access
    if (!PRO_ENFORCEMENT_ENABLED || isPro) return true;
    return aiQueriesToday < FREE_TIER_LIMITS.DAILY_AI_QUERIES;
  }, [isPro, aiQueriesToday]);

  const recordAiQuery = useCallback((): boolean => {
    if (!PRO_ENFORCEMENT_ENABLED || isPro) return true;
    const nextCount = aiQueriesToday + 1;
    setAiQueriesToday(nextCount);
    try {
      localStorage.setItem(
        getAiUsageKey(user?.uid),
        JSON.stringify({ date: getTodayDateKey(), count: nextCount })
      );
    } catch {}
    return true;
  }, [isPro, aiQueriesToday, user?.uid]);

  const canTranslateSpread = useCallback((): boolean => {
    // While Pro enforcement is disabled (pending Razorpay verification), all page translations remain 100% free with NO limits
    if (!PRO_ENFORCEMENT_ENABLED || isPro) return true;
    return translationsToday < FREE_TIER_LIMITS.DAILY_TRANSLATION_SPREADS;
  }, [isPro, translationsToday]);

  const recordTranslationSpread = useCallback((): boolean => {
    if (!PRO_ENFORCEMENT_ENABLED || isPro) return true;
    const nextCount = translationsToday + 1;
    setTranslationsToday(nextCount);
    try {
      localStorage.setItem(
        getTranslateUsageKey(user?.uid),
        JSON.stringify({ date: getTodayDateKey(), count: nextCount })
      );
    } catch {}
    return true;
  }, [isPro, translationsToday, user?.uid]);

  // Lazy load Razorpay script on demand
  const loadRazorpayScript = async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (window.Razorpay) return true;

    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        console.error("[Razorpay] Failed to load checkout script");
        resolve(false);
      };
      document.body.appendChild(script);
    });
  };

  // Initiate Razorpay Checkout Flow
  const initiateCheckout = async (
    planId: PlanId
  ): Promise<{ success: boolean; error?: string }> => {
    const plan = getPlanConfig(planId);
    if (!plan || plan.amountPaise <= 0) {
      return { success: false, error: "Invalid plan selected." };
    }

    // Temporary Payment Availability Guard:
    // Razorpay is temporarily unavailable while merchant KYC / PAN verification is pending.
    if (!RAZORPAY_PAYMENTS_ENABLED || !PRO_ENFORCEMENT_ENABLED) {
      setIsPaymentStatusModalOpen(true);
      return {
        success: false,
        error: "Payment currently unavailable while verification is in progress.",
      };
    }

    setIsCheckoutLoading(true);

    try {
      // 1. Load Razorpay SDK on-demand
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded && !window.Razorpay) {
        setIsCheckoutLoading(false);
        return {
          success: false,
          error: "Could not connect to payment gateway. Please check your internet connection.",
        };
      }

      // 2. Fetch auth token if user is signed in
      let idToken = "";
      if (user) {
        try {
          idToken = await user.getIdToken();
        } catch {}
      }

      // 3. Create Server-Side Order
      const orderRes = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          planId,
          userId: user?.uid || "anonymous",
          userEmail: user?.email || "",
          userName: user?.displayName || "",
        }),
      });

      if (!orderRes.ok) {
        const errData = await orderRes.json().catch(() => ({}));
        setIsCheckoutLoading(false);
        return {
          success: false,
          error: errData?.error || "Failed to create payment order.",
        };
      }

      const orderData = await orderRes.json();
      const { orderId, amount, currency, keyId, planName } = orderData;

      // 4. Open Razorpay Checkout Modal
      return new Promise((resolve) => {
        const options = {
          key: keyId,
          amount,
          currency: currency || "INR",
          name: "Reader's HUB",
          description: planName || plan.name,
          order_id: orderId,
          prefill: {
            name: user?.displayName || "",
            email: user?.email || "",
          },
          theme: {
            color: "#d97706", // Reader's HUB amber accent
          },
          modal: {
            ondismiss: () => {
              setIsCheckoutLoading(false);
              resolve({ success: false, error: "Payment was cancelled." });
            },
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              // 5. Server Verification of Signature
              const verifyRes = await fetch("/api/payment/verify", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({
                  ...response,
                  planId,
                }),
              });

              const verifyData = await verifyRes.json().catch(() => ({}));

              if (verifyRes.ok && verifyData.success && verifyData.entitlement) {
                // The server persists the entitlement; the Firestore listener keeps this in sync
                const purchasedEntitlement: UserEntitlement = verifyData.entitlement;
                setEntitlement(purchasedEntitlement);

                setIsCheckoutLoading(false);
                setIsProModalOpen(false);
                setIsSupportModalOpen(false);
                resolve({ success: true });
              } else {
                setIsCheckoutLoading(false);
                resolve({
                  success: false,
                  error: verifyData?.error || "Payment verification failed.",
                });
              }
            } catch (err: any) {
              setIsCheckoutLoading(false);
              resolve({
                success: false,
                error: err?.message || "Error validating payment with server.",
              });
            }
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", (resp: any) => {
          setIsCheckoutLoading(false);
          resolve({
            success: false,
            error: resp?.error?.description || "Payment could not be completed. Your account was not charged.",
          });
        });
        rzp.open();
      });
    } catch (err: any) {
      setIsCheckoutLoading(false);
      return {
        success: false,
        error: err?.message || "An unexpected error occurred while initiating payment.",
      };
    }
  };

  return (
    <EntitlementContext.Provider
      value={{
        entitlement,
        isPro,
        isSupporter,
        isProModalOpen,
        isSupportModalOpen,
        isPaymentStatusModalOpen,
        isRazorpayEnabled: RAZORPAY_PAYMENTS_ENABLED && PRO_ENFORCEMENT_ENABLED,
        isProEnforcementEnabled: PRO_ENFORCEMENT_ENABLED,
        isDonationEnabled: DONATION_ENABLED,
        proModalReason,
        openProModal,
        closeProModal,
        openSupportModal,
        closeSupportModal,
        openPaymentStatusModal,
        closePaymentStatusModal,
        aiQueriesToday,
        translationsToday,
        canUseAiAssistant,
        recordAiQuery,
        canTranslateSpread,
        recordTranslationSpread,
        initiateCheckout,
        isCheckoutLoading,
      }}
    >
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlement() {
  const context = useContext(EntitlementContext);
  if (!context) {
    throw new Error("useEntitlement must be used within an EntitlementProvider");
  }
  return context;
}
