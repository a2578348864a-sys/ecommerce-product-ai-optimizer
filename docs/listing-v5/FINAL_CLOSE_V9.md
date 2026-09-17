# Listing V5 Final Close V9

> 冻结日期：2026-09-12
>
> 本报告记录当前 Listing V5 正式链路的最终收口证据。它不代表自动发布，也不代表转化率提升。

## Final Versions

- Writer: `listing-v5-writer.v9`
- Conversion Blueprint: `listing-v5.conversion-blueprint.v2`
- Validator: `listing-v5.validation.v6`
- Snapshot: `listing-v5.snapshot.v1`
- Human review: required before publication

## Production Chain

```text
Confirmed Facts
  -> conversionBlueprint v2
  -> approvedBenefits writer-safe projection
  -> Writer v9
  -> Validator v6
  -> bounded Repair / Rewrite / Recovery
  -> Safe Fallback only when the AI path cannot produce a valid draft
  -> listingV5 snapshot
  -> API readback
  -> Listing Studio / Research Detail
```

The formal route derives `approvedBenefits` from the current Confirmed Facts and
the v2 Blueprint. Strategy and research references remain framing inputs only;
they are not added to the fact or evidence set. The Validator receives the same
fact-bound benefit contract for the writer, repair, rewrite, recovery and final
validation passes.

## Closed Issues

- Benefit Contract tightened to conservative, fact-bound expressions.
- Internal `confirmed`, `explains`, `gives shoppers`, `compare` and `referenceOnly`
  wording is excluded from the Writer-facing approved-benefit projection.
- Strategy comparison-reference leakage is removed from the executable projection.
- Social proof is display-only and cannot become a recommendation, trust,
  ranking or quality claim.
- Included-component wording cannot imply an unconfirmed usage state or result.
- The approved-benefit Validator recognition path accepts only canonical,
  Confirmed-Fact-bound clauses and rejects forged or mismatched benefits.
- The formal Listing route now wires the approved-benefit projection through all
  generation and validation stages.
- Listing V5 snapshot, API readback and Research Detail existence projection are
  aligned.
- DeepSeek TUN/proxy timeout behavior was identified as a local runtime-network
  issue. Direct connectivity has been verified after disabling the TUN path;
  Provider code was not changed for this environment issue.

## Formal THERMOS Evidence

The originally requested historical task id was not present in the current V5
database. No historical A/B output or showcase fixture was imported. A real task
was created through the normal product-batch candidate -> Research flow:

```text
taskId: cmtyg37dc0005vq91x5t0h7p8
ASIN: B08NCVT244
Product: THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink
```

Research completion and handoff:

- `researchCompletion.status = completed`
- `researchCompletion.finalStatus = creative_ready`
- `creativeHandoff.controlState = active`
- Confirmed facts: 17, with source references
- Listing-scoped facts: 13
- Pending facts after confirmation: 0
- Keyword rows: 10
- Competitor observations: 5
- Confirmed VOC samples: 5

Final Listing V5 snapshot:

- Real Provider path: completed with `writerAttempted = true`
- `fallbackUsed = false`
- `validation.status = PASS`
- `unsupportedClaims = 0`
- `prohibitedClaims = 0`
- `competitorOverlap = 0`
- `allHaveEvidence = true`
- Snapshot persisted and read back after refresh
- `humanReviewRequired = true`

The final quality evaluation was `B (80/100)`. This is a copy-quality signal,
not a conversion-rate claim.

## Browser Evidence

The complete browser journey was performed with real Chrome:

```text
opportunity candidate
  -> Research Detail
  -> 补齐研究资料
  -> Amazon fact confirmation
  -> keyword / competitor confirmation
  -> VOC confirmation
  -> human decision: 进入创作准备
  -> 完成研究并保存记录
  -> Listing Studio
  -> 创作资料确认
  -> 重新分析策略
  -> 生成 Listing
  -> refresh readback
```

After refresh, the page showed `AI Writer 输出` and `安全检查通过`. The DOM
order was:

```text
营销文案策略
  -> Listing 标题 TITLE
  -> 五点描述 BULLET POINTS
  -> 商品描述 PRODUCT DESCRIPTION
  -> 搜索关键词 KEYWORDS
  -> 事实安全与人工复核
```

Browser checks:

- Desktop: `1440 x 900`, `scrollWidth = 1425`, no horizontal overflow.
- Mobile: `390 x 844`, `scrollWidth = 375`, no horizontal overflow.
- Fresh browser console: 0 errors and 0 warnings.
- Browser readback of the Listing V5 GET endpoint: HTTP 200.

Evidence artifacts are stored outside the repository, including desktop/mobile
screenshots and DOM snapshots for the THERMOS task.

## Explicit Limits

- The generated Listing remains subject to human review and must not be treated
  as directly publishable.
- The evidence proves a safe, traceable and persistent real Listing generation
  loop; it does not prove improved sales or conversion rate.
- The 1688 assistant connection interruption remains a known side-branch issue.
  It was not hidden and did not create sourcing facts for this Listing.
- The local DeepSeek TUN/proxy warning is an operator runtime note, not a change
  to Provider code or production configuration.
- Legacy Listing paths remain available as a low-cost rollback surface.

## Freeze Decision

No further Writer quality, Prompt, Validator, Benefit Contract or architecture
changes are included in this closeout.

```text
LISTING_V5_PRODUCT_CLOSURE = PASS
```
