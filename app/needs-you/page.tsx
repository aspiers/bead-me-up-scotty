import type { Metadata } from "next";
import { GlobalNeedsYouView } from "@/components/global-needs-you-view";
import { projectTitle } from "@/lib/app-title";

export const metadata: Metadata = { title: projectTitle("Needs You") };

export default function Page() {
  return <GlobalNeedsYouView />;
}
