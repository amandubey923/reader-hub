/**
 * Reader's HUB — Centralized Monetization & Plan Configuration
 * Single source of truth for all plans, pricing, free usage limits, and feature flags.
 */

export type PlanId = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY" | "SUPPORT_49" | "SUPPORT_99";

/**
 * Master Razorpay Payment Availability Flag
 * Controls whether Razorpay checkout and live order creation are enabled.
 * Defaults to false until merchant KYC/PAN approval is complete.
 */
export const RAZORPAY_PAYMENTS_ENABLED: boolean =
  process.env.NEXT_PUBLIC_RAZORPAY_PAYMENTS_ENABLED === "true" || false;

/**
 * PRO ENFORCEMENT FEATURE FLAG — currently ENABLED (free daily AI/translation limits apply, client and server).
 * When false:
 *  - Reader's HUB remains 100% free with ZERO paywall blocks or "upgrade to continue" restrictions.
 *  - Daily translation limits and AI assistant quotas are unrestricted (free unlimited access).
 *  - Pro upgrade UI/pricing cards remain visible for user preview.
 *  - Voluntary UPI/QR donation flow remains fully active and enabled.
 */
export const PRO_ENFORCEMENT_ENABLED: boolean = true;

/**
 * VOLUNTARY DONATION FEATURE FLAG
 * Direct voluntary patron donations via UPI & QR code remain 100% active and enabled.
 */
export const DONATION_ENABLED: boolean = true;

export interface PlanConfig {
  id: PlanId;
  name: string;
  badgeName: string;
  tagline: string;
  description: string;
  amountPaise: number; // Amount in paise (e.g., 4900 = ₹49)
  amountINR: number;
  durationDays: number; // Duration of access (0 for one-time support)
  billingType: "one_time_pass" | "one_time_support" | "free";
  billingLabel: string;
  features: string[];
  isPopular?: boolean;
}

export const MONETIZATION_PLANS: Record<PlanId, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Reader Free",
    badgeName: "Free Reader",
    tagline: "Always 100% Free Reading",
    description: "Unlimited reading of all books with zero login barriers.",
    amountPaise: 0,
    amountINR: 0,
    durationDays: 0,
    billingType: "free",
    billingLabel: "Free Forever",
    features: [
      "Access to full public library books",
      "Offline book reading & PWA access",
      "Bookmarks, highlights, notes & drawings",
      "Reading streaks & Diwali Diya progress",
      "5 AI Assistant questions per day",
      "10 Page spread translations per day",
    ],
  },
  PRO_MONTHLY: {
    id: "PRO_MONTHLY",
    name: "Reader Pro (1 Month)",
    badgeName: "PRO",
    tagline: "1-Month Pro Pass",
    description: "Unlock unlimited AI reading tools and advanced study utilities for 30 days.",
    amountPaise: 4900, // ₹49
    amountINR: 49,
    durationDays: 30,
    billingType: "one_time_pass",
    billingLabel: "₹49 for 30 Days (One-time pass)",
    features: [
      "Unlimited AI Reader Assistant queries",
      "Unlimited page translations (Hindi / Hinglish / English)",
      "Advanced reading analytics & habit reports",
      "Golden PRO badge on your profile",
      "Support continuous development of Reader's HUB",
    ],
  },
  PRO_YEARLY: {
    id: "PRO_YEARLY",
    name: "Reader Pro (1 Year)",
    badgeName: "PRO YEARLY",
    tagline: "Best Value · 1-Year Pro Pass",
    description: "Full year of unrestricted AI reading tools, translation, and study tools.",
    amountPaise: 29900, // ₹299
    amountINR: 299,
    durationDays: 365,
    billingType: "one_time_pass",
    billingLabel: "₹299 for 365 Days (Save ~50%)",
    isPopular: true,
    features: [
      "Everything in Reader Pro",
      "Full 365 days of uninterrupted access",
      "Priority AI response generation",
      "Exclusive Supporter & Pro badges",
      "Directly funds free digital education & literature",
    ],
  },
  SUPPORT_49: {
    id: "SUPPORT_49",
    name: "Reader's Cup of Chai",
    badgeName: "Supporter",
    tagline: "Support Reader's HUB",
    description: "Voluntary reader tip to help cover cloud hosting, AI, and book storage costs.",
    amountPaise: 4900, // ₹49
    amountINR: 49,
    durationDays: 0,
    billingType: "one_time_support",
    billingLabel: "₹49 one-time voluntary tip",
    features: [
      "Supporter badge on your reading profile",
      "Helps keep Reader's HUB 100% free and open for everyone",
      "Special mention in community contributors",
    ],
  },
  SUPPORT_99: {
    id: "SUPPORT_99",
    name: "Book Patron Contribution",
    badgeName: "Patron",
    tagline: "Generous Patron Support",
    description: "Help us expand the Hindi & world classical literature catalog.",
    amountPaise: 9900, // ₹99
    amountINR: 99,
    durationDays: 0,
    billingType: "one_time_support",
    billingLabel: "₹99 one-time voluntary contribution",
    isPopular: true,
    features: [
      "Patron badge on your reading profile",
      "Directly sponsors new book digitizations and OCR processing",
      "Special mention in community contributors",
    ],
  },
};

/**
 * Free Tier Daily Limits
 */
export const FREE_TIER_LIMITS = {
  DAILY_AI_QUERIES: 5,
  DAILY_TRANSLATION_SPREADS: 10,
};

/**
 * Direct Voluntary UPI Support Configuration
 */
export const UPI_SUPPORT_CONFIG = {
  // Centralized UPI ID provided for receiving voluntary patron tips
  supportUPIId: process.env.NEXT_PUBLIC_SUPPORT_UPI_ID || "8969230625@ibl",
  qrImagePath: "/images/support-qr1.jpg",
  payeeName: "Reader's HUB Library",
  amounts: [
    { id: "49", label: "₹49 (Chai Tip)", amount: 49, isDefault: true },
    { id: "99", label: "₹99 (Book Patron)", amount: 99 },
  ],
  title: "Support Reader's HUB",
  subtitle: "Help us keep the reading experience free, open, and ad-free for everyone.",
  note: "Direct voluntary patron donation via any UPI App (GPay, PhonePe, Paytm, BHIM).",
};

/**
 * Affiliate Monetization Configuration (for legally eligible physical books)
 */
export const AFFILIATE_CONFIG = {
  enabled: process.env.NEXT_PUBLIC_AFFILIATE_ENABLED === "true" || false,
  provider: "Amazon Associates",
  amazonAssociateTag: process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG || "",
  disclosureText: "Affiliate link — we may earn a small commission at no extra cost to you.",
  buttonLabel: "Buy / View Physical Book",
};

/**
 * Ads Readiness Configuration (Strictly disabled by default)
 */
export const ADS_CONFIG = {
  enabled: process.env.NEXT_PUBLIC_ADS_ENABLED === "true" || false,
  googlePublisherId: process.env.NEXT_PUBLIC_ADSENSE_ID || "",
  // Publisher policy guard: Ads are strictly forbidden on pages with review_required or unverified content
  requiresLegalOnlyMode: true,
};

/**
 * Content Rights Policy Modes
 */
export type ContentPolicyMode = "audit" | "hide_review_required" | "legal_only";

export const CONTENT_POLICY = {
  mode: (process.env.NEXT_PUBLIC_CONTENT_POLICY_MODE as ContentPolicyMode) || "audit",
};

/**
 * Helper to retrieve a validated plan configuration by Plan ID
 */
export function getPlanConfig(planId: string): PlanConfig | null {
  const plan = MONETIZATION_PLANS[planId as PlanId];
  return plan || null;
}

/**
 * Format currency in Indian Rupees
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

