"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// Loading component to show while waiting for the main content
function LoadingInterstitial() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1DA1F2] border-t-transparent mx-auto mb-4" />
        <p className="text-sm text-gray-600">Initializing authentication...</p>
      </div>
    </div>
  );
}

// Component that uses searchParams and needs Suspense boundary
function InterstitialContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const successUri = searchParams.get("successUri");

    console.log(successUri);

    // Send message to opener window if it exists
    if (window.opener) {
      window.opener.postMessage(
        {
          type: "TWITTER_AUTH_SUCCESS",
          successUri,
        },
        "*"
      );
      if (successUri) {
        window.close();
      }
    } else {
      // Direct navigation - store token and redirect if successUri exists
      sessionStorage.setItem("success_auth", successUri || "");
      sessionStorage.setItem("twitter_auth", "true");
      if (successUri) {
        window.location.href = successUri;
      }
    }
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1DA1F2] border-t-transparent mx-auto mb-4" />
        <p className="text-sm text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
}

// Main page component with Suspense boundary
export default function InterstitialPage() {
  return (
    <Suspense fallback={<LoadingInterstitial />}>
      <InterstitialContent />
    </Suspense>
  );
}
