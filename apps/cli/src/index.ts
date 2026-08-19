const help = [
  "RepoVista CLI",
  "",
  "Usage:",
  "  repovista analyze <https://github.com/owner/repository>",
  "",
  "The v0.1 CLI sends the repository to a running RepoVista API.",
].join("\n");

if (process.argv.includes("--help") || process.argv.length <= 2) {
  console.log(help);
} else {
  console.error("CLI analysis will be enabled after the API import endpoint is ready.");
  process.exitCode = 1;
}
