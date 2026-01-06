import { m, useIsPresent, useReducedMotion } from 'framer-motion';
import { memo, useMemo } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAGE TRANSITION PRO - Transitions ultra-fluides optimisées GPU
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Optimisations PRO:
 * - Utilise UNIQUEMENT transform et opacity (GPU-accelerated)
 * - will-change pour préparer le GPU
 * - Pas de perspective/preserve-3d (évite les bugs de stacking context)
 * - Durée ultra-courte (120-180ms) pour réactivité maximale
 * - Reduced motion support pour accessibilité
 * - Memoization pour éviter les re-renders
 * 
 * CRITIQUE: 
 * - pointerEvents désactivé pendant exit pour éviter les clics bloqués
 * - Utilise translateZ(0) pour forcer l'accélération matérielle sans stacking bugs
 * - Pas de position absolute par défaut (évite les overlays)
 */

// ✅ Courbe d'easing ultra-fluide et naturelle (ease-out optimisé)
// Courbe personnalisée pour transitions douces et rapides - style iOS/macOS
const easeOutFluid = [0.4, 0.0, 0.2, 1.0]; // Courbe Material Design (plus douce)

// ✅ Variants PRO ultra-optimisés - GPU only (transform + opacity)
// Transitions rapides mais ultra-fluides (120-180ms)
const pageVariants = {
  initial: {
    opacity: 0,
    transform: 'translate3d(0, 6px, 0)', // Décalage subtil pour fluidité
  },
  animate: {
    opacity: 1,
    transform: 'translate3d(0, 0, 0)',
    transition: {
      duration: 0.2,              // 200ms - équilibre parfait rapidité/fluidité
      ease: easeOutFluid,
    },
  },
  exit: {
    opacity: 0,
    transform: 'translate3d(0, -3px, 0)', // Exit subtil pour fluidité
    transition: {
      duration: 0.15,              // 150ms - rapide mais fluide
      ease: easeOutFluid,
    },
  },
};

// ✅ Variants pour reduced motion (accessibilité)
const reducedMotionVariants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration: 0.08 }
  },
  exit: { 
    opacity: 0,
    transition: { duration: 0.05 }
  },
};

// ✅ Style GPU ultra-optimisé pour fluidité maximale
const baseStyle = {
  willChange: 'transform, opacity',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  transform: 'translateZ(0)', // Force GPU sans perspective (évite stacking context bugs)
  WebkitTransform: 'translateZ(0)',
  // Optimisations supplémentaires pour fluidité
  isolation: 'isolate', // Crée un nouveau stacking context propre
  contain: 'layout style paint', // Optimisation de rendu
};

/**
 * Composant de transition de page optimisé PRO
 */
const PageTransition = memo(({ children, className = '', instant = false, absolute = false }) => {
  // ✅ Détecte si la page est en cours de sortie (pour désactiver pointerEvents)
  const isPresent = useIsPresent();
  
  // ✅ Respecter les préférences d'accessibilité
  const prefersReducedMotion = useReducedMotion();
  
  // ✅ Choisir les variants selon les préférences
  const variants = useMemo(() => {
    if (instant || prefersReducedMotion) return reducedMotionVariants;
    return pageVariants;
  }, [instant, prefersReducedMotion]);
  
  // ✅ Style dynamique avec pointerEvents - IMPORTANT: pointerEvents 'none' uniquement pendant exit
  const style = useMemo(() => ({
    ...baseStyle,
    pointerEvents: isPresent ? 'auto' : 'none', // CRITIQUE: Évite les clics bloqués
    width: '100%',
    minHeight: '100%',
    ...(absolute ? { position: 'absolute', inset: 0 } : {}),
  }), [isPresent, absolute]);

  return (
    <m.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={style}
      className={className}
      layout={false} // ✅ Layout false pour éviter les animations de layout (coûteuses)
      aria-busy={!isPresent} // ✅ Accessibilité
    >
      {children}
    </m.div>
  );
});

PageTransition.displayName = 'PageTransition';

export default PageTransition;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIANTE: InstantTransition - Pour les pages qui doivent être instantanées
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const InstantTransition = memo(({ children, className = '' }) => {
  const isPresent = useIsPresent();
  
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.05 }}
      style={{
        ...baseStyle,
        pointerEvents: isPresent ? 'auto' : 'none',
        position: 'relative',
        width: '100%',
        minHeight: '100%',
      }}
      className={className}
      layout={false}
      aria-busy={!isPresent}
    >
      {children}
    </m.div>
  );
});

InstantTransition.displayName = 'InstantTransition';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIANTE: SlideTransition - Slide horizontal pour navigation
 * ═══════════════════════════════════════════════════════════════════════════
 */
const slideVariants = {
  initial: {
    opacity: 0,
    transform: 'translate3d(16px, 0, 0)', // Décalage subtil pour fluidité
  },
  animate: {
    opacity: 1,
    transform: 'translate3d(0, 0, 0)',
    transition: {
      duration: 0.2,
      ease: easeOutFluid,
    },
  },
  exit: {
    opacity: 0,
    transform: 'translate3d(-16px, 0, 0)', // Décalage subtil pour fluidité
    transition: {
      duration: 0.15,
      ease: easeOutFluid,
    },
  },
};

export const SlideTransition = memo(({ children, className = '' }) => {
  const isPresent = useIsPresent();
  const prefersReducedMotion = useReducedMotion();
  
  const variants = prefersReducedMotion ? reducedMotionVariants : slideVariants;
  
  return (
    <m.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        ...baseStyle,
        pointerEvents: isPresent ? 'auto' : 'none',
        position: 'relative',
        width: '100%',
        minHeight: '100%',
      }}
      className={className}
      layout={false}
      aria-busy={!isPresent}
    >
      {children}
    </m.div>
  );
});

SlideTransition.displayName = 'SlideTransition';
