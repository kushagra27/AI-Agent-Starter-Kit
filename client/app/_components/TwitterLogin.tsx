"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface TwitterLoginProps {
  successUri?: string;
}

export function TwitterLogin({ successUri }: TwitterLoginProps) {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check for OAuth callback token in URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      // Store token in session storage
      sessionStorage.setItem("twitter_token", token);
      // Clean up URL parameters
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleTwitterLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Request OAuth initialization from backend
      const response = await fetch(`/api/auth/twitter/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(successUri ? { success_uri: successUri } : {}),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Store current URL for post-auth redirect
      const data = await response.json();
      sessionStorage.setItem("twitter_redirect_url", window.location.href);

      // Redirect to Twitter OAuth page
      window.location.href = data.authUrl;
    } catch (error: unknown) {
      setIsLoading(false);
      // Error state could be handled here
    }
  };

  return (
    <div className="flex items-center justify-center w-full my-4">
      <Button
        type="button"
        onClick={handleTwitterLogin}
        disabled={isLoading}
        className="flex items-center gap-2 bg-[#1DA1F2] hover:bg-[#1a91da] text-white rounded"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
        </svg>
        {isLoading ? "Connecting..." : "Login with Twitter"}
      </Button>
    </div>
  );
}
