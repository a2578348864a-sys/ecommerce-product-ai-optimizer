/**
 * V3 Final Product Integration — F3 Sourcing 分能力 readiness（客户端纯函数）
 *
 * 单一 global 1688Ready 已拆分：CLI_READY（关键词/URL/详情）与 IMAGE_EXTENSION_READY（图片找货）
 * 独立判定；服务端 GET /sourcing 返回 toolStatus{ loggedIn, toolAvailable, cli, image }。
 */

export type SourcingImageCapability = {
  extensionAvailable: boolean;
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
};

export function sourcingCapabilities(status: SourcingToolStatus | null): SourcingCapabilities {
  const cli = status?.cli ?? {
    loggedIn: status?.loggedIn ?? false,
    toolAvailable: status?.toolAvailable ?? false,
  };
  const image = status?.image ?? { extensionAvailable: false, reasonCode: "unknown" };
  return {
    cliReady: cli.loggedIn === true,
    cliToolAvailable: cli.toolAvailable === true,
    imageReady: image.extensionAvailable === true,
    imageReasonCode: typeof image.reasonCode === "string" ? image.reasonCode : "unknown",
  };
}
