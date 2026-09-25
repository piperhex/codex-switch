import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import type { Item } from './types';
import { useNativeChatScroll } from './useNativeChatScroll';

const SCROLL_EDGE_DISTANCE = 100;
const SCROLL_OFFSET_TOLERANCE = 1;
const INITIAL_SCROLL_EVENT_THROTTLE_MS = 16;
const SCROLL_EVENT_THROTTLE_MS = 100;
// React Native rounds both the top and bottom of partially visible cells down to whole layout pixels.
const VIEWABILITY_ROUNDING_TOLERANCE = 2;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 };
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type Options = Pick<ChatMessagesProps, 'hasMore' | 'loading' | 'loadingMore' | 'loadOlder'>
  & { latestItemId?: string; bottomPadding: number };

export function useChatScroll<Entry extends { id: string } = Item>(
  { hasMore, loading, loadingMore, loadOlder, latestItemId, bottomPadding }: Options,
) {
  const list = useRef<FlatList<Entry>>(null);
  const nativeScroll = useNativeChatScroll(list, SCROLL_EDGE_DISTANCE);
  const following = useRef(true);
  const scrolling = useRef(false);
  const loadingOlder = useRef(false);
  const position = useRef(0);
  const nativePosition = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const followFrame = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const presentFrame = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const latest = useRef(latestItemId);
  latest.current = latestItemId;
  const startedWithItems = useRef(Boolean(latestItemId));
  const initialHistoryPending = useRef(false);
  initialHistoryPending.current = !startedWithItems.current && Boolean(loading);
  const measuredItems = useRef(new Set<string>());
  const visibleItems = useRef(new Set<string>());
  const footerHeight = useRef(0);
  const presented = useRef(false);
  const [initialPositionReady, setInitialPositionReady] = useState(false);
  const [preservePosition, setPreservePosition] = useState(false);
  const [historyBottomSpace, setHistoryBottomSpace] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const updateScrollButton = () => setShowScrollToBottom(!following.current
    && contentHeight.current - viewportHeight.current - nativePosition.current >= SCROLL_EDGE_DISTANCE);
  const presentLatest = useCallback(() => {
    if (presented.current || presentFrame.current !== undefined) return;
    // Reveal after native cells and the bottom position agree, never at an estimated virtualization spacer.
    presentFrame.current = requestAnimationFrame(() => {
      presentFrame.current = undefined;
      const offset = Math.max(0, contentHeight.current - viewportHeight.current);
      const tailMeasured = latest.current && measuredItems.current.has(latest.current)
        && visibleItems.current.has(latest.current);
      const footerFillsViewport = footerHeight.current > 0
        && footerHeight.current + bottomPadding + VIEWABILITY_ROUNDING_TOLERANCE >= viewportHeight.current;
      if (!latest.current || initialHistoryPending.current || (!tailMeasured && !footerFillsViewport)
        || viewportHeight.current <= 0
        || Math.abs(nativePosition.current - offset) > SCROLL_OFFSET_TOLERANCE) return;
      presented.current = true;
      setInitialPositionReady(true);
    });
  }, [bottomPadding]);
  useEffect(() => { presentLatest(); }, [loading, latestItemId, presentLatest]);
  const onItemLayout = useCallback((id: string) => {
    if (presented.current) return;
    measuredItems.current.add(id);
    presentLatest();
  }, [presentLatest]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Entry>[] }) => {
    visibleItems.current = new Set(viewableItems.filter((token) => token.isViewable).map((token) => token.item.id));
    presentLatest();
  }, [presentLatest]);
  const onFooterLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    footerHeight.current = layout.height;
    presentLatest();
  };
  const followLatest = () => {
    if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current);
    if (nativeScroll.attached.current) return;
    // Coalesce native layout and content updates, using the final viewport instead of overscrolling.
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = undefined;
      if (nativeScroll.attached.current) return;
      if (!following.current || scrolling.current || viewportHeight.current <= 0) return;
      const offset = Math.max(0, contentHeight.current - viewportHeight.current);
      if (Math.abs(offset - position.current) <= SCROLL_OFFSET_TOLERANCE || !list.current) return;
      list.current.scrollToOffset({ offset, animated: false });
      position.current = offset;
    });
  };
  useEffect(() => () => {
    if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current);
    if (presentFrame.current !== undefined) cancelAnimationFrame(presentFrame.current);
  }, []);
  const updateFollowing = ({ nativeEvent }: ScrollEvent) => {
    if (loadingOlder.current || loadingMore) return;
    following.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height
      - nativeEvent.contentOffset.y < SCROLL_EDGE_DISTANCE;
    setPreservePosition(!following.current);
  };
  const scrollToBottom = () => {
    following.current = true;
    nativeScroll.setFollowing(true);
    scrolling.current = false;
    setPreservePosition(false);
    setHistoryBottomSpace(0);
    setShowScrollToBottom(false);
    followLatest();
  };
  const more = async () => {
    if (loadingOlder.current || loadingMore || !loadOlder) return;
    loadingOlder.current = true;
    if (latest.current) {
      following.current = false;
      nativeScroll.setFollowing(false);
      setPreservePosition(true);
      // Native scroll offsets are clamped to the content height; retain a short conversation's empty tail.
      setHistoryBottomSpace((space) => Math.max(space, viewportHeight.current - contentHeight.current + space));
    }
    try { await loadOlder(); }
    finally { loadingOlder.current = false; nativeScroll.finishLoadingOlder(); }
  };
  const finishScroll = (event: ScrollEvent) => {
    updateFollowing(event);
    scrolling.current = false;
    // Android can deliver the final scroll position after the drag event has ended.
    const top = event.nativeEvent.contentOffset.y;
    if (hasMore && top > 0 && top < SCROLL_EDGE_DISTANCE) void more();
  };
  const onScroll = (event: ScrollEvent) => {
    const top = event.nativeEvent.contentOffset.y;
    // Image loads and keyboard resizing also emit scroll events; only a drag changes follow intent.
    if (scrolling.current) {
      updateFollowing(event);
      if (hasMore && top > 0 && top < position.current && top < SCROLL_EDGE_DISTANCE) void more();
    }
    position.current = top;
    nativePosition.current = top;
    updateScrollButton();
    presentLatest();
  };
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    nativeScroll.attach();
    if (viewportHeight.current === layout.height) return;
    viewportHeight.current = layout.height;
    updateScrollButton();
    followLatest();
    presentLatest();
  };
  const onContentSizeChange = (_width: number, height: number) => {
    nativeScroll.attach();
    if (contentHeight.current === height) return;
    contentHeight.current = height;
    updateScrollButton();
    followLatest();
    presentLatest();
  };
  const beginScroll = () => { scrolling.current = true; };
  return { list, more, preservePosition: nativeScroll.available || preservePosition, historyBottomSpace,
    initializing: Boolean(latestItemId) && !initialPositionReady,
    // Native bottom following can move twice in one batch; throttling can drop the final offset forever.
    scrollEventThrottle: initialPositionReady ? SCROLL_EVENT_THROTTLE_MS : INITIAL_SCROLL_EVENT_THROTTLE_MS,
    showScrollToBottom, scrollToBottom, onItemLayout, onFooterLayout, onLayout, onContentSizeChange, onScroll,
    onViewableItemsChanged, viewabilityConfig: VIEWABILITY_CONFIG,
    onScrollBeginDrag: beginScroll, onScrollEndDrag: finishScroll,
    onMomentumScrollBegin: beginScroll, onMomentumScrollEnd: finishScroll };
}
