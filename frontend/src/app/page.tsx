"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Middleware handles auth check, just redirect
    router.replace("/dashboard");
  }, [router]);

  return null;
}
