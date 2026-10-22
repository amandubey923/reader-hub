"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useEntitlement } from "@/context/EntitlementContext";
import { PlanId, UPI_SUPPORT_CONFIG } from "@/lib/monetization-config";

export default function ProUpgradeModal() {
  const {
    isProModalOpen,
    closeProModal,
    proModalReason,
    initiateCheckout,
    isCheckoutLoading,
    isRazorpayEnabled,
    openPaymentStatusModal,
  } = useEntitlement();

  const [selectedPlan, setSelectedPlan] = useState<PlanId>("PRO_YEARLY");
  const [selectedUpiAmount, setSelectedUpiAmount] = useState<number>(49);
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isProModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProModalOpen, closeProModal]);

  if (!isProModalOpen) return null;

  const upiId = UPI_SUPPORT_CONFIG.supportUPIId; // 8969230625@ibl
  const payeeName = UPI_SUPPORT_CONFIG.payeeName;
  const qrImagePath = UPI_SUPPORT_CONFIG.qrImagePath || "/images/support-qr1.jpg";

  // Standard direct UPI Intent URI (dynamically updates with selected amount)
  const upiIntentUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${selectedUpiAmount}&cu=INR&tn=${encodeURIComponent("Support Readers HUB Library")}`;

  const handleCopyUpiId = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(upiId).then(() => {
        setCopiedUpi(true);
        setTimeout(() => setCopiedUpi(false), 2500);
      });
    }
  };

  const handleUpgradeClick = async () => {
    setErrorMessage(null);
    if (!isRazorpayEnabled) {
      openPaymentStatusModal();
      return;
    }

    const result = await initiateCheckout(selectedPlan);
    if (!result.success && result.error && result.error !== "Payment was cancelled.") {
      setErrorMessage(result.error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in text-left overflow-y-auto"
      onClick={closeProModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lounge-modal-title"
    >
      {/* Editorial Reading Spread Container */}
      <div
        className="relative w-full max-w-4xl my-auto rounded-3xl bg-[var(--card)] border border-amber-500/30 shadow-2xl shadow-black/95 overflow-hidden max-h-[92vh] overflow-y-auto flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle Warm Background Glow */}
        <div className="absolute -top-16 -left-16 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={closeProModal}
          className="absolute top-4 right-4 p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors cursor-pointer z-20"
          aria-label="Close dialog"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* ========================================================================= */}
        {/* LEFT COLUMN: THE DIGITAL READING LOUNGE & MEMBERSHIP RAIL */}
        {/* ========================================================================= */}
        <div className="w-full md:w-7/12 p-6 sm:p-7 md:p-8 flex flex-col justify-between space-y-5 border-b md:border-b-0 md:border-r border-[var(--border)] relative z-10">
          {/* Header & Typography */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                ✨ Reader Pro Membership
              </span>
              <span className="text-[10px] text-[var(--text-secondary)]">· Vol. I</span>
            </div>

            <h2
              id="lounge-modal-title"
              className="text-2xl sm:text-3xl lg:text-[28px] font-black font-serif text-[var(--foreground)] tracking-tight leading-tight uppercase"
            >
              Unlock Your <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-300 to-orange-400">
                Reading Sanctuary
              </span>
            </h2>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-md">
              {proModalReason || "Immersive AI book discussions, instant multilingual spreads, and deep study analytics."}
            </p>
          </div>

          {/* Membership Choice Rail (Interactive Timeline Selector) */}
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5">
              <span>Select Membership Tier</span>
            </div>

            <div className="space-y-2">
              {/* Option 1: 30 Days Pass */}
              <div
                onClick={() => setSelectedPlan("PRO_MONTHLY")}
                className={`group relative p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedPlan === "PRO_MONTHLY"
                    ? "border-amber-500/70 bg-gradient-to-r from-amber-500/15 to-transparent shadow-md"
                    : "border-[var(--border)] bg-[var(--background)]/50 hover:border-amber-500/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all ${
                      selectedPlan === "PRO_MONTHLY"
                        ? "border-amber-400 bg-amber-500"
                        : "border-[var(--border)] bg-[var(--card)]"
                    }`}
                  >
                    {selectedPlan === "PRO_MONTHLY" && <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />}
                  </div>

                  <div>
                    <div className="text-xs font-bold text-[var(--foreground)]">30 Days Membership</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">One-time reading access · No auto-debit</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-base font-black font-serif text-[var(--foreground)]">₹49</div>
                  <div className="text-[9px] text-[var(--text-secondary)]">Single pass</div>
                </div>
              </div>

              {/* Option 2: 365 Days Annual Pass (Featured) */}
              <div
                onClick={() => setSelectedPlan("PRO_YEARLY")}
                className={`group relative p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedPlan === "PRO_YEARLY"
                    ? "border-amber-500/80 bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-transparent shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/30"
                    : "border-[var(--border)] bg-[var(--background)]/50 hover:border-amber-500/30"
                }`}
              >
                <span className="absolute -top-2 right-3 px-2 py-0.2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 text-[8.5px] font-black uppercase tracking-wider shadow-xs">
                  Save 50% · Best Value
                </span>

                <div className="flex items-center gap-3">
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all ${
                      selectedPlan === "PRO_YEARLY"
                        ? "border-amber-400 bg-amber-500"
                        : "border-[var(--border)] bg-[var(--card)]"
                    }`}
                  >
                    {selectedPlan === "PRO_YEARLY" && <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />}
                  </div>

                  <div>
                    <div className="text-xs font-bold text-[var(--foreground)]">365 Days Annual Access</div>
                    <div className="text-[10px] text-amber-400/90 font-medium">Full year library companion (~₹25/mo)</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-base font-black font-serif text-amber-400">₹299</div>
                  <div className="text-[9px] text-[var(--text-secondary)]">Annual pass</div>
                </div>
              </div>
            </div>
          </div>

          {/* Editorial Benefits List (Typographic Roman Style) */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border)]/60 text-[11px] text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-serif font-bold text-amber-400">I.</span>
              <span className="truncate">Unlimited AI Assistant</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-serif font-bold text-amber-400">II.</span>
              <span className="truncate">Instant Page Translations</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-serif font-bold text-amber-400">III.</span>
              <span className="truncate">Reading Habit Analytics</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-serif font-bold text-amber-400">IV.</span>
              <span className="truncate">Golden PRO Reader Badge</span>
            </div>
          </div>

          {/* Gateway Status Note */}
          <div className="pt-2 border-t border-[var(--border)]/60 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400/50" />
                <span className="font-medium text-[var(--text-secondary)]">Secure Razorpay Checkout</span>
              </div>

              <button
                type="button"
                onClick={handleUpgradeClick}
                disabled={isCheckoutLoading}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 hover:from-amber-300 hover:via-amber-400 hover:to-orange-400 text-zinc-950 font-bold text-xs tracking-wide shadow-md shadow-amber-500/15 hover:shadow-lg hover:shadow-amber-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
              >
                <span>✨</span>
                <span>
                  {isCheckoutLoading
                    ? "Connecting..."
                    : selectedPlan === "PRO_MONTHLY"
                    ? "Upgrade to Pro • ₹49"
                    : "Upgrade to Pro • ₹299"}
                </span>
              </button>
            </div>

            {errorMessage && (
              <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: THE VOLUNTARY PATRON STATION (LIBRARY TICKET SLIP) */}
        {/* ========================================================================= */}
        <div className="w-full md:w-5/12 p-6 sm:p-7 bg-[var(--background)]/70 flex flex-col justify-between space-y-3.5 relative z-10">
          {/* Patron Header */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1">
                <span>❤️</span>
                <span>Patron Station</span>
              </span>
              <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                ● Active Now
              </span>
            </div>
            <h3 className="text-base font-bold font-serif text-[var(--foreground)]">
              Support the Library
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)] leading-tight">
              Help us keep Reader&apos;s HUB open and free for literature lovers.
            </p>
          </div>

          {/* Concise Bilingual Advisory Footnote */}
          <div className="p-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[10px] text-[var(--text-secondary)] leading-tight space-y-1">
            <p>
              <strong className="text-[var(--foreground)] font-semibold">Free to Read:</strong> ₹49 / ₹99 is a voluntary donation to support our library and does not unlock Pro features.
            </p>
            <p className="pt-0.5 border-t border-amber-500/10 text-[9.5px]">
              <strong className="text-[var(--foreground)] font-semibold">पढ़ना मुफ्त है:</strong> ₹49/₹99 केवल voluntary donation है; इससे Pro features unlock नहीं होते।
            </p>
          </div>

          {/* Library Ticket QR Container */}
          <div className="flex flex-col items-center justify-center p-2 rounded-2xl bg-zinc-950 border border-amber-500/25 shadow-inner">
            <div className="relative overflow-hidden rounded-xl bg-black max-w-[170px] sm:max-w-[185px] w-full flex items-center justify-center">
              <Image
                src={qrImagePath}
                alt="Reader's HUB Official UPI QR Code"
                width={185}
                height={277}
                style={{ width: "100%", height: "auto" }}
                className="object-contain rounded-lg"
                priority
              />
            </div>
          </div>

          {/* Interactive Patron Controls */}
          <div className="space-y-2">
            {/* Amount Selector Pills */}
            <div className="grid grid-cols-2 gap-1.5">
              {UPI_SUPPORT_CONFIG.amounts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedUpiAmount(item.amount)}
                  className={`py-1 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                    selectedUpiAmount === item.amount
                      ? "border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs"
                      : "border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:border-amber-500/30"
                  }`}
                >
                  <span className="text-xs font-bold">₹{item.amount}</span>
                  <span className="text-[9.5px] opacity-75 ml-1">
                    {item.label.includes("Chai") ? "Chai" : "Patron"}
                  </span>
                </button>
              ))}
            </div>

            {/* UPI ID Box + 1-Click Copy */}
            <div className="p-1.5 px-2.5 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center justify-between gap-1 shadow-xs">
              <code className="text-xs font-mono font-bold text-[var(--foreground)] truncate select-all">
                {upiId}
              </code>
              <button
                type="button"
                onClick={handleCopyUpiId}
                className="px-2 py-0.5 rounded-md bg-[var(--secondary)] hover:bg-[var(--border)] text-[10.5px] font-bold text-[var(--accent)] border border-[var(--border)] transition-all cursor-pointer flex-shrink-0 active:scale-95"
                aria-label="Copy UPI ID"
              >
                {copiedUpi ? "✓ Copied" : "Copy"}
              </button>
            </div>

            {/* Primary Action Button: Direct Pay via UPI App */}
            <a
              href={upiIntentUri}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md hover:shadow-amber-500/20 active:scale-95 transition-all text-center cursor-pointer"
            >
              <span>📱</span>
              <span>Pay ₹{selectedUpiAmount} via UPI App</span>
              <span>→</span>
            </a>

            <p className="text-[9.5px] text-[var(--text-secondary)] text-center leading-tight">
              Works with GPay, PhonePe, Paytm, BHIM & UPI apps.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
