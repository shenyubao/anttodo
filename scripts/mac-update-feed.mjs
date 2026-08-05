import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * @param {string} file
 * @returns {string}
 */
export function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

/**
 * Build electron-updater generic-provider metadata for macOS ZIP artifacts.
 * @param {{ fileName: string, file: string, size: number }[]} zipArtifacts
 * @param {string} publishVersion
 * @param {{ now?: () => Date }} [options]
 */
export function buildLatestMacYml(zipArtifacts, publishVersion, options = {}) {
  if (!zipArtifacts.length) {
    throw new Error("latest-mac.yml requires at least one ZIP artifact");
  }
  const now = options.now ?? (() => new Date());
  const files = zipArtifacts.map((artifact) => ({
    url: artifact.fileName,
    sha512: sha512Base64(artifact.file),
    size: artifact.size,
  }));
  const primary =
    files.find((file) => file.url.includes("-arm64.")) ?? files[0];
  const lines = [
    `version: ${publishVersion}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${now().toISOString()}'`,
  ];
  return `${lines.join("\n")}\n`;
}
