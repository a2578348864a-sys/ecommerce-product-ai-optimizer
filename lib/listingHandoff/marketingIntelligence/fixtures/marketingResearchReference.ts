import type { MarketingResearchReference } from "../types";

export const marketingResearchReferenceFixture: MarketingResearchReference = {
  voc: [
    { theme: "organization", summary: "The counter gets messy and storage is difficult.", strength: "recurring", reviewCount: 8 },
    "Customers want easy access to frequently used items.",
  ],
  keywords: ["storage organizer", "kitchen counter organizer", "easy access storage"],
  competitors: [
    "Helps organize kitchen tools and keep the counter tidy for daily use.",
    { note: "Easy access design for home and office storage.", bullets: ["Separate items", "Keep spaces organized"] },
  ],
  sourcing: [{ title: "Organizer supplier listing", note: "Displayed offer details for feature availability reference." }],
};

