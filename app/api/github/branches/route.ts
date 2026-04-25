import { NextRequest, NextResponse } from "next/server";
import { ghJson, GhError } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GhBranch = {
  name: string;
  commit: { sha: string };
  protected: boolean;
};

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner");
  const repo = req.nextUrl.searchParams.get("repo");
  if (!owner || !repo) {
    return NextResponse.json(
      { error: "owner and repo required" },
      { status: 400 },
    );
  }
  try {
    const branches = await ghJson<GhBranch[]>([
      "api",
      `/repos/${owner}/${repo}/branches?per_page=100`,
    ]);
    return NextResponse.json({
      branches: branches.map((b) => ({
        name: b.name,
        sha: b.commit.sha,
        protected: b.protected,
      })),
    });
  } catch (err) {
    const msg =
      err instanceof GhError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
