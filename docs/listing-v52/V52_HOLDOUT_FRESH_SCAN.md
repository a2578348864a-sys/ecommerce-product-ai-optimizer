# V5.2 New Holdout — Freshness Scan (pre-freeze)

Purpose: before freezing the **new** V5.2 holdout pool (H1-H5 are retired as final quality proof),
every candidate must pass the freshness gate: the ASIN must not appear anywhere in the repository
(history, docs, tests, fixtures, benchmark scripts, frozen manifests), and its brand must not be on
the contaminated-brand list.

## Source exports (provided 2026-09-11 13:45-13:47)

| File | Size | Category root | Status |
| --- | --- | --- | --- |
| `BSR(雪球（当前的）)-10-US-20260911.xlsx` | 616 KB | `Home & Kitchen:Seasonal Décor:Snow Globes` | ASINs extracted (17) |
| `BSR(季节性装饰（当前的）)-10-US-20260911.xlsx` | 396 KB | `Home & Kitchen:Seasonal Décor` | ASIN extraction pending |

Both files are standard SellerSprite BSR exports (`reportType=category_current`, top-level category).

## Freshness gate result — snow-globe export (17 ASINs)

Scan: `Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.md,*.json,*.prisma`,
excluding `node_modules`, `.next`, `tools/listing-v5-eval/out`; `Select-String -SimpleMatch` per ASIN.

| # | ASIN | repo hits | FRESH |
| --- | --- | --- | --- |
| 1 | B097ZBVGWG | 0 | YES |
| 2 | B0CFRH13NT | 0 | YES |
| 3 | B0D875S7Z2 | 0 | YES |
| 4 | B0DM1BLLX7 | 0 | YES |
| 5 | B0H49JLJKZ | 0 | YES |
| 6 | B0FMF5GWPC | 0 | YES |
| 7 | B0H6W79QXS | 0 | YES |
| 8 | B0DZNYQZP9 | 0 | YES |
| 9 | B0DZNT4FWY | 0 | YES |
| 10 | B0FFB6SFKV | 0 | YES |
| 11 | B0DFGK1F99 | 0 | YES |
| 12 | B0H4G5G3NH | 0 | YES |
| 13 | B0H4G3C8XT | 0 | YES |
| 14 | B0B8YPMZ5T | 0 | YES |
| 15 | B0BKKYHYK9 | 0 | YES |
| 16 | B0FGD3MNDH | 0 | YES |
| 17 | B0G2LNG54V | 0 | YES |

`FRESH=true` for all 17. Eligible for the new pool subject to the remaining gate (brand contamination
list, `fixture-*` / synthetic exclusion, and identity `integrity ∈ {verified_product_batch, verified_sprite}`).

## First two identified products (row order in the snow-globe export)

| ASIN | Brand | Title (EN) | Notes |
| --- | --- | --- | --- |
| B097ZBVGWG | Melunar | Fall Snow Globe Lantern, Thanksgiving Lighted Lantern, Swirling Glitter Snow Globe | launched 2021-08-02, seller LIGHTECH TRADING LIMITED |
| B0CFRH13NT | BOLTCORRSE | Pooh Bear Musical Snow Globe, Honey Scene, Resin and Glass, 5.5 in | collectible/gift framing |

Neither brand appears on the contaminated list (YETI, Stanley, BrüMate, Pyrex, OXO, HydroJug, THERMOS,
Etekcity, bella, Owala, LE TAUCI, ukeetap, PartyWoo, Zevo, TERRO, ...), and neither appears in the
retired A/B/C/D or H1-H5 pools.

## Not yet done (belongs to the freeze step, needs live app flow)

- import both exports (`POST /api/product-batches`, `operation=import`, `reportType=category_current`);
- create candidates + run research evidence collection (real browser page evidence, keywords,
  competitor, VOC) with `LOCAL_ACQUISITION_ENABLED=true` on the isolated runtime;
- confirm facts / decision / handoff, then record for each frozen case:
  `taskId, ASIN, contextFingerprint, factCount, vocCount, keywordCount, competitorCount`;
- extraction + freshness scan of the seasonal-decor export.
