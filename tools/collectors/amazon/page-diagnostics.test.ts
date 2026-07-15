import { describe, expect, it } from "vitest";
import fixture from "./fixtures/page-diagnostics.v1.json";
import loginFixture from "./fixtures/login-wall-diagnostics.v1.json";
import privacyFixture from "./fixtures/privacy-diagnostics.v1.json";
import {
  buildAmazonPageDiagnosticDomExpression,
  buildAmazonPageDiagnostic,
  classifyAmazonPrivacyPrompt,
  inspectAmazonPageDiagnosticDom,
  sanitizeDiagnosticText,
  type AmazonPageDiagnosticInput,
  type AmazonPrivacyPromptCandidate,
} from "./page-diagnostics";

type FixtureOverride = Partial<Omit<AmazonPageDiagnosticInput, "markers" | "markerSources">> & {
  markers?: Partial<AmazonPageDiagnosticInput["markers"]>;
  markerSources?: Partial<AmazonPageDiagnosticInput["markerSources"]>;
};

function fixtureInput(override: FixtureOverride = {}): AmazonPageDiagnosticInput {
  const base = fixture.base as AmazonPageDiagnosticInput;
  return {
    ...base,
    ...override,
    redirectUrls: override.redirectUrls ?? [...base.redirectUrls],
    markers: { ...base.markers, ...override.markers },
    markerSources: { ...base.markerSources, ...override.markerSources },
  };
}

function privacyDocument(input: {
  source: "known" | "semantic" | "footer" | null;
  visible?: boolean;
  interactive?: boolean;
  bodyText?: string;
}) {
  const visible = input.visible ?? true;
  const interactive = input.interactive ?? false;
  const control = {
    textContent: "Accept Reject Manage preferences",
    getAttribute: () => null,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const container = {
    textContent: "Privacy choices Accept Reject Manage preferences",
    tagName: input.source === "footer" ? "A" : "DIV",
    hasAttribute: () => false,
    getAttribute(name: string) {
      if (name === "role") return input.source === "semantic" ? "dialog" : input.source === "known" ? "banner" : null;
      return null;
    },
    getBoundingClientRect: () => visible ? ({ width: 500, height: 120 }) : ({ width: 0, height: 0 }),
    querySelectorAll: () => interactive ? [control] : [],
    closest: () => input.source === "footer" ? {} : null,
  };
  const root = {
    readyState: "complete",
    title: "Amazon.com : closet organizer",
    body: { innerText: input.bodyText ?? "Amazon Search Deliver to New York 10001", textContent: "" },
    defaultView: {
      getComputedStyle(element: unknown) {
        return element === container && !visible
          ? { display: "none", visibility: "hidden", opacity: "0", position: "static" }
          : { display: "block", visibility: "visible", opacity: "1", position: "static" };
      },
    },
    querySelector(selector: string) {
      const marker = {};
      if (selector.startsWith("#nav-logo") || selector.startsWith("#twotabsearchtextbox")
        || selector.startsWith("#nav-global-location-popover-link")) return marker;
      return null;
    },
    querySelectorAll(selector: string) {
      if (input.source === "known" && selector.includes("#sp-cc")) return [container];
      if (input.source === "semantic" && selector.startsWith("[role='dialog']")) return [container];
      if (input.source === "footer" && selector.startsWith("footer a")) return [container];
      return [];
    },
  };
  return root as unknown as Document;
}

function loginDocument(input: {
  candidate: "signin_form" | null;
  visible: boolean;
  insideNavigation: boolean;
  hasInteractiveControls: boolean;
  blocksMainContent: boolean;
  bodyText: string;
}) {
  const control = {
    textContent: "Continue",
    tagName: "INPUT",
    hasAttribute: () => false,
    getAttribute(name: string) {
      if (name === "type") return "submit";
      return null;
    },
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
  };
  const candidate = {
    textContent: "Sign in token=abcdefghijklmnopqrstuvwxyz1234567890 person@example.com",
    tagName: "FORM",
    hasAttribute: () => false,
    getAttribute(name: string) {
      if (name === "name") return "signIn";
      if (name === "action") return "/ap/signin";
      if (name === "aria-modal") return input.blocksMainContent ? "true" : null;
      if (name === "role") return input.blocksMainContent ? "dialog" : null;
      return null;
    },
    getBoundingClientRect: () => input.visible ? ({ width: 420, height: 320 }) : ({ width: 0, height: 0 }),
    querySelectorAll: () => input.hasInteractiveControls ? [control] : [],
    closest(selector: string) {
      return input.insideNavigation && /nav|header|footer|navigation/i.test(selector) ? {} : null;
    },
  };
  const marker = {};
  const root = {
    readyState: "complete",
    title: "Amazon.com. Spend less. Smile more.",
    body: { innerText: input.bodyText, textContent: input.bodyText },
    defaultView: {
      getComputedStyle(element: unknown) {
        if (element === candidate) {
          return input.visible
            ? { display: "block", visibility: "visible", opacity: "1", position: input.blocksMainContent ? "fixed" : "static" }
            : { display: "none", visibility: "hidden", opacity: "0", position: "static" };
        }
        return { display: "block", visibility: "visible", opacity: "1", position: "static" };
      },
    },
    querySelector(selector: string) {
      if (selector.startsWith("#nav-logo") || selector.startsWith("#twotabsearchtextbox")
        || selector.startsWith("#nav-global-location-popover-link")) return marker;
      if (input.candidate && selector.includes("form[name='signIn']")) return candidate;
      return null;
    },
    querySelectorAll(selector: string) {
      return input.candidate && (selector.includes("form[name='signIn']") || selector.includes("form[action*='signin']"))
        ? [candidate]
        : [];
    },
  };
  return root as unknown as Document;
}

describe("Amazon page fail-closed diagnostics", () => {
  it.each(fixture.cases)("classifies $name through the production classifier", ({ expected, override }) => {
    const diagnostic = buildAmazonPageDiagnostic(fixtureInput(override as FixtureOverride));
    expect(diagnostic.classification).toBe(expected);
    expect(diagnostic.classificationReasonCodes.length).toBeGreaterThan(0);
    expect(diagnostic.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
  });

  it("stores only safe URL origin/path and redirect origins", () => {
    const diagnostic = buildAmazonPageDiagnostic(fixtureInput({
      requestedUrl: "https://www.amazon.com/s?k=closet+organizer&token=private#secret",
      finalUrl: "https://www.amazon.com/s?k=closet+organizer&session=private",
      redirectUrls: [
        "https://www.amazon.com/?token=private",
        "https://amazon.com/s?k=closet+organizer",
      ],
    }));

    expect(diagnostic.requestedUrl).toEqual({ origin: "https://www.amazon.com", path: "/s" });
    expect(diagnostic.finalUrl).toEqual({ origin: "https://www.amazon.com", path: "/s" });
    expect(diagnostic.redirectOrigins).toEqual(["https://www.amazon.com", "https://amazon.com"]);
    expect(JSON.stringify(diagnostic)).not.toContain("private");
    expect(JSON.stringify(diagnostic)).not.toContain("closet+organizer");
  });

  it("redacts secrets and personal identifiers from bounded diagnostic text", () => {
    const unsafe = [
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "cookie=session-secret-value",
      "password=hunter2",
      "person@example.com",
      "token=abcdef1234567890abcdef1234567890",
    ].join(" ");
    const sanitized = sanitizeDiagnosticText(unsafe, 240);
    const diagnostic = buildAmazonPageDiagnostic(fixtureInput({ title: unsafe, visibleText: unsafe }));
    const serialized = JSON.stringify(diagnostic);

    expect(sanitized).toContain("[REDACTED]");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("session-secret-value");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(diagnostic.title?.length).toBeLessThanOrEqual(160);
    expect(diagnostic.diagnosticTextSnippet?.length).toBeLessThanOrEqual(320);
    expect(diagnostic).not.toHaveProperty("visibleText");
    expect(diagnostic).not.toHaveProperty("html");
  });

  it("changes the evidence Hash when any critical diagnostic field changes", () => {
    const base = buildAmazonPageDiagnostic(fixtureInput());
    const mutations: FixtureOverride[] = [
      { requestedUrl: "https://www.amazon.com/s" },
      { finalUrl: "https://www.amazon.com/gp/bestsellers" },
      { redirectUrls: ["https://amazon.com/"] },
      { mainDocumentHttpStatus: 204 },
      { mainDocumentContentType: "application/xhtml+xml" },
      { navigationElapsedMs: 421 },
      { domWaitElapsedMs: 181 },
      { readyState: "interactive" },
      { title: "Amazon alternate title" },
      { visibleText: "Amazon alternate visible diagnostic text" },
      { markerSources: { searchBox: "alternate" } },
      { markers: { privacyPrompt: {
        ...fixtureInput().markers.privacyPrompt,
        state: "visible_blocking_prompt",
        markerSource: "known_generic_container",
        selectorCategory: "generic_consent_banner",
        tagName: "div",
        role: "banner",
        visible: true,
        hasInteractiveControls: true,
        insideFooter: false,
        blocksMainContent: false,
        matchedText: "Cookie preferences Accept Reject",
        reasonCodes: ["privacy_visible_interactive_prompt"],
      } } },
    ];

    for (const mutation of mutations) {
      expect(buildAmazonPageDiagnostic(fixtureInput(mutation)).evidenceHash).not.toBe(base.evidenceHash);
    }
  });

  it("changes the evidence Hash when any Privacy diagnostic field changes", () => {
    const baseInput = fixtureInput();
    const baseHash = buildAmazonPageDiagnostic(baseInput).evidenceHash;
    const privacyMutations: Array<Partial<typeof baseInput.markers.privacyPrompt>> = [
      { markerSource: "page_text" },
      { selectorCategory: "page_text" },
      { tagName: "div" },
      { role: "banner" },
      { visible: false },
      { hasInteractiveControls: false },
      { insideFooter: true },
      { blocksMainContent: false },
      { matchedText: "Privacy Notice" },
      { reasonCodes: ["privacy_page_text_only"] },
    ];

    for (const mutation of privacyMutations) {
      const privacyPrompt = { ...baseInput.markers.privacyPrompt, ...mutation };
      const diagnostic = buildAmazonPageDiagnostic(fixtureInput({ markers: { privacyPrompt } }));
      expect(diagnostic.evidenceHash).not.toBe(baseHash);
    }
  });

  it.each(privacyFixture.cases)("classifies privacy fixture $name through the production classifier", (testCase) => {
    const result = classifyAmazonPrivacyPrompt({
      candidates: testCase.candidates as AmazonPrivacyPromptCandidate[],
      pageTextMatched: testCase.pageTextMatched,
    });

    expect(result.state).toBe(testCase.expected);
    expect(result.reasonCodes.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("does not block an otherwise normal Amazon page for ordinary Privacy body text", () => {
    const input = fixtureInput({
      visibleText: "Amazon Search Deliver to New York 10001 Privacy Notice",
      markers: {
        privacyPrompt: {
          ...fixtureInput().markers.privacyPrompt,
          state: "page_text_only",
          markerSource: "page_text",
          selectorCategory: "page_text",
          matchedText: "Privacy Notice",
          reasonCodes: ["privacy_page_text_only"],
        },
      },
    });

    const diagnostic = buildAmazonPageDiagnostic(input);
    expect(diagnostic.classification).toBe("amazon_normal");
    expect(diagnostic.privacyPrompt.state).toBe("page_text_only");
    expect(diagnostic.classificationReasonCodes).not.toContain("privacy_prompt_visible");
  });

  it.each([
    ["visible known banner", privacyDocument({ source: "known", interactive: true }), "visible_blocking_prompt"],
    ["changed selector", privacyDocument({ source: "semantic", interactive: true }), "unknown"],
    ["footer link", privacyDocument({ source: "footer", bodyText: "Amazon Privacy Notice" }), "page_text_only"],
    ["hidden retained node", privacyDocument({ source: "known", visible: false, interactive: true }), "page_text_only"],
    ["ordinary body word", privacyDocument({ source: null, bodyText: "Product privacy notice" }), "page_text_only"],
  ] as const)("extracts %s through the real DOM inspector", (_name, root, expected) => {
    expect(inspectAmazonPageDiagnosticDom(root).markers.privacyPrompt.state).toBe(expected);
  });

  it("sanitizes bounded Privacy hit text before it reaches evidence", () => {
    const privacy = classifyAmazonPrivacyPrompt({
      pageTextMatched: true,
      candidates: [{
        markerSource: "known_generic_container",
        selectorCategory: "generic_consent_banner",
        tagName: "div",
        role: "banner",
        visible: true,
        hasInteractiveControls: true,
        insideFooter: false,
        blocksMainContent: false,
        matchedText: "Cookie preferences token=abcdefghijklmnopqrstuvwxyz1234567890 Accept Reject",
      }],
    });
    const diagnostic = buildAmazonPageDiagnostic(fixtureInput({ markers: { privacyPrompt: privacy } }));

    expect(diagnostic.privacyPrompt.matchedText).toContain("[REDACTED]");
    expect(JSON.stringify(diagnostic)).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });

  it("uses the real DOM inspector for primary and lightly changed Amazon marker structures", () => {
    function documentWith(markerVariant: "primary" | "alternate") {
      const node = {};
      return {
        readyState: "complete",
        title: "Amazon.com",
        body: { innerText: "Amazon Search Deliver to New York 10001", textContent: "" },
        querySelector(selector: string) {
          if (markerVariant === "primary") {
            return selector.startsWith("#nav-logo") || selector.startsWith("#twotabsearchtextbox")
              || selector.startsWith("#nav-global-location-popover-link") ? node : null;
          }
          return selector.includes("[aria-label='Amazon']") || selector.includes("input[name='field-keywords']")
            || selector.includes("[aria-label*='location' i]") ? node : null;
        },
      } as unknown as Document;
    }

    for (const markerVariant of ["primary", "alternate"] as const) {
      const root = documentWith(markerVariant);
      const direct = inspectAmazonPageDiagnosticDom(root);
      const expression = buildAmazonPageDiagnosticDomExpression();
      const throughBrowserExpression = Function("document", `return ${expression}`)(root);
      const diagnostic = buildAmazonPageDiagnostic(fixtureInput({ ...direct }));

      expect(throughBrowserExpression).toEqual(direct);
      expect(diagnostic.classification).toBe(markerVariant === "primary" ? "amazon_normal" : "amazon_normal_variant");
    }
  });

  it.each(loginFixture.cases)("classifies login fixture $name through the real DOM inspector", (testCase) => {
    const root = loginDocument({
      candidate: testCase.candidate as "signin_form" | null,
      visible: testCase.visible,
      insideNavigation: testCase.insideNavigation,
      hasInteractiveControls: testCase.hasInteractiveControls,
      blocksMainContent: testCase.blocksMainContent,
      bodyText: testCase.bodyText,
    });
    const signals = inspectAmazonPageDiagnosticDom(root);
    const expressionSignals = Function("document", `return ${buildAmazonPageDiagnosticDomExpression()}`)(root) as typeof signals;
    const loginWall = signals.markers.loginWall as unknown as { state: string; matchedText: string | null };
    const diagnostic = buildAmazonPageDiagnostic(fixtureInput({
      visibleText: signals.visibleText,
      visibleTextLength: signals.visibleTextLength,
      markers: { loginWall: signals.markers.loginWall },
    }));
    const loginEvidence = (diagnostic as unknown as { loginWall: { state: string; matchedText: string | null } }).loginWall;

    expect(expressionSignals.markers.loginWall).toEqual(signals.markers.loginWall);
    expect(loginWall.state).toBe(testCase.expectedState);
    expect(diagnostic.classification).toBe(testCase.expectedClassification);
    expect(loginEvidence.state).toBe(testCase.expectedState);
    if (testCase.candidate) {
      expect(loginEvidence.matchedText).toContain("[REDACTED]");
      expect(JSON.stringify(diagnostic)).not.toContain("person@example.com");
      expect(JSON.stringify(diagnostic)).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
    }
  });

  it("includes every structured Login Wall diagnostic field in the evidence Hash", () => {
    const root = loginDocument({
      candidate: "signin_form",
      visible: false,
      insideNavigation: true,
      hasInteractiveControls: true,
      blocksMainContent: false,
      bodyText: "Amazon Search Deliver to New York 10001",
    });
    const signals = inspectAmazonPageDiagnosticDom(root);
    const base = buildAmazonPageDiagnostic(fixtureInput({ markers: { loginWall: signals.markers.loginWall } }));
    const loginWall = signals.markers.loginWall as unknown as Record<string, unknown>;
    const mutations = [
      { state: "unknown" },
      { markerSource: "explicit_page_text" },
      { selectorCategory: "explicit_continue_text" },
      { tagName: "aside" },
      { role: "dialog" },
      { visible: true },
      { hasInteractiveControls: false },
      { insideNavigation: false },
      { blocksMainContent: true },
      { matchedText: "Sign in to continue" },
      { reasonCodes: ["login_page_text_without_container"] },
    ];

    for (const mutation of mutations) {
      const diagnostic = buildAmazonPageDiagnostic(fixtureInput({
        markers: { loginWall: { ...loginWall, ...mutation } as unknown as boolean },
      }));
      expect(diagnostic.evidenceHash).not.toBe(base.evidenceHash);
    }
  });

  it("keeps legacy boolean Login Wall evidence fail-closed without treating false as a marker", () => {
    const legacyTrue = buildAmazonPageDiagnostic(fixtureInput({ markers: { loginWall: true } }));
    const legacyFalse = buildAmazonPageDiagnostic(fixtureInput({ markers: { loginWall: false } }));

    expect(legacyTrue.classification).toBe("login_wall");
    expect(legacyTrue.loginWall.state).toBe("unknown");
    expect(legacyTrue.classificationReasonCodes).toEqual(["login_wall_unknown"]);
    expect(legacyTrue.loginWall.reasonCodes).toEqual(["login_legacy_boolean_marker_unconfirmed"]);
    expect(legacyFalse.classification).toBe("amazon_normal");
    expect(legacyFalse.loginWall.state).toBe("absent");
    expect(legacyFalse.loginWallMarker).toBe(false);
  });
});
