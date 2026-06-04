import { permanentRedirect } from "next/navigation";

export const dynamic = "force-static";

// /results is consolidated into /track-record — single source of truth.
export default function ResultsRedirect() {
  permanentRedirect("/track-record");
}
