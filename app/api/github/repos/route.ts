import { NextRequest, NextResponse } from "next/server";
import { ghJson, GhError, parseGithubRef } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GhRepo = {
  nameWithOwner: string;
  name: string;
  owner: { login: string };
  description: string | null;
  defaultBranchRef: { name: string } | null;
  isPrivate: boolean;
  updatedAt: string;
  url: string;
  primaryLanguage?: { name: string } | null;
};

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? "50") || 50,
    200,
  );
  const q = req.nextUrl.searchParams.get("q")?.trim();

  try {
    const fields =
      "nameWithOwner,name,owner,description,defaultBranchRef,isPrivate,updatedAt,url,primaryLanguage";
    let repos: GhRepo[];
    const ref = q ? parseGithubRef(q) : null;
    if (ref) {
      // Explicit owner/repo lookup (accepts URLs, owner/repo pairs)
      const r = await ghJson<GhRepo>([
        "repo",
        "view",
        `${ref.owner}/${ref.repo}`,
        "--json",
        fields,
      ]);
      repos = [r];
    } else if (q) {
      repos = await ghJson<GhRepo[]>([
        "search",
        "repos",
        q,
        "--owner",
        "@me",
        "--limit",
        String(limit),
        "--json",
        fields,
      ]).catch(async () =>
        ghJson<GhRepo[]>([
          "repo",
          "list",
          "--limit",
          String(limit),
          "--json",
          fields,
        ]),
      );
      const needle = q.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.nameWithOwner.toLowerCase().includes(needle) ||
          (r.description ?? "").toLowerCase().includes(needle),
      );
    } else {
      repos = await ghJson<GhRepo[]>([
        "repo",
        "list",
        "--limit",
        String(limit),
        "--json",
        fields,
      ]);
    }

    return NextResponse.json({
      repos: repos.map((r) => ({
        nameWithOwner: r.nameWithOwner,
        name: r.name,
        owner: r.owner.login,
        description: r.description,
        defaultBranch: r.defaultBranchRef?.name ?? "main",
        isPrivate: r.isPrivate,
        updatedAt: r.updatedAt,
        url: r.url,
        language: r.primaryLanguage?.name ?? null,
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
