import fs from "node:fs";
import path from "node:path";
import { getPaths } from "./paths.js";

/**
 * Gère les templates d'impression (modifiables en C:\Glowflixprojet\printer\templates)
 * Fallback sur les templates embarqués si absent
 */
export class TemplateManager {
  constructor(embeddedTemplatesPath) {
    // Chemin des templates embarqués (ressources de l'app)
    this.embeddedPath = embeddedTemplatesPath;
  }

  /**
   * Charge un template (user > embedded)
   * @param {string} templateName ex: "invoice-a4"
   * @returns {string} contenu du template
   */
  loadTemplate(templateName) {
    const { printerTemplates } = getPaths();

    // 1. Chercher en user C:\Glowflixprojet\printer\templates
    const userPath = path.join(printerTemplates, `${templateName}.hbs`);
    if (fs.existsSync(userPath)) {
      console.log(`✓ Template user: ${templateName}`);
      return fs.readFileSync(userPath, "utf-8");
    }

    // 2. Fallback: templates embarqués
    const embeddedPath = path.join(this.embeddedPath, `${templateName}.hbs`);
    if (fs.existsSync(embeddedPath)) {
      console.log(`✓ Template embarqué: ${templateName}`);
      return fs.readFileSync(embeddedPath, "utf-8");
    }

    throw new Error(`Template not found: ${templateName}`);
  }

  /**
   * Liste tous les templates disponibles
   * @returns {Array} [{name, source: "user"|"embedded"}]
   */
  listTemplates() {
    const { printerTemplates } = getPaths();
    const templates = [];
    const seen = new Set();

    // Templates user
    if (fs.existsSync(printerTemplates)) {
      fs.readdirSync(printerTemplates)
        .filter((f) => f.endsWith(".hbs"))
        .forEach((f) => {
          const name = f.replace(".hbs", "");
          templates.push({ name, source: "user", path: path.join(printerTemplates, f) });
          seen.add(name);
        });
    }

    // Templates embarqués (non dupliqués)
    if (fs.existsSync(this.embeddedPath)) {
      fs.readdirSync(this.embeddedPath)
        .filter((f) => f.endsWith(".hbs") && !seen.has(f.replace(".hbs", "")))
        .forEach((f) => {
          const name = f.replace(".hbs", "");
          templates.push({ name, source: "embedded", path: path.join(this.embeddedPath, f) });
        });
    }

    return templates;
  }

  /**
   * Ajoute/écrase un template user
   * @param {string} templateName ex: "invoice-a4"
   * @param {string} content contenu handlebars
   */
  saveTemplate(templateName, content) {
    const { printerTemplates } = getPaths();
    const filePath = path.join(printerTemplates, `${templateName}.hbs`);

    try {
      fs.writeFileSync(filePath, content);
      console.log(`✓ Template saved: ${filePath}`);
    } catch (err) {
      console.error(`❌ Template save error:`, err);
      throw err;
    }
  }

  /**
   * Supprime un template user (ne supprime pas embarqués)
   */
  deleteTemplate(templateName) {
    const { printerTemplates } = getPaths();
    const filePath = path.join(printerTemplates, `${templateName}.hbs`);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✓ Template deleted: ${templateName}`);
      }
    } catch (err) {
      console.error(`❌ Template delete error:`, err);
      throw err;
    }
  }

  /**
   * Réinitialise: copie les templates embarqués → user
   */
  resetToDefaults() {
    const { printerTemplates } = getPaths();

    if (fs.existsSync(this.embeddedPath)) {
      fs.readdirSync(this.embeddedPath)
        .filter((f) => f.endsWith(".hbs"))
        .forEach((f) => {
          const src = path.join(this.embeddedPath, f);
          const dst = path.join(printerTemplates, f);
          fs.copyFileSync(src, dst);
        });
    }

    console.log(`✓ Templates reset to defaults`);
  }
}

// Export instance globale (à initialiser au démarrage)
export let templateManager = null;

export function initializeTemplateManager(embeddedPath) {
  templateManager = new TemplateManager(embeddedPath);
  console.log(`✓ Template manager initialized (embedded: ${embeddedPath})`);
  return templateManager;
}
