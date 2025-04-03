"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface TwitterLoginProps {
  successUri?: string;
}

export function TwitterLogin({ successUri }: TwitterLoginProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [hostname, setHostname] = useState("");

  useEffect(() => {
    setHostname(window.location.origin);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "TWITTER_AUTH_SUCCESS") {
        const redirectURI = event.data.successUri;
        if (redirectURI) {
          window.location.href = redirectURI;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [successUri]);

  const handleTwitterLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    console.log("handleTwitterLogin");

    try {
      const response = await fetch(`/api/auth/twitter/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          success_uri: successUri
            ? `${hostname ?? process.env.NEXT_PUBLIC_HOSTNAME}/claim/interstitial?successUri=${encodeURIComponent(
                successUri || ""
              )}`
            : ``,
        }),
      });

      console.log("response", response);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Try popup first
      const width = 600;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        data.authUrl,
        "twitter-auth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup || popup.closed) {
        // Fallback to direct navigation if popup blocked
        window.location.href = data.authUrl;
      }
    } catch (error: unknown) {
      console.error("Twitter login error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      <Button
        type="button"
        onClick={handleTwitterLogin}
        disabled={isLoading}
        className="flex items-center justify-center gap-2 bg-black hover:bg-gray-800 text-white rounded w-full py-2"
      >
        {isLoading ? (
          <>
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span className="text-sm">Connecting...</span>
          </>
        ) : (
          <>
            <span className="text-sm">Connect with</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </>
        )}
      </Button>
    </div>
  );
}
