import { NextResponse } from "next/server";
import { ghJson, GhError } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Org = { login: string };
type User = { login: string };

export async function GET() {
  try {
    const [user, orgs] = await Promise.all([
      ghJson<User>(["api", "user"]),
      ghJson<Org[]>(["api", "user/orgs"]).catch(() => [] as Org[]),
    ]);
    return NextResponse.json({
      owners: [
        { login: user.login, kind: "user" as const },
        ...orgs.map((o) => ({ login: o.login, kind: "org" as const })),
      ],
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
