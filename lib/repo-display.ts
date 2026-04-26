export type RepoDisplayInput = {
  name: string;
  githubRepo?: string;
};

export function displayRepoName(repo: RepoDisplayInput): string {
  return repo.githubRepo?.trim() || repo.name;
}

export function displayRepoNameFor(
  name: string,
  registry: ReadonlyArray<RepoDisplayInput>,
): string {
  const hit = registry.find((r) => r.name === name);
  return hit ? displayRepoName(hit) : name;
}
