import { motion, useIsPresent } from 'framer-motion';

/**
 * Composant de transition de page avec animations fluides professionnelles
 * 
 * CRITIQUE: Utilise pointerEvents pour éviter que l'ancienne page (en exit)
 * bloque les clics de la nouvelle page pendant l'animation.
 * 
 * Ceci résout le bug "tout devient non cliquable après validation échouée"
 * car l'ancienne page en sortie ne peut plus capturer les événements.
 */
const pageVariants = {
  initial: {
    opacity: 0,
    y: 30,
    scale: 0.96,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1], // ease-out-expo pour un effet fluide et professionnel
      staggerChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.98,
    transition: {
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const PageTransition = ({ children, className = '' }) => {
  // ✅ CRITIQUE: Détecte si cette page est actuellement visible/montée
  // Retourne false pendant l'animation exit (permet de désactiver pointerEvents)
  const isPresent = useIsPresent();

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        // ✅ FIX CLIQUE BLOQUÉ: Si la page n'est pas présente (exit), elle ne capte plus les clics
        // Ceci évite que l'ancienne page bloque les événements de la nouvelle page
        pointerEvents: isPresent ? 'auto' : 'none',
      }}
      className={`relative ${className}`}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;

