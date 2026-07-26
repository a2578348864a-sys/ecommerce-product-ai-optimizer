import { runSellerSpritePreviewCli } from "./sellersprite-preview/runner";

process.exitCode = runSellerSpritePreviewCli(process.argv.slice(2));
