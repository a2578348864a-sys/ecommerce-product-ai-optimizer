"use client";

import Link from "next/link";
import { useState, type ComponentProps, type MouseEvent } from "react";

type StudioNavigationLinkProps = Omit<ComponentProps<typeof Link>, "children" | "onClick"> & {
  label: string;
  pendingLabel: string;
};

export function StudioNavigationLink({
  label,
  pendingLabel,
  ...props
}: StudioNavigationLinkProps) {
  const [pending, setPending] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }
    setPending(true);
  }

  return (
    <Link
      {...props}
      prefetch={true}
      aria-busy={pending}
      data-studio-nav-pending={pending ? "true" : "false"}
      onClick={handleClick}
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          {pendingLabel}
        </span>
      ) : label}
    </Link>
  );
}
