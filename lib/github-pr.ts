import { Octokit } from "@octokit/rest";
import {
  getRemoteOwnerRepo,
  pushCurrentBranch,
  getCurrentBranch,
} from "@/lib/github";

export type PrOutcome = {
  repo: string;
  title: string;
  body: string;
  url: string;
  html_url?: string;
  simulated: boolean;
  number?: number;
  pushed: boolean;
  push_reason?: string;
};

// Attempt to push the current branch and open a PR via Octokit. Falls back to
// a simulated URL when either (a) no `origin` remote is configured, or (b)
// the push succeeds but there is no GITHUB_TOKEN, or (c) GitHub rejects the
// request. The fallback is always available per ROADMAP Day 3: "simulated PR
// URLs" is the network-failure safety net.
export async function openPr(args: {
  repoName: string;
  repoPath: string;
  base: string;
  title: string;
  body: string;
  forceSimulated?: boolean;
}): Promise<PrOutcome> {
  const head = await getCurrentBranch(args.repoPath);
  const remote = await getRemoteOwnerRepo(args.repoPath);
  const canTryReal =
    !args.forceSimulated && !!remote && !!process.env.GITHUB_TOKEN;

  if (!canTryReal) {
    return simulated({
      repoName: args.repoName,
      title: args.title,
      body: args.body,
      remote,
      head,
    });
  }

  const push = await pushCurrentBranch(args.repoPath);
  if (!push.pushed) {
    return {
      ...simulated({
        repoName: args.repoName,
        title: args.title,
        body: args.body,
        remote,
        head,
      }),
      pushed: false,
      push_reason: push.reason,
    };
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const res = await octokit.pulls.create({
      owner: remote!.owner,
      repo: remote!.repo,
      head,
      base: args.base,
      title: args.title,
      body: args.body,
      draft: true,
    });
    return {
      repo: args.repoName,
      title: args.title,
      body: args.body,
      url: res.data.html_url,
      html_url: res.data.html_url,
      number: res.data.number,
      simulated: false,
      pushed: true,
    };
  } catch (err) {
    // Fall back to simulated URL so the demo keeps moving.
    return {
      ...simulated({
        repoName: args.repoName,
        title: args.title,
        body: args.body,
        remote,
        head,
      }),
      pushed: true,
      push_reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function simulated(args: {
  repoName: string;
  title: string;
  body: string;
  remote: { owner: string; repo: string } | null;
  head: string;
}): PrOutcome {
  const owner = args.remote?.owner ?? "danielmedina-sim";
  const repo = args.remote?.repo ?? args.repoName;
  const pseudoNum = Math.floor(Math.random() * 90) + 10;
  const url = `https://github.com/${owner}/${repo}/pull/${pseudoNum}`;
  return {
    repo: args.repoName,
    title: args.title,
    body: args.body,
    url,
    simulated: true,
    pushed: false,
    number: pseudoNum,
  };
}
