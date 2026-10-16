"use client";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GLOBAL_VIEW_HREF, Sidebar } from "@/components/sidebar";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { SettingsView } from "@/components/settings-view";
import { api } from "@/lib/api-client";

/** Settings that apply to every project, reached from the sidebar outside any project. */
export function AppSettingsView() {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["config"], queryFn: api.config });
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground text-sm">
      <ReadOnlyBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar view="settings" onView={(v) => router.push(GLOBAL_VIEW_HREF[v]!)} humanActor={data?.humanActor} />
        <div className="min-w-0 flex-1">
          <SettingsView />
        </div>
      </div>
    </div>
  );
}
