import { describe, expect, it } from "vitest";
import { sanitizeUnsupportedCertificationClaims } from "./alphaSafety";

const forbiddenPatterns = [
  /FDA\s*认证/i,
  /CE\s*认证/i,
  /FCC\s*认证/i,
  /CPC\s*认证/i,
  /ASTM\s*认证/i,
  /CPSIA\s*认证/i,
  /RoHS\s*认证/i,
  /通过\s*(?:FDA|CE|FCC|CPC|ASTM|CPSIA)/i,
  /符合\s*(?:FDA|CE|FCC|CPC|ASTM|CPSIA)/i,
  /已认证/,
  /已通过认证/,
  /安全认证齐全/,
  /认证齐全/,
  /100%\s*安全/,
  /绝对安全/,
  /无毒保证/,
  /食品级保证/,
  /婴幼儿安全/,
  /儿童安全认证/,
];

function expectSafe(text: string) {
  for (const pattern of forbiddenPatterns) {
    expect(text).not.toMatch(pattern);
  }
  expect(text).toMatch(/供应商|人工复核|未验证前|索取|合规文件|测试报告|检测报告|不要写入/);
}

describe("sanitizeUnsupportedCertificationClaims", () => {
  it("中文 FDA / FCC 认证表达会转成人工复核提醒", () => {
    const output = sanitizeUnsupportedCertificationClaims("卖点写 FDA 认证、FDA认证、FCC 认证齐全，适合桌面手机支架。");

    expectSafe(output);
    expect(output).toMatch(/FDA|FCC/);
  });

  it("儿童用品 CPC / ASTM / CPSIA 认证表达会转成人工复核提醒", () => {
    const output = sanitizeUnsupportedCertificationClaims("产品通过 CPC 认证，符合 ASTM 标准，CPSIA认证齐全，儿童安全认证。");

    expectSafe(output);
    expect(output).toMatch(/CPC|ASTM|CPSIA/);
  });

  it("通过/符合/已认证/认证齐全等承诺会被替换", () => {
    const output = sanitizeUnsupportedCertificationClaims("已认证，已通过认证，安全认证齐全，认证齐全，符合 CE，通过 FDA。");

    expectSafe(output);
  });

  it("100% 安全、绝对安全、无毒保证、食品级保证会被替换", () => {
    const output = sanitizeUnsupportedCertificationClaims("100% 安全，绝对安全，无毒保证，食品级保证，婴幼儿安全。");

    expectSafe(output);
  });

  it("允许保留人工复核、索取文件和未验证前不写入承诺的安全表达", () => {
    const safeText = "需向供应商索取相关测试报告，需人工复核认证文件，未验证前不要写入 listing 承诺。";

    expect(sanitizeUnsupportedCertificationClaims(safeText)).toBe(safeText);
  });
});
