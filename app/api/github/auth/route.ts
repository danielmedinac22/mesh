import { NextResponse } from "next/server";
import os from "node:os";
import { ghAuthStatus } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await ghAuthStatus();
  const platform = os.platform();
  const installHint =
    platform === "darwin"
      ? {
          command: "brew install gh",
          platform: "macOS",
          fallback: "See https://cli.github.com for other install methods.",
        }
      : platform === "linux"
        ? {
            command: "sudo apt install gh  # or: brew install gh",
            platform: "Linux",
            fallback: "See https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
          }
        : platform === "win32"
          ? {
              command: "winget install --id GitHub.cli",
              platform: "Windows",
              fallback: "See https://cli.github.com for other install methods.",
            }
          : {
              command: "See https://cli.github.com",
              platform,
              fallback: "",
            };
  return NextResponse.json({ ...status, installHint });
}
