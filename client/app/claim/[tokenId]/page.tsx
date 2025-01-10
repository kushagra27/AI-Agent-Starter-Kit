"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useParams } from "next/navigation";
import { TwitterLogin } from "@/app/_components/TwitterLogin";
import { useEffect, useState } from "react";

export default function ClaimPage() {
  const { tokenId } = useParams();
  const [hostname, setHostname] = useState("");

  useEffect(() => {
    setHostname(window.location.origin);
  }, []);

  return (
    <div className="container mx-auto flex items-center justify-center min-h-screen p-4 bg-white">
      <Card className="w-full max-w-md bg-white border-gray-200">
        <CardHeader className="bg-white">
          <CardTitle>Claim Wow.XYZ Airdrop</CardTitle>
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
