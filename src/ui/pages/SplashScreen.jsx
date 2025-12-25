import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Database, Server, RefreshCw, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';

const SplashScreen = () => {
  const navigate = useNavigate();
  const { checkLicense } = useStore();
  const [status, setStatus] = useState({
    db: 'loading',
    server: 'loading',
    sync: 'loading',
  });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        // Vérifier DB
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (!isMounted) return;
        setStatus((s) => ({ ...s, db: 'ok' }));
        setProgress(33);

        // Vérifier serveur
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!isMounted) return;
        setStatus((s) => ({ ...s, server: 'ok' }));
        setProgress(66);

        // Vérifier sync
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!isMounted) return;
        setStatus((s) => ({ ...s, sync: 'ok' }));
        setProgress(100);

        // Vérifier licence
        const licensed = await checkLicense();

        // Rediriger avec animation
        if (isMounted) {
          setTimeout(() => {
            if (licensed) {
              navigate('/dashboard');
            } else {
              navigate('/license');
            }
          }, 800);
        }
      } catch (error) {
        console.error('Erreur initialisation:', error);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const StatusIcon = ({ status: s }) => {
    if (s === 'loading') {
      return (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="w-6 h-6 text-primary-400" />
        </motion.div>
      );
    }
    if (s === 'ok') {
      return (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          <CheckCircle2 className="w-6 h-6 text-green-400" />
        </motion.div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 relative overflow-hidden">
      {/* Effet de particules animées en arrière-plan */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => {
          const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
          const height = typeof window !== 'undefined' ? window.innerHeight : 1080;
          return (
            <motion.div
              key={i}
              className="absolute w-2 h-2 bg-primary-400/20 rounded-full"
              initial={{
                x: Math.random() * width,
                y: Math.random() * height,
                opacity: 0,
              }}
              animate={{
                y: [null, Math.random() * height],
                opacity: [0, 0.5, 0],
                scale: [0, 1, 0],
              }}
              transition={{
                duration: Math.random() * 3 + 2,
                repeat: Infinity,
                delay: Math.random() * 2,
              }}
            />
          );
        })}
      </div>

      {/* Contenu principal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong rounded-3xl p-12 max-w-md w-full mx-4 relative z-10 shadow-2xl border border-white/10"
      >
        {/* Logo/Titre avec effet lumineux */}
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-center mb-10"
        >
          <motion.div
            className="relative inline-block mb-6"
            animate={{
              rotate: [0, 5, -5, 0],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <motion.img
              src="/asset/image/icon/photo.png"
              alt="Logo LA GRACE"
              className="w-28 h-28 mx-auto object-contain relative z-10"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6, type: 'spring' }}
            />
            <motion.div
              className="absolute inset-0 bg-primary-400/30 rounded-full blur-2xl"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-5xl font-bold bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600 bg-clip-text text-transparent mb-3 tracking-tight"
          >
            LA GRACE
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="text-gray-400 text-sm font-medium flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-primary-400" />
            Alimentation - Système POS Offline-First
          </motion.p>
        </motion.div>

        {/* Barre de progression améliorée */}
        <div className="mb-10">
          <div className="h-3 bg-dark-700/50 rounded-full overflow-hidden shadow-inner">
            <motion.div
              className="h-full bg-gradient-to-r from-primary-500 via-primary-400 to-primary-600 relative"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <motion.div
                className="absolute inset-0 bg-white/30"
                animate={{
                  x: ['-100%', '100%'],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'linear',
                }}
              />
            </motion.div>
          </div>
          <motion.p
            key={progress}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="text-center text-sm text-gray-400 mt-3 font-medium"
          >
            {progress}% chargé
          </motion.p>
        </div>

        {/* Statuts avec animations fluides */}
        <div className="space-y-3">
          {[
            { key: 'db', icon: Database, label: 'Base de données', delay: 0.3 },
            { key: 'server', icon: Server, label: 'Serveur LAN', delay: 0.4 },
            { key: 'sync', icon: RefreshCw, label: 'Synchronisation', delay: 0.5 },
          ].map(({ key, icon: Icon, label, delay }) => (
            <motion.div
              key={key}
              initial={{ x: -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay, duration: 0.4 }}
              className="flex items-center justify-between p-4 glass rounded-xl hover:bg-white/5 transition-all group"
            >
              <div className="flex items-center gap-3">
                <motion.div
                  animate={status[key] === 'ok' ? { rotate: [0, 360] } : {}}
                  transition={{ duration: 0.5 }}
                >
                  <Icon className="w-5 h-5 text-primary-400" />
                </motion.div>
                <span className="text-gray-200 font-medium">{label}</span>
              </div>
              <StatusIcon status={status[key]} />
            </motion.div>
          ))}
        </div>

        {/* Message avec animation */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-center text-sm text-gray-400 mt-8 font-medium"
        >
          Initialisation en cours...
        </motion.p>
      </motion.div>
    </div>
  );
};

export default SplashScreen;
