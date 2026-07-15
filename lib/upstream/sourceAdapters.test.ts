import { describe, expect, it } from "vitest";
import fixture from "./fixtures/amazon-us-closet-organizer.v1.json";
import { rankStage1 } from "./ranking";
import {
  adaptCsvSource,
  adaptFixtureSource,
  adaptJsonSource,
  type CsvSourceAdapterInput,
} from "./sourceAdapters";

const CSV_HEADER = [
  "marketplace", "market", "query", "sourceUrl", "platformProductId", "parentProductId", "title",
  "price", "currency", "rating", "reviewCount", "sponsored", "brand", "imageUrl", "capturedAt",
  "deliveryRegion", "language", "page", "position",
].join(",");

function csvInput(rows: string[]): CsvSourceAdapterInput {
  return {
    schemaVersion: "csv-source-adapter-input.v1",
    csvText: [CSV_HEADER, ...rows].join("\n"),
    brief: {
      ...fixture.brief,
      briefId: "brief-csv-closet-organizer-v1",
      sampleBudget: { maxPages: 1, maxAppearances: 20 },
    },
    collectionRunId: "run-csv-closet-organizer-v1",
    collectorVersion: "local-csv-adapter.v1",
  };
}

const VALID_ROW = [
  "amazon.com", "US", "closet organizer", "https://www.amazon.com/dp/B0CSV00001?tag=ignored", "B0CSV00001", "",
  "CSV Closet Shelf", "29.99", "USD", "4.6", "321", "false", "CSV Home",
  "https://images.example.invalid/B0CSV00001.jpg", "2026-07-14T02:00:00.000Z", "New York 10001", "en-us", "1", "1",
].join(",");

describe("source adapters", () => {
  it("validates the JSON schema version at runtime", () => {
    expect(() => adaptJsonSource(JSON.stringify({ ...fixture, schemaVersion: "raw-observation-batch.v0" })))
      .toThrow("JSON_SOURCE_SCHEMA_VERSION_INVALID");
  });

  it("rejects source payloads that try to inject downstream ranking or decision fields", () => {
    const injected = structuredClone(fixture) as typeof fixture & { observations: Array<Record<string, unknown>> };
    injected.observations[0].promotionDecision = "promoted";
    expect(() => adaptJsonSource(JSON.stringify(injected))).toThrow("RAW_OBSERVATION_FIELD_NOT_ALLOWED");

    const csv = csvInput([VALID_ROW]);
    csv.csvText = csv.csvText.replace("position\n", "position,promotionDecision\n").replace(/,1$/, ",1,promoted");
    const result = adaptCsvSource(csv);
    expect(result.pipeline).toBeNull();
    expect(result.qualitySummary.errorCodes).toContain("prohibited_column:promotionDecision");
  });

  it("imports CSV deterministically and traces schema, source, hash, and batch", () => {
    const input = csvInput([VALID_ROW]);
    const first = adaptCsvSource(input);
    const second = adaptCsvSource(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "source-adapter-result.v1",
      sourceType: "csv",
      sourceSchemaVersion: "csv-source.v1",
      acceptedCount: 1,
      quarantinedCount: 0,
    });
    expect(first.sourceInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceBatchId).toMatch(/^source-batch-/);
    expect(first.pipeline?.rawObservations[0]).toMatchObject({
      schemaVersion: "raw-observation.v1",
      asin: "B0CSV00001",
      sponsored: false,
      priceCurrency: "USD",
    });
  });

  it("keeps missing CSV values as null plus explicit reasons", () => {
    const row = VALID_ROW.replace(",4.6,321,", ",,321,");
    const result = adaptCsvSource(csvInput([row]));
    const candidate = result.pipeline?.importPackage.candidates[0];
    expect(candidate?.evidenceSnapshot.product.rating.normalizedValue).toBeNull();
    expect(candidate?.evidenceSnapshot.product.rating.missingReason).toBe("csv_value_missing");
    expect(candidate?.minimumEvidencePack.complete).toBe(false);
  });

  it("quarantines invalid identity, URL, and conflicting currency without authorizing them downstream", () => {
    const invalidIdentity = VALID_ROW.replaceAll("B0CSV00001", "BAD");
    const invalidUrl = VALID_ROW.replace("https://www.amazon.com/dp/B0CSV00001?tag=ignored", "https://example.com/p/1")
      .replaceAll("B0CSV00001", "B0CSV00002");
    const currencyConflict = VALID_ROW.replaceAll("B0CSV00001", "B0CSV00003").replace(",USD,", ",JPY,");
    const result = adaptCsvSource(csvInput([VALID_ROW, invalidIdentity, invalidUrl, currencyConflict]));

    expect(result.acceptedCount).toBe(1);
    expect(result.quarantinedCount).toBe(3);
    expect(result.quarantinedRows.map((row) => row.errorCodes)).toEqual(expect.arrayContaining([
      expect.arrayContaining(["missing_identity"]),
      expect.arrayContaining(["source_url_invalid"]),
      expect.arrayContaining(["currency_conflict"]),
    ]));
    expect(result.pipeline?.rawObservations).toHaveLength(1);
  });

  it("fails closed when a required CSV column is absent", () => {
    const input = csvInput([VALID_ROW]);
    input.csvText = input.csvText.replace("platformProductId,", "").replace("B0CSV00001,", "");
    const result = adaptCsvSource(input);
    expect(result.pipeline).toBeNull();
    expect(result.qualitySummary.errorCodes).toContain("missing_required_column:platformProductId");
  });

  it("produces the same source-independent downstream result for Fixture and versioned JSON", () => {
    const fixtureResult = adaptFixtureSource(fixture);
    const jsonText = JSON.stringify(fixture);
    const jsonResult = adaptJsonSource(jsonText);
    expect(adaptJsonSource(jsonText)).toEqual(jsonResult);
    expect(fixtureResult).toMatchObject({ acceptedCount: 7, quarantinedCount: 1 });
    expect(jsonResult.pipeline).toEqual(fixtureResult.pipeline);
    expect(rankStage1(jsonResult.pipeline!.importPackage, fixture.brief.createdAt))
      .toEqual(rankStage1(fixtureResult.pipeline!.importPackage, fixture.brief.createdAt));
  });

  it("keeps RawObservation runtime keys source-independent", () => {
    const fixtureObservation = adaptFixtureSource(fixture).pipeline!.rawObservations[0];
    const csvObservation = adaptCsvSource(csvInput([VALID_ROW])).pipeline!.rawObservations[0];
    expect(Object.keys(csvObservation).sort()).toEqual(Object.keys(fixtureObservation).sort());
    expect(csvObservation.schemaVersion).toBe("raw-observation.v1");
  });
});
