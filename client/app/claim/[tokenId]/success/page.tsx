"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "next/navigation";
import Image from "next/image";

interface TwitterProfile {
  data: {
    id: string;
    name: string;
    username: string;
    description?: string;
    profile_image_url?: string;
    public_metrics?: {
      followers_count: number;
      following_count: number;
      tweet_count: number;
    };
    verified?: boolean;
  };
}

export default function SuccessPage() {
  const { tokenId } = useParams();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<TwitterProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTwitterProfile = async () => {
      try {
        const token = searchParams.get("token");
        if (!token) {
          throw new Error("No token provided");
        }

        const response = await fetch(
          "/api/auth/twitter/success?token=" + token
        );

        if (!response.ok) {
          throw new Error("Failed to fetch profile");
        }

        const data = await response.json();
        setProfile(data.profile);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTwitterProfile();
  }, [searchParams]);

  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Twitter Authentication Success</CardTitle>
          <CardDescription>
            Wow.XYZ Token:{" "}
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
        <CardContent>
          {error ? (
            <div className="text-red-500">{error}</div>
          ) : isLoading ? (
            <Card className="border-2">
              <CardContent className="pt-6">
                <div className="space-y-6">
                  <div className="text-sm text-center text-gray-500">
                    Loading your profile details...
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-4">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-4 w-[150px]" />
                      </div>
                    </div>
                    <Skeleton className="h-20 w-full" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-[100px]" />
                      <Skeleton className="h-4 w-[100px]" />
                      <Skeleton className="h-4 w-[100px]" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : profile ? (
            <Card className="border-2">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center space-x-4">
                    {profile.data.profile_image_url && (
                      <Image
                        src={profile.data.profile_image_url}
                        alt={profile.data.name}
                        className="h-12 w-12 rounded-full"
                        width={100}
                        height={100}
                      />
                    )}
                    <div>
                      <div className="font-medium">{profile.data.name}</div>
                      <div className="text-sm text-gray-500">
                        @{profile.data.username}
                      </div>
                    </div>
                  </div>
                  {profile.data.description && (
                    <p className="text-sm text-gray-700">
                      {profile.data.description}
                    </p>
                  )}
                  {profile.data.public_metrics && (
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>
                        {profile.data.public_metrics.followers_count} followers
                      </span>
                      <span>
                        {profile.data.public_metrics.following_count} following
                      </span>
                      <span>
                        {profile.data.public_metrics.tweet_count} tweets
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-center space-x-2">
              <svg
                className="h-5 w-5 animate-spin text-gray-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="text-sm text-gray-600">Loading...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
