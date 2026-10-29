"use client";

import React from "react";
import dynamic from "next/dynamic";
import Toast from "@/components/Toast";

const LibraryAssistant = dynamic(() => import("@/components/assistant/LibraryAssistant"), { ssr: false });
const ProUpgradeModal = dynamic(() => import("@/components/payment/ProUpgradeModal"), { ssr: false });
const ProPaymentStatusModal = dynamic(() => import("@/components/payment/ProPaymentStatusModal"), { ssr: false });
const SupportReaderModal = dynamic(() => import("@/components/monetization/SupportReaderModal"), { ssr: false });
const CompanionRoot = dynamic(() => import("@/components/companion/CompanionRoot"), { ssr: false });

export default function GlobalModals() {
  return (
    <>
      <LibraryAssistant />
      <Toast />
      <ProUpgradeModal />
      <ProPaymentStatusModal />
      <SupportReaderModal />
      <CompanionRoot />
    </>
  );
}

