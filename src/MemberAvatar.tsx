import clsx from "clsx";
import type { Member } from "./types";

export function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "AH";
}

export function MemberAvatar({
  member,
  className,
  title,
}: {
  member: Member;
  className?: string;
  title?: string;
}) {
  const name = member.profile?.display_name ?? "团队成员";
  return member.profile?.avatar_url ? (
    <img
      className={clsx("member-avatar-image", className)}
      src={member.profile.avatar_url}
      alt=""
      title={title}
    />
  ) : (
    <span
      className={clsx("member-avatar-image member-avatar-fallback", className)}
      title={title}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
