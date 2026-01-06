import { memo } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SKELETON COMPONENTS - Chargement visuel instantané
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Les skeletons permettent d'afficher immédiatement une structure de page
 * pendant que les données se chargent, donnant l'impression d'une app ultra-rapide.
 */

// ═══════════════════════════════════════════════════════════════════════════
// BASE SKELETON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Composant skeleton de base avec animation shimmer
 */
export const Skeleton = memo(({ 
  className = '', 
  width, 
  height, 
  rounded = 'md',
  animate = true,
}) => {
  const roundedClasses = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  };
  
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  
  return (
    <div 
      className={`
        bg-gray-700/50 
        ${roundedClasses[rounded]} 
        ${animate ? 'animate-pulse' : ''} 
        ${className}
      `}
      style={style}
    />
  );
});

Skeleton.displayName = 'Skeleton';

// ═══════════════════════════════════════════════════════════════════════════
// SKELETON VARIANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Skeleton pour texte (ligne simple)
 */
export const SkeletonText = memo(({ 
  lines = 1, 
  className = '',
  lastLineWidth = '60%',
}) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton 
        key={i} 
        className="h-4" 
        width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
      />
    ))}
  </div>
));

SkeletonText.displayName = 'SkeletonText';

/**
 * Skeleton pour avatar/image circulaire
 */
export const SkeletonAvatar = memo(({ size = 40, className = '' }) => (
  <Skeleton 
    width={size} 
    height={size} 
    rounded="full" 
    className={className}
  />
));

SkeletonAvatar.displayName = 'SkeletonAvatar';

/**
 * Skeleton pour carte statistique
 */
export const SkeletonStatCard = memo(({ className = '' }) => (
  <div className={`card p-6 ${className}`}>
    <div className="flex items-center justify-between mb-4">
      <Skeleton width={48} height={48} rounded="lg" />
      <Skeleton width={20} height={20} rounded="sm" />
    </div>
    <Skeleton className="h-3 w-24 mb-2" />
    <div className="flex items-baseline gap-2">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-8" />
    </div>
  </div>
));

SkeletonStatCard.displayName = 'SkeletonStatCard';

/**
 * Skeleton pour ligne de tableau/liste
 */
export const SkeletonTableRow = memo(({ columns = 5, className = '' }) => (
  <div className={`flex items-center gap-4 p-4 ${className}`}>
    {Array.from({ length: columns }).map((_, i) => (
      <Skeleton 
        key={i} 
        className="h-4 flex-1" 
        width={i === 0 ? '20%' : i === columns - 1 ? '10%' : undefined}
      />
    ))}
  </div>
));

SkeletonTableRow.displayName = 'SkeletonTableRow';

/**
 * Skeleton pour carte produit
 */
export const SkeletonProductCard = memo(({ className = '' }) => (
  <div className={`card p-4 ${className}`}>
    <div className="flex items-start gap-4">
      <Skeleton width={64} height={64} rounded="lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 mt-3">
          <Skeleton className="h-6 w-16" rounded="full" />
          <Skeleton className="h-6 w-20" rounded="full" />
        </div>
      </div>
      <div className="text-right space-y-1">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  </div>
));

SkeletonProductCard.displayName = 'SkeletonProductCard';

/**
 * Skeleton pour le Dashboard complet
 */
export const SkeletonDashboard = memo(() => (
  <div className="space-y-8 animate-in fade-in duration-200">
    {/* Header */}
    <div>
      <Skeleton className="h-10 w-64 mb-3" />
      <Skeleton className="h-5 w-48" />
    </div>
    
    {/* Stats Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <SkeletonStatCard />
      <SkeletonStatCard />
      <SkeletonStatCard />
      <SkeletonStatCard />
    </div>
    
    {/* Two columns */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <div className="flex justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-3">
          <div className="p-4 glass rounded-lg">
            <div className="flex justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-32" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="card p-6">
        <div className="flex justify-between mb-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 glass rounded-lg flex justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
    
    {/* Quick Actions */}
    <div className="card p-6">
      <Skeleton className="h-6 w-36 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 glass rounded-lg text-center">
            <Skeleton width={32} height={32} className="mx-auto mb-2" />
            <Skeleton className="h-4 w-20 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  </div>
));

SkeletonDashboard.displayName = 'SkeletonDashboard';

/**
 * Skeleton pour liste de produits
 */
export const SkeletonProductList = memo(({ count = 10 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonProductCard key={i} />
    ))}
  </div>
));

SkeletonProductList.displayName = 'SkeletonProductList';

/**
 * Skeleton pour tableau de ventes
 */
export const SkeletonSalesTable = memo(({ rows = 10 }) => (
  <div className="card overflow-hidden">
    {/* Header */}
    <div className="bg-gray-800/50 p-4 border-b border-gray-700">
      <div className="flex gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
    {/* Rows */}
    <div className="divide-y divide-gray-700/50">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} columns={5} />
      ))}
    </div>
  </div>
));

SkeletonSalesTable.displayName = 'SkeletonSalesTable';

/**
 * Skeleton pour le POS (Point of Sale)
 */
export const SkeletonPOS = memo(() => (
  <div className="h-full flex gap-6">
    {/* Left Panel - Products */}
    <div className="flex-1 space-y-4">
      {/* Search */}
      <Skeleton className="h-12 w-full" rounded="lg" />
      
      {/* Products Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex justify-between">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-8 w-8" rounded="full" />
            </div>
          </div>
        ))}
      </div>
    </div>
    
    {/* Right Panel - Cart */}
    <div className="w-96 card p-6 space-y-4">
      <Skeleton className="h-8 w-32" />
      <div className="space-y-3 flex-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between p-3 glass rounded-lg">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
      <div className="border-t border-gray-700 pt-4 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-24" />
        </div>
        <Skeleton className="h-12 w-full" rounded="lg" />
      </div>
    </div>
  </div>
));

SkeletonPOS.displayName = 'SkeletonPOS';

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER: WithSkeleton
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HOC pour afficher un skeleton pendant le chargement
 */
export const WithSkeleton = memo(({ 
  loading, 
  skeleton, 
  children,
  minLoadTime = 0,
}) => {
  // Si minLoadTime est défini, on peut forcer un temps minimum d'affichage
  // pour éviter les flashs (skeleton qui apparaît/disparaît trop vite)
  
  if (loading) {
    return skeleton;
  }
  
  return children;
});

WithSkeleton.displayName = 'WithSkeleton';

export default Skeleton;

