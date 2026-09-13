# THIRD_PARTY_NOTICES

本文件记录轻选工作台（`ecommerce-product-ai-optimizer`）在实现中参考或复用的第三方成果及其许可要求。

## awesome-gpt-image-2

- Repository: https://github.com/freestylefly/awesome-gpt-image-2
- License: MIT — `Copyright (c) 2026 freestylefly`
- MIT notice (as required by the upstream license):
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### What this project used (Image Style Library V1)

**Design ideas only — no upstream code, no upstream data, no upstream assets were copied:**

- The general idea of a static "style library + prompt-as-code" layer that turns a named visual style into ordered prompt sections.
- The general idea of a multi-axis taxonomy (category → style → scene) with bilingual labels.
- The general practice of validating a style library (unique ids, non-empty fields, resolvable references) and of keeping explicit negative/constraint fields.

**Explicitly NOT used:** the upstream gallery images, `data/cases.json` and its third-party case prompts, `docs/templates.md` prose, the skill's generated reference documents, and any site/payment/Supabase/auth/sponsor code. The upstream repository also states that its third-party case prompts and images are not guaranteed to be usable commercially; this project therefore ships none of them.

**Implementation is original:** `lib/imageStyleLibrary.ts` and `lib/imagePromptComposer.ts` are written for this project's own e-commerce domain, in its own schema, with its own wording. No upstream file was vendored, and no upstream repository is a runtime dependency.

### Product imagery

All style preview graphics in Image Studio are inline SVG drawn with CSS/SVG primitives inside this repository. No third-party example image is shipped or fetched at runtime, and the runtime never calls GitHub or any external style-library service.

---

_Inspired by: awesome-gpt-image-2 — Product Commerce Visual (design structure only)._
