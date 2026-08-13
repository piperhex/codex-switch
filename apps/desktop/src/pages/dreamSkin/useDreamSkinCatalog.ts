import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDreamSkinCommunityPage, loadDreamSkinMarket } from "../../api/backend";
import type { DreamSkinCommunityTheme, DreamSkinMarketResult } from "../../types";
import { COMMUNITY_CATALOG_LIMIT, COMMUNITY_PAGE_SIZE } from "./constants";
import type { CatalogState, ThemeTab } from "./types";

function mergeThemes(
  current: DreamSkinCommunityTheme[],
  incoming: DreamSkinCommunityTheme[],
  reset: boolean,
) {
  const merged = reset ? [] : [...current];
  const positions = new Map(merged.map((theme, index) => [theme.id, index]));
  for (const theme of incoming) {
    const position = positions.get(theme.id);
    if (position === undefined) {
      positions.set(theme.id, merged.length);
      merged.push(theme);
    } else {
      merged[position] = theme;
    }
  }
  return merged;
}

export function useDreamSkinCatalog(themeTab: ThemeTab): CatalogState {
  const [market, setMarket] = useState<DreamSkinMarketResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketQuery, setMarketQuery] = useState("");
  const [communityThemes, setCommunityThemes] = useState<DreamSkinCommunityTheme[]>([]);
  const [communityTotal, setCommunityTotal] = useState<number | null>(null);
  const [communityInitialized, setCommunityInitialized] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityWarning, setCommunityWarning] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const totalRef = useRef<number | null>(null);
  const communitySentinelRef = useRef<HTMLDivElement | null>(null);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try { setMarket(await loadDreamSkinMarket()); }
    catch (loadError) { setMarketError(String(loadError)); }
    finally { setMarketLoading(false); }
  }, []);

  const loadCommunityThemes = useCallback(async (reset = false) => {
    if (loadingRef.current) return;
    const offset = reset ? 0 : offsetRef.current;
    const knownTotal = totalRef.current;
    if (!reset && knownTotal !== null && offset >= Math.min(knownTotal, COMMUNITY_CATALOG_LIMIT)) return;
    loadingRef.current = true;
    setCommunityLoading(true);
    setCommunityError(null);
    if (reset) setCommunityWarning(null);
    try {
      const page = await loadDreamSkinCommunityPage(offset, COMMUNITY_PAGE_SIZE);
      const total = Math.min(page.total, COMMUNITY_CATALOG_LIMIT);
      offsetRef.current = Math.min(COMMUNITY_CATALOG_LIMIT, page.offset + page.items.length);
      totalRef.current = page.items.length === 0 ? Math.min(total, offset) : total;
      setCommunityTotal(totalRef.current);
      setCommunityWarning(page.warning ?? null);
      setCommunityThemes((current) => mergeThemes(current, page.items, reset));
    } catch (loadError) { setCommunityError(String(loadError)); }
    finally {
      setCommunityInitialized(true);
      setCommunityLoading(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (themeTab !== "market") return;
    if (!market && !marketLoading) void refreshMarket();
    if (!communityInitialized && !loadingRef.current) void loadCommunityThemes();
  }, [communityInitialized, loadCommunityThemes, market, marketLoading, refreshMarket, themeTab]);

  const communityHasMore = communityTotal === null
    || offsetRef.current < Math.min(communityTotal, COMMUNITY_CATALOG_LIMIT);

  useEffect(() => {
    const sentinel = communitySentinelRef.current;
    if (themeTab !== "market" || !sentinel || !communityInitialized || communityLoading
      || communityError || !communityHasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadCommunityThemes();
    }, { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [communityError, communityHasMore, communityInitialized, communityLoading, loadCommunityThemes, themeTab]);

  const query = marketQuery.trim().toLocaleLowerCase();
  const filteredMarketThemes = useMemo(() => (market?.themes ?? []).filter((theme) => !query
    || [theme.name, theme.author, theme.description, theme.id, ...theme.tags]
      .some((value) => value.toLocaleLowerCase().includes(query))), [market?.themes, query]);
  const filteredCommunityThemes = useMemo(() => {
    const staticIds = new Set((market?.themes ?? []).map((theme) => theme.id));
    return communityThemes.filter((theme) => !staticIds.has(theme.themeId) && (!query
      || [theme.name, theme.authorDisplayName, theme.themeId, theme.license, theme.version]
        .some((value) => value.toLocaleLowerCase().includes(query))));
  }, [communityThemes, market?.themes, query]);
  const refreshThemeMarket = useCallback(() => {
    void refreshMarket();
    void loadCommunityThemes(true);
  }, [loadCommunityThemes, refreshMarket]);

  return {
    communityError, communityHasMore, communityInitialized, communityLoading, communitySentinelRef,
    communityThemes, communityTotal, communityWarning, filteredCommunityThemes, filteredMarketThemes,
    market, marketError, marketLoading, marketQuery, loadCommunityThemes, refreshMarket, refreshThemeMarket,
    setCommunityThemes, setMarketQuery,
  };
}
