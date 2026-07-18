export function isStage15ScreeningPreviewAvailable(environment: string | undefined): boolean {
  return environment === "development";
}
