import express from 'express';
import jwt from 'jsonwebtoken';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { auditRepo } from '../../db/repositories/audit.repo.js';
import { logger } from '../../core/logger.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * POST /api/auth/login
 * Connexion utilisateur
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Nom d\'utilisateur et mot de passe requis',
      });
    }

    const user = await usersRepo.verifyPassword(username, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Identifiants invalides',
      });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Audit log
    auditRepo.log(user.id, 'login', { username: user.username });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
      },
      token,
    });
  } catch (error) {
    logger.error('Erreur login:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la connexion',
    });
  }
});

export default router;

