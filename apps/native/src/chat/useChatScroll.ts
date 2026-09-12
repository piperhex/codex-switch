import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import type { Item } from './types';

const SCROLL_EDGE_DISTANCE = 100;
const SCROLL_OFFSET_TOLERANCE = 1;
// React Native rounds both the top and bottom of partially visible cells down to whole layout pixels.
const VIEWABILITY_ROUNDING_TOLERANCE = 2;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 };
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type Options = Pick<ChatMessagesProps, 'hasMore' | 'loading' | 'loadingMore' | 'loadOlder'>
  & { latestItemId?: string; bottomPadding: number };

export function useChatScroll({ hasMore, loading, loadingMore, loadOlder, latestItemId, bottomPadding }: Options) {
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const scrolling = useRef(false);
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
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    visibleItems.current = new Set(viewableItems.filter((token) => token.isViewable).map((token) => token.item.id));
    presentLatest();
  }, [presentLatest]);
  const onFooterLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    footerHeight.current = layout.height;
    presentLatest();
  };
  const followLatest = () => {
    if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current);
    // Coalesce native layout and content updates, using the final viewport instead of overscrolling.
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = undefined;
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
    following.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height
      - nativeEvent.contentOffset.y < SCROLL_EDGE_DISTANCE;
    setPreservePosition(!following.current);
  };
  const more = () => {
    if (!hasMore || loadingMore || !loadOlder) return;
    following.current = false;
    setPreservePosition(true);
    void loadOlder();
  };
  const finishScroll = (event: ScrollEvent) => {
    updateFollowing(event);
    scrolling.current = false;
    // Android can deliver the final scroll position after the drag event has ended.
    if (event.nativeEvent.contentOffset.y < SCROLL_EDGE_DISTANCE) more();
  };
  const onScroll = (event: ScrollEvent) => {
    const top = event.nativeEvent.contentOffset.y;
    // Image loads and keyboard resizing also emit scroll events; only a drag changes follow intent.
    if (scrolling.current) {
      updateFollowing(event);
      if (top < position.current && top < SCROLL_EDGE_DISTANCE) more();
    }
    position.current = top;
    nativePosition.current = top;
    presentLatest();
  };
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (viewportHeight.current === layout.height) return;
    viewportHeight.current = layout.height;
    followLatest();
    presentLatest();
  };
  const onContentSizeChange = (_width: number, height: number) => {
    if (contentHeight.current === height) return;
    contentHeight.current = height;
    followLatest();
    presentLatest();
  };
  const beginScroll = () => { scrolling.current = true; };
  return { list, more, preservePosition, initializing: Boolean(latestItemId) && !initialPositionReady,
    onItemLayout, onFooterLayout, onLayout, onContentSizeChange, onScroll,
    onViewableItemsChanged, viewabilityConfig: VIEWABILITY_CONFIG,
    onScrollBeginDrag: beginScroll, onScrollEndDrag: finishScroll,
    onMomentumScrollBegin: beginScroll, onMomentumScrollEnd: finishScroll };
}
