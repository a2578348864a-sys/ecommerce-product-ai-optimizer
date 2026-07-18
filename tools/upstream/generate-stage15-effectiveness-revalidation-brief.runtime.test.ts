import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15EffectivenessRevalidationBrief } from "./generate-stage15-effectiveness-revalidation-brief";

const protocolFile = process.env.STAGE15_REVALIDATION_PROTOCOL_FILE;
const blindPacketFile = process.env.STAGE15_REVALIDATION_BLIND_PACKET_FILE;
const outputDirectory = process.env.STAGE15_REVALIDATION_OUTPUT_DIRECTORY;
const createdAt = process.env.STAGE15_REVALIDATION_CREATED_AT;

describe("Stage 1.5 effectiveness revalidation brief runtime generator", () => {
  it.runIf(Boolean(protocolFile && blindPacketFile && outputDirectory && createdAt))(
    "writes a pending, fixed-scope authorization brief without website access",
    () => {
      const result = generateStage15EffectivenessRevalidationBrief({
        protocolFile: protocolFile!,
        blindPacketFile: blindPacketFile!,
        outputDirectory: outputDirectory!,
        createdAt: createdAt!,
      });
      const brief = JSON.parse(readFileSync(join(outputDirectory!, result.files[0]), "utf8"));

      expect(brief.status).toBe("pending_user_authorization");
      expect(brief.targets).toHaveLength(10);
      expect(brief.accessBudget).toMatchObject({ productDetailNavigations: 10, searchNavigations: 0, retries: 0 });
      expect(brief.userAuthorization).toBeNull();
      expect(result.summary.userAuthorizationPresent).toBe(false);
      expect(result.summary.externalWebsiteAccessed).toBe(false);
    },
  );
});
