import { marketingResearchReferenceFixture } from "@/lib/listingHandoff/marketingIntelligence/fixtures/marketingResearchReference";
import { analyzeMarketingIntelligence } from "@/lib/listingHandoff/marketingIntelligence/analyzer";

export const copyStrategyFixtureInsight = analyzeMarketingIntelligence(marketingResearchReferenceFixture);
