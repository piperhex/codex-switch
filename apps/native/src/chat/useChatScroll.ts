import { useEffect, useRef, useState } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import type { Item } from './types';

const SCROLL_EDGE_DISTANCE = 100;
const SCROLL_OFFSET_TOLERANCE = 1;
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type Options = Pick<ChatMessagesProps, 'hasMore' | 'loadingMore' | 'loadOlder'>;

export function useChatScroll({ hasMore, loadingMore, loadOlder }: Options) {
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const scrolling = useRef(false);
  const position = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const followFrame = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const [preservePosition, setPreservePosition] = useState(false);
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
  };
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (viewportHeight.current === layout.height) return;
    viewportHeight.current = layout.height;
    followLatest();
  };
  const onContentSizeChange = (_width: number, height: number) => {
    if (contentHeight.current === height) return;
    contentHeight.current = height;
    followLatest();
  };
  const beginScroll = () => { scrolling.current = true; };
  return { list, more, preservePosition, onLayout, onContentSizeChange, onScroll,
    onScrollBeginDrag: beginScroll, onScrollEndDrag: finishScroll,
    onMomentumScrollBegin: beginScroll, onMomentumScrollEnd: finishScroll };
}
