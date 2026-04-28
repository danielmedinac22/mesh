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

type Org = { login: string };

async function listOwnerLogins(): Promise<string[]> {
  // "@me" + every org the authenticated user belongs to.
  // `gh api user/orgs` requires the `read:org` scope (already granted by `gh auth login`).
  try {
    const orgs = await ghJson<Org[]>(["api", "user/orgs"]);
    return ["@me", ...orgs.map((o) => o.login)];
  } catch {
    return ["@me"];
  }
}

async function listReposForOwner(
  owner: string,
  limit: number,
  fields: string,
): Promise<GhRepo[]> {
  const args =
    owner === "@me"
      ? ["repo", "list", "--limit", String(limit), "--json", fields]
      : ["repo", "list", owner, "--limit", String(limit), "--json", fields];
  return ghJson<GhRepo[]>(args).catch(() => []);
}

async function searchOwner(
  owner: string,
  q: string,
  limit: number,
  fields: string,
): Promise<GhRepo[]> {
  return ghJson<GhRepo[]>([
    "search",
    "repos",
    q,
    "--owner",
    owner,
    "--limit",
    String(limit),
    "--json",
    fields,
  ]).catch(() => listReposForOwner(owner, limit, fields));
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? "50") || 50,
    200,
  );
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const ownerFilter = req.nextUrl.searchParams.get("owner")?.trim() || null;

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
      const owners = ownerFilter ? [ownerFilter] : await listOwnerLogins();
      const buckets = await Promise.all(
        owners.map((o) => searchOwner(o, q, limit, fields)),
      );
      const needle = q.toLowerCase();
      repos = buckets
        .flat()
        .filter(
          (r) =>
            r.nameWithOwner.toLowerCase().includes(needle) ||
            (r.description ?? "").toLowerCase().includes(needle),
        );
    } else {
      const owners = ownerFilter ? [ownerFilter] : await listOwnerLogins();
      const buckets = await Promise.all(
        owners.map((o) => listReposForOwner(o, limit, fields)),
      );
      repos = buckets.flat();
    }

    // Dedupe and sort by most recently updated; cap at limit.
    const seen = new Set<string>();
    repos = repos
      .filter((r) => {
        if (seen.has(r.nameWithOwner)) return false;
        seen.add(r.nameWithOwner);
        return true;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, limit);

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
