export function embeddedNavigationEnabled({
  search,
  desktop = false,
  native = false,
}: {
  search: string;
  desktop?: boolean;
  native?: boolean;
}) {
  return !desktop
    && !native
    && new URLSearchParams(search).get("hideMenu") === "true";
}
