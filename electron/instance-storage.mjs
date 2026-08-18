import path from "node:path";

export function isValidInstanceNamespace(value) {
  return value === "official" || (typeof value === "string" && /^[0-9a-f]{32}$/.test(value));
}

export function instanceUserDataPath(root, namespace, userId) {
  if (!isValidInstanceNamespace(namespace)) throw new Error("Invalid instance namespace");
  if (typeof userId !== "string" || !/^[0-9a-f-]{20,}$/i.test(userId)) {
    throw new Error("Invalid local store user id");
  }
  return namespace === "official"
    ? path.join(root, "users", userId)
    : path.join(root, "instances", namespace, "users", userId);
}
