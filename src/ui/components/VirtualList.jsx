import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIRTUAL LIST PRO - Virtualisation haute performance avec TanStack Virtual
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Caractéristiques:
 * - Utilise @tanstack/react-virtual (meilleure performance)
 * - Affiche UNIQUEMENT les éléments visibles (+ buffer)
 * - Support des éléments de hauteur variable
 * - Scroll fluide même avec 100,000+ items
 * - Optimisé pour Electron/React
 * - Memoization agressive
 * - Pas d'animations lourdes
 * - GPU-accelerated
 * 
 * Usage:
 * <VirtualList
 *   items={products}
 *   itemHeight={60}
 *   renderItem={(item, index) => <ProductRow item={item} />}
 *   overscan={5}
 * />
 */

/**
 * Composant VirtualList principal avec TanStack Virtual
 */
const VirtualList = memo(({
  items = [],
  itemHeight = 50,
  renderItem,
  containerHeight = 400,
  containerClassName = '',
  itemClassName = '',
  overscan = 5,
  onScroll,
  keyExtractor,
  emptyMessage = 'Aucun élément',
  loadingMessage = 'Chargement...',
  isLoading = false,
  onEndReached,
  onEndReachedThreshold = 0.8,
  getItemHeight,
  stickyHeader,
  stickyFooter,
}) => {
  const parentRef = useRef(null);
  const endReachedRef = useRef(false);
  
  // Hauteur effective par item
  const effectiveItemHeight = getItemHeight || itemHeight;
  const estimatedSize = typeof effectiveItemHeight === 'number' ? effectiveItemHeight : 50;
  
  // TanStack Virtual pour meilleure performance
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: typeof effectiveItemHeight === 'function' 
      ? (index) => effectiveItemHeight(items[index], index) || estimatedSize
      : () => effectiveItemHeight,
    overscan,
    // Optimisations de performance
    measureElement: typeof effectiveItemHeight === 'function' ? undefined : (element) => {
      return element?.getBoundingClientRect().height ?? estimatedSize;
    },
  });
  
  // Gérer le scroll
  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    
    // Callback externe
    if (onScroll) {
      onScroll({ scrollTop, scrollHeight, clientHeight });
    }
    
    // Détection de fin de liste
    if (onEndReached && !endReachedRef.current) {
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      if (scrollPercentage >= onEndReachedThreshold) {
        endReachedRef.current = true;
        onEndReached();
        // Réinitialiser après un délai
        setTimeout(() => {
          endReachedRef.current = false;
        }, 1000);
      }
    }
  }, [onScroll, onEndReached, onEndReachedThreshold]);
  
  // Générer les clés
  const getKey = useCallback((index) => {
    const item = items[index];
    if (keyExtractor) {
      return keyExtractor(item, index);
    }
    return item?.id || item?.uuid || item?.code || index;
  }, [items, keyExtractor]);
  
  // Scroll vers un index
  const scrollToIndex = useCallback((index, align = 'start') => {
    virtualizer.scrollToIndex(index, { align, behavior: 'smooth' });
  }, [virtualizer]);
  
  // Exposer scrollToIndex via ref si nécessaire
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollToIndex = scrollToIndex;
    }
  }, [scrollToIndex]);
  
  // État vide
  if (!isLoading && items.length === 0) {
    return (
      <div 
        className={`flex items-center justify-center text-gray-500 ${containerClassName}`}
        style={{ height: containerHeight }}
      >
        {emptyMessage}
      </div>
    );
  }
  
  // État chargement
  if (isLoading && items.length === 0) {
    return (
      <div 
        className={`flex items-center justify-center text-gray-500 ${containerClassName}`}
        style={{ height: containerHeight }}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>{loadingMessage}</span>
        </div>
      </div>
    );
  }
  
  const virtualItems = virtualizer.getVirtualItems();
  
  return (
    <div className="relative">
      {/* Header sticky */}
      {stickyHeader && (
        <div className="sticky top-0 z-10 bg-inherit">
          {stickyHeader}
        </div>
      )}
      
      {/* Container scrollable avec TanStack Virtual */}
      <div
        ref={parentRef}
        className={`overflow-y-auto overflow-x-hidden ${containerClassName}`}
        style={{ 
          height: containerHeight,
          // Optimisations GPU
          willChange: 'scroll-position',
          contain: 'layout style paint',
        }}
        onScroll={handleScroll}
      >
        {/* Spacer pour la hauteur totale */}
        <div 
          style={{ 
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {/* Items virtualisés */}
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index];
            const key = getKey(virtualItem.index);
            
            return (
              <div
                key={key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className={itemClassName}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  // Optimisations GPU
                  willChange: 'transform',
                  contain: 'layout style paint',
                }}
              >
                {renderItem(item, virtualItem.index, { isScrolling: false })}
              </div>
            );
          })}
        </div>
        
        {/* Indicateur de chargement en bas */}
        {isLoading && items.length > 0 && (
          <div className="flex items-center justify-center py-4 text-gray-500">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      
      {/* Footer sticky */}
      {stickyFooter && (
        <div className="sticky bottom-0 z-10 bg-inherit">
          {stickyFooter}
        </div>
      )}
    </div>
  );
});

VirtualList.displayName = 'VirtualList';

export default VirtualList;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIANTE: VirtualGrid - Grille virtualisée
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const VirtualGrid = memo(({
  items = [],
  itemWidth = 200,
  itemHeight = 200,
  containerHeight = 400,
  containerWidth = '100%',
  gap = 16,
  renderItem,
  containerClassName = '',
  overscan = 2,
  columns,
  emptyMessage = 'Aucun élément',
}) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidthPx, setContainerWidthPx] = useState(800);
  
  // Calculer le nombre de colonnes
  const columnCount = useMemo(() => {
    if (columns) return columns;
    return Math.floor((containerWidthPx + gap) / (itemWidth + gap)) || 1;
  }, [containerWidthPx, itemWidth, gap, columns]);
  
  // Nombre de lignes
  const rowCount = Math.ceil(items.length / columnCount);
  const rowHeight = itemHeight + gap;
  const totalHeight = rowCount * rowHeight;
  
  // Observer la largeur du container
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidthPx(entry.contentRect.width);
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  
  // Calculer les lignes visibles
  const { startRow, endRow, offsetTop } = useMemo(() => {
    const start = Math.floor(scrollTop / rowHeight);
    const visible = Math.ceil(containerHeight / rowHeight);
    
    return {
      startRow: Math.max(0, start - overscan),
      endRow: Math.min(rowCount - 1, start + visible + overscan),
      offsetTop: Math.max(0, start - overscan) * rowHeight,
    };
  }, [scrollTop, rowHeight, containerHeight, rowCount, overscan]);
  
  // Items visibles
  const visibleRows = useMemo(() => {
    const rows = [];
    for (let row = startRow; row <= endRow; row++) {
      const rowItems = [];
      for (let col = 0; col < columnCount; col++) {
        const index = row * columnCount + col;
        if (index < items.length) {
          rowItems.push({ item: items[index], index });
        }
      }
      if (rowItems.length > 0) {
        rows.push({ rowIndex: row, items: rowItems });
      }
    }
    return rows;
  }, [items, startRow, endRow, columnCount]);
  
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);
  
  if (items.length === 0) {
    return (
      <div 
        className={`flex items-center justify-center text-gray-500 ${containerClassName}`}
        style={{ height: containerHeight }}
      >
        {emptyMessage}
      </div>
    );
  }
  
  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto overflow-x-hidden ${containerClassName}`}
      style={{ height: containerHeight, width: containerWidth }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: offsetTop,
            left: 0,
            right: 0,
          }}
        >
          {visibleRows.map(({ rowIndex, items: rowItems }) => (
            <div
              key={rowIndex}
              style={{
                display: 'flex',
                gap,
                height: itemHeight,
                marginBottom: gap,
                transform: 'translateZ(0)',
              }}
            >
              {rowItems.map(({ item, index }) => (
                <div
                  key={item.id || item.uuid || index}
                  style={{
                    width: itemWidth,
                    height: itemHeight,
                    flexShrink: 0,
                    contain: 'layout style paint',
                  }}
                >
                  {renderItem(item, index)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

VirtualGrid.displayName = 'VirtualGrid';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HOOK: useVirtualList - Pour utilisation custom
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function useVirtualList({
  items,
  itemHeight,
  containerHeight,
  overscan = 5,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  
  const virtualData = useMemo(() => {
    const height = typeof itemHeight === 'number' ? itemHeight : 50;
    const start = Math.floor(scrollTop / height);
    const visible = Math.ceil(containerHeight / height);
    
    const startIndex = Math.max(0, start - overscan);
    const endIndex = Math.min(items.length - 1, start + visible + overscan);
    
    return {
      startIndex,
      endIndex,
      offsetTop: startIndex * height,
      totalHeight: items.length * height,
      visibleItems: items.slice(startIndex, endIndex + 1),
      virtualizedIndices: Array.from(
        { length: endIndex - startIndex + 1 },
        (_, i) => startIndex + i
      ),
    };
  }, [items, itemHeight, containerHeight, scrollTop, overscan]);
  
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);
  
  const scrollToIndex = useCallback((index, behavior = 'smooth') => {
    const height = typeof itemHeight === 'number' ? itemHeight : 50;
    setScrollTop(index * height);
  }, [itemHeight]);
  
  return {
    ...virtualData,
    scrollTop,
    handleScroll,
    scrollToIndex,
  };
}


