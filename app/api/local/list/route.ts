import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ENTRIES = 500;

export type ListEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isGitRepo: boolean;
};

export type ListResponse = {
  path: string;
  parent: string | null;
  home: string;
  showHidden: boolean;
  truncated: boolean;
  entries: ListEntry[];
  error?: string;
};

export async function GET(req: NextRequest) {
  const home = os.homedir();
  const qPath = req.nextUrl.searchParams.get("path")?.trim() || home;
  const showHidden = req.nextUrl.searchParams.get("showHidden") === "1";

  if (!path.isAbsolute(qPath)) {
    return NextResponse.json<ListResponse>(
      {
        path: qPath,
        parent: null,
        home,
        showHidden,
        truncated: false,
        entries: [],
        error: "path must be absolute",
      },
      { status: 400 },
    );
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(qPath);
  } catch {
    return NextResponse.json<ListResponse>(
      {
        path: qPath,
        parent: null,
        home,
        showHidden,
        truncated: false,
        entries: [],
        error: "path not found",
      },
      { status: 404 },
    );
  }
  if (!stat.isDirectory()) {
    return NextResponse.json<ListResponse>(
      {
        path: qPath,
        parent: null,
        home,
        showHidden,
        truncated: false,
        entries: [],
        error: "not a directory",
      },
      { status: 400 },
    );
  }

  let raw: string[] = [];
  try {
    raw = await fs.readdir(qPath);
  } catch (err) {
    return NextResponse.json<ListResponse>(
      {
        path: qPath,
        parent: null,
        home,
        showHidden,
        truncated: false,
        entries: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const filtered = showHidden ? raw : raw.filter((n) => !n.startsWith("."));
  const truncated = filtered.length > MAX_ENTRIES;
  const slice = truncated ? filtered.slice(0, MAX_ENTRIES) : filtered;

  const entries: ListEntry[] = [];
  await Promise.all(
    slice.map(async (name) => {
      const full = path.join(qPath, name);
      let isDir = false;
      try {
        const s = await fs.stat(full);
        isDir = s.isDirectory();
      } catch {
        return;
      }
      if (!isDir) return;
      let isGitRepo = false;
      try {
        await fs.stat(path.join(full, ".git"));
        isGitRepo = true;
      } catch {
        isGitRepo = false;
      }
      entries.push({ name, path: full, isDir, isGitRepo });
    }),
  );

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(qPath);
  const parentOut = parent === qPath ? null : parent;

  return NextResponse.json<ListResponse>({
    path: qPath,
    parent: parentOut,
    home,
    showHidden,
    truncated,
    entries,
  });
}
