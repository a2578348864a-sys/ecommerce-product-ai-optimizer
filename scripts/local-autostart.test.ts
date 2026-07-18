import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REGISTER_SCRIPT = resolve("scripts/register-local-autostart.ps1");
const RUN_SCRIPT = resolve("scripts/run-local-service.ps1");

describe("local 3005 autostart", () => {
  it("provides a reversible current-user logon task that runs the guarded local entry", () => {
    expect(existsSync(REGISTER_SCRIPT)).toBe(true);
    expect(existsSync(RUN_SCRIPT)).toBe(true);

    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(packageJson.scripts["autostart:local"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-local-autostart.ps1 register",
    );
    expect(packageJson.scripts["autostart:local:status"]).toContain(" status");
    expect(packageJson.scripts["autostart:local:remove"]).toContain(" remove");

    const registerScript = readFileSync(REGISTER_SCRIPT, "utf8");
    expect(registerScript).toContain("New-ScheduledTaskTrigger -AtLogOn");
    expect(registerScript).toContain("New-ScheduledTaskTrigger -Once");
    expect(registerScript).toContain("-RepetitionInterval (New-TimeSpan -Minutes 1)");
    expect(registerScript).toContain("MultipleInstances IgnoreNew");
    expect(registerScript).toContain("run-local-service.ps1");
    expect(registerScript).toContain("Unregister-ScheduledTask");

    const runScript = readFileSync(RUN_SCRIPT, "utf8");
    expect(runScript).toContain("Get-Command npm.cmd");
    expect(runScript).toContain('-ArgumentList @("run", "start:local")');
    expect(runScript).toContain("Start-Process");
    expect(runScript).toContain("local_3005_started");
    expect(runScript).not.toContain("DATABASE_URL");
  });
});
