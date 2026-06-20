export function getListId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("list");
  } catch {
    return null;
  }
}

export function getVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtu.be/<id>
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    // /shorts/<id>
    const shorts = u.pathname.match(/\/shorts\/([^/?#]+)/);
    if (shorts) return shorts[1];
    // ?v=<id>
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

export function buildWatchUrl(videoId: string, listId: string | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return listId ? `${base}&list=${listId}` : base;
}
