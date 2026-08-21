"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useOptionalAuth } from "@/components/auth-provider";

export function RepositoryImportLink() {
  const session = useOptionalAuth()?.session ?? null;
  if (session?.authenticated && session.workspace?.role === "viewer") return null;
  return (
    <Link className="primary-button" href="/repositories/new">
      <Plus size={16} /> Analyze repository
    </Link>
  );
}
