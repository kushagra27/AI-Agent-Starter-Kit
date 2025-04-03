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
    <div className="container mx-auto flex items-center justify-center min-h-screen p-4 bg-gradient-to-b from-blue-50 to-indigo-50">
      <Card className="w-full max-w-md border-0 shadow-lg overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>
        <CardHeader className="bg-white border-b border-gray-100 pb-2 pt-4">
          <div className="flex justify-center mb-1">
            <div className="text-2xl">🏆</div>
          </div>
          <CardTitle className="text-xl font-bold text-center text-blue-800">
            AI Agents Battle Royale
          </CardTitle>
          <CardDescription className="text-center mt-1 text-gray-600 text-sm">
            Vote in epic head-to-head battles and crown the most legendary AI
            personality!
          </CardDescription>
        </CardHeader>
        <CardContent className="bg-white p-4 rounded-b-lg">
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <h3 className="font-semibold text-blue-800 flex items-center text-sm">
                <span className="text-base mr-1">👑</span> Contest Overview
              </h3>
              <p className="text-xs text-gray-700 mt-1">
                We&apos;re finding the most popular AI agent personalities
                through community voting. Your votes will determine which agents
                advance to our platform launch!
              </p>
            </div>

            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <h3 className="font-semibold text-indigo-800 flex items-center text-sm">
                <span className="text-base mr-1">🚀</span> How it works:
              </h3>
              <ol className="mt-1 space-y-1 ml-1">
                <li className="flex items-center text-xs text-gray-700">
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-indigo-200 text-indigo-700 rounded-full mr-1 text-[10px] font-bold">
                    1
                  </span>
                  <span>Connect with X to authenticate</span>
                </li>
                <li className="flex items-center text-xs text-gray-700">
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-indigo-200 text-indigo-700 rounded-full mr-1 text-[10px] font-bold">
                    2
                  </span>
                  <span>Vote in three exciting head-to-head battles</span>
                </li>
                <li className="flex items-center text-xs text-gray-700">
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-indigo-200 text-indigo-700 rounded-full mr-1 text-[10px] font-bold">
                    3
                  </span>
                  <span>See results and share with your friends</span>
                </li>
                <li className="flex items-center text-xs text-gray-700">
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-indigo-200 text-indigo-700 rounded-full mr-1 text-[10px] font-bold">
                    4
                  </span>
                  <span>Winners advance to the final showcase</span>
                </li>
              </ol>
            </div>
          </div>

          <div className="mt-3">
            <TwitterLogin
              successUri={
                hostname
                  ? `${hostname}/claim/${tokenId}/success`
                  : `${process.env.NEXT_PUBLIC_HOSTNAME}/claim/${tokenId}/success`
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
