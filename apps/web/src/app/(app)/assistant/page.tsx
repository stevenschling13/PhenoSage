import type { Metadata } from "next";
import { AssistantWorkspace } from "@/components/assistant-workspace";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <main className="app-page">
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Assistant" },
        ]}
        description="Use the PhenoSage copilot to translate plant symptoms, image findings, and operating questions into precise cultivation actions."
        eyebrow={<Badge tone="accent">AI-native workspace</Badge>}
        title="PhenoSage Copilot"
      />
      <AssistantWorkspace />
    </main>
  );
}
