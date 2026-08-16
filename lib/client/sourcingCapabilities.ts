/**
 * V3 Final Product Integration — F3 Sourcing 分能力 readiness（客户端纯函数）
 *
 * 单一 global 1688Ready 已拆分：CLI_READY（关键词/URL/详情）与 IMAGE_EXTENSION_READY（图片找货）
 * 独立判定；服务端 GET /sourcing 返回 toolStatus{ loggedIn, toolAvailable, cli, image }。
 */

export type SourcingImageCapability = {
  extensionAvailable: boolean;
  /** V3 Final R13：扩展 SW 版本与期望协议版本一致（Protocol Handshake） */
  versionCompatible?: boolean;
  extensionSwVersion?: string | null;
  reasonCode?: string;
};

export type SourcingCliCapability = {
  loggedIn: boolean;
  toolAvailable: boolean;
};

export type SourcingToolStatus = SourcingCliCapability & {
  cli?: SourcingCliCapability;
  image?: SourcingImageCapability;
};

export type SourcingCapabilities = {
  /** 关键词找货 / 1688 URL / 详情 依赖本地 1688-cli 登录 */
  cliReady: boolean;
  cliToolAvailable: boolean;
  /** 图片找货依赖普通 Chrome + Qingxuan 1688 Helper 扩展（不依赖 1688-cli） */
  imageReady: boolean;
  imageReasonCode: string;
  /** V3 Final R13：扩展协议兼容（版本匹配才算 READY；不匹配 → HELPER_OUTDATED） */
  imageVersionCompatible: boolean;
  imageExtensionSwVersion: string | null;
};

export function sourcingCapabilities(status: SourcingToolStatus | null): SourcingCapabilities {
  const cli = status?.cli ?? {
    loggedIn: status?.loggedIn ?? false,
    toolAvailable: status?.toolAvailable ?? false,
  };
  const image = status?.image ?? { extensionAvailable: false, reasonCode: "unknown" };
  const versionCompatible = image.versionCompatible !== false;
  return {
    cliReady: cli.loggedIn === true,
    cliToolAvailable: cli.toolAvailable === true,
    // V3 Final R13（§197）：连接 ≠ READY——版本不兼容不假绿
    imageReady: image.extensionAvailable === true && versionCompatible,
    imageReasonCode: typeof image.reasonCode === "string" ? image.reasonCode : "unknown",
    imageVersionCompatible: versionCompatible,
    imageExtensionSwVersion: typeof image.extensionSwVersion === "string" ? image.extensionSwVersion : null,
  };
}
