import type { Metadata } from "next";
import { AppSettingsView } from "@/components/app-settings-view";
import { projectTitle } from "@/lib/app-title";

export const metadata: Metadata = { title: projectTitle("Settings") };

export default function Page() {
  return <AppSettingsView />;
}
