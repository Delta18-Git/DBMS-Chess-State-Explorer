// Small stroke icon set (24px grid, drawn for this app). Usage: <Icon name="search" />
const paths: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  games: "M4 6h16M4 12h16M4 18h10",
  players: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  book: "M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13",
  explore: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M15.5 8.5l-2 5-5 2 2-5z",
  merge: "M6 3v4a5 5 0 0 0 5 5h2a5 5 0 0 1 5 5v4M18 3v4a5 5 0 0 1-5 5M6 21l0-2",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  key: "M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0M12 12v9M12 17h3M12 20h2",
  shield: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6 6 18",
  first: "M18 6l-6 6 6 6M8 6v12",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  last: "M6 6l6 6-6 6M16 6v12",
  flip: "M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3",
  cpu: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  graph: "M6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4M8 7.5l8 3.5M8 16.5l8-3.5",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  users: "M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 20v-2a4 4 0 0 0-3-3.9",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  check: "M5 12l5 5L20 7",
  sortUp: "M12 19V5M6 11l6-6 6 6",
  sortDown: "M12 5v14M6 13l6 6 6-6",
};

export function Icon({ name, className = "", title }: { name: keyof typeof paths | string; className?: string; title?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

/** The app mark: the knight from public/knight.png, used as a CSS mask so it takes the text colour.
 *  The favicon (src/app/icon.png) is the same image on the same dark tile. */
export function Knight() {
  return <span className="knight" aria-hidden />;
}
