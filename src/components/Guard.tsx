"use client";

import { getAccessToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Guard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = getAccessToken();
    if (!token) router.replace("/login");
    else setAllowed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) return null;
  if (!allowed) return null;
  return <>{children}</>;
}
