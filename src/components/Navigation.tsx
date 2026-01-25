"use client";

import Link from "next/link";

interface NavItem {
  label: string;
  href: string;
}

const mainNavItems: NavItem[] = [
  { label: "ventures", href: "/ventures" },
  { label: "travel", href: "/travel" },
  { label: "food", href: "/food" },
  { label: "design", href: "/design" },
];

const sidebarNavItems: NavItem[] = [
  { label: "evos", href: "/evos" },
  { label: "navigation", href: "/navigation" },
  { label: "learning", href: "/learning" },
  { label: "contact", href: "/contact" },
];

export function MainNavigation() {
  return (
    <nav className="flex flex-col items-end gap-2">
      <span className="text-xs uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
        navigation
      </span>
      {mainNavItems.map((item, index) => (
        <Link
          key={item.href}
          href={item.href}
          className="nav-link opacity-0 animate-fade-in-up"
          style={{ animationDelay: `${300 + index * 100}ms`, animationFillMode: "forwards" }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function SidebarNavigation() {
  return (
    <nav className="flex flex-col items-end gap-3">
      {sidebarNavItems.map((item, index) => (
        <Link
          key={item.href}
          href={item.href}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors duration-200 opacity-0 animate-fade-in-up"
          style={{ animationDelay: `${600 + index * 100}ms`, animationFillMode: "forwards" }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

