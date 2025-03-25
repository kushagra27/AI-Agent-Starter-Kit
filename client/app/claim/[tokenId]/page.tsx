"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useParams, useRouter } from "next/navigation";
import { TwitterLogin } from "@/app/_components/TwitterLogin";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClaimPage() {
  const { tokenId } = useParams();
  const router = useRouter();
  const [hostname, setHostname] = useState("");
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const init = async () => {
      setHostname(window.location.origin);

      // Check if auth tokens exist in session storage
      const token = sessionStorage.getItem("twitter_token");
      const profile = sessionStorage.getItem("twitter_profile");

      if (token && profile) {
        console.log("Found existing Twitter auth, redirecting to success page");
        // We have all necessary data, redirect to success page
        router.push(`/claim/${tokenId}/success?token=${token}`);
      } else {
        // Check for success_auth which might come from interstitial page
        const successAuth = sessionStorage.getItem("success_auth");
        if (successAuth && successAuth.includes(`/claim/${tokenId}/success`)) {
          // We have auth from interstitial but no token yet, let the URL redirect happen
          console.log("Found success_auth, waiting for redirect");
        }
        setIsChecking(false);
      }
    };

    init();
  }, [tokenId, router]);

  if (isChecking) {
    return (
      <div className="container mx-auto flex items-center justify-center min-h-screen p-4 bg-white">
        <Card className="w-full max-w-md bg-white border-gray-200">
          <CardHeader className="bg-white">
            <Skeleton className="h-8 w-[200px] mb-2" />
            <Skeleton className="h-4 w-[150px]" />
          </CardHeader>
          <CardContent className="bg-white">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1DA1F2] border-t-transparent" />
                <div className="text-sm text-gray-500">
                  Loading your experience...
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex items-center justify-center min-h-screen p-4 bg-white">
      <Card className="w-full max-w-md bg-white border-gray-200">
        <CardHeader className="bg-white">
          <CardTitle>Vote on your favorite AI projects</CardTitle>
          <CardDescription>
            Token:{" "}
            <a
              href={`https://wow.xyz/${tokenId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {tokenId}
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="bg-white">
          <TwitterLogin
            successUri={
              hostname
                ? `${hostname}/claim/${tokenId}/success`
                : `${process.env.NEXT_PUBLIC_HOSTNAME}/claim/${tokenId}/success`
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
