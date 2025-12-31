/**
 * Exemple d'utilisation de l'API Electron dans React
 * 
 * Les APIs sont disponibles via window.electronAPI (exposées par preload.cjs)
 */

// ============ CHEMINS & INFO APP ============

async function loadAppInfo() {
  const info = await window.electronAPI.getAppInfo();
  const paths = await window.electronAPI.getPaths();
  
  console.log('App Info:', info);
  console.log('Data Root:', paths.root);
  console.log('DB File:', paths.dbFile);
  console.log('Printer Dir:', paths.printerDir);
}

// ============ IMPRESSION ============

async function createPrintJob() {
  // Créer un job d'impression
  const result = await window.electronAPI.printer.enqueueJob({
    template: 'invoice-a4',
    data: {
      invoiceId: '12345',
      customer: 'John Doe',
      amount: 99.99,
    },
    format: 'A4',
  });

  if (result.success) {
    console.log('Job créé:', result.id);
    return result.id;
  } else {
    console.error('Erreur:', result.error);
  }
}

async function markPrintJobDone(jobId) {
  // Marquer un job comme succès
  await window.electronAPI.printer.markJobOk(jobId, {
    pdfPath: 'C:\\Glowflixprojet\\printer\\ok\\invoice_12345.pdf',
  });
  console.log('Job marqué comme OK:', jobId);
}

async function markPrintJobFailed(jobId, error) {
  // Marquer un job comme erreur
  await window.electronAPI.printer.markJobErr(jobId, error);
  console.log('Job marqué comme ERR:', jobId);
}

async function getPendingPrintJobs() {
  const result = await window.electronAPI.printer.getPendingJobs();
  if (result.success) {
    console.log('Jobs en attente:', result.jobs);
  }
}

// ============ TEMPLATES ============

async function loadTemplates() {
  // Lister tous les templates disponibles
  const result = await window.electronAPI.template.list();
  if (result.success) {
    console.log('Templates:');
    result.templates.forEach((t) => {
      console.log(`  - ${t.name} (${t.source})`);
    });
  }
}

async function loadTemplate(templateName) {
  // Charger le contenu d'un template
  const result = await window.electronAPI.template.load(templateName);
  if (result.success) {
    console.log(`Template ${templateName}:`);
    console.log(result.content);
    return result.content;
  } else {
    console.error('Erreur:', result.error);
  }
}

async function saveTemplate(templateName, htmlContent) {
  // Sauvegarder un template modifié
  const result = await window.electronAPI.template.save(templateName, htmlContent);
  if (result.success) {
    console.log(`Template ${templateName} sauvegardé`);
  } else {
    console.error('Erreur:', result.error);
  }
}

async function deleteTemplate(templateName) {
  // Supprimer un template utilisateur (ne supprime pas les embarqués)
  const result = await window.electronAPI.template.delete(templateName);
  if (result.success) {
    console.log(`Template ${templateName} supprimé`);
  } else {
    console.error('Erreur:', result.error);
  }
}

async function resetTemplates() {
  // Réinitialiser tous les templates aux versions par défaut
  const result = await window.electronAPI.template.resetToDefaults();
  if (result.success) {
    console.log('Templates réinitialisés');
  } else {
    console.error('Erreur:', result.error);
  }
}

// ============ REACT HOOKS ============

// Hook pour charger les chemins au mount
import { useEffect, useState } from 'react';

export function useAppPaths() {
  const [paths, setPaths] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.getPaths()
      .then(setPaths)
      .finally(() => setLoading(false));
  }, []);

  return { paths, loading };
}

// Hook pour charger les templates
export function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.template.list()
      .then((result) => {
        if (result.success) {
          setTemplates(result.templates);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return { templates, loading };
}

// Hook pour surveiller les jobs d'impression en cours
export function usePendingPrintJobs(intervalMs = 5000) {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      window.electronAPI.printer.getPendingJobs()
        .then((result) => {
          if (result.success) {
            setJobs(result.jobs);
          }
        });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [intervalMs]);

  return jobs;
}

// ============ COMPOSANT EXEMPLE ============

export function PrinterDashboard() {
  const { paths } = useAppPaths();
  const { templates } = useTemplates();
  const pendingJobs = usePendingPrintJobs();

  return (
    <div>
      <h2>Imprimante - Dashboard</h2>
      
      {paths && (
        <div>
          <p><strong>Répertoire impression:</strong> {paths.printerDir}</p>
          <p><strong>Templates:</strong> {paths.printerTemplates}</p>
        </div>
      )}

      <h3>Templates ({templates.length})</h3>
      <ul>
        {templates.map((t) => (
          <li key={t.name}>
            {t.name} ({t.source})
          </li>
        ))}
      </ul>

      <h3>Jobs en cours ({pendingJobs.length})</h3>
      <ul>
        {pendingJobs.map((job) => (
          <li key={job}>
            {job}
            <button onClick={() => markPrintJobDone(job)}>OK</button>
            <button onClick={() => markPrintJobFailed(job, 'User cancelled')}>ERR</button>
          </li>
        ))}
      </ul>

      <button onClick={createPrintJob}>Créer un job test</button>
      <button onClick={loadTemplates}>Recharger templates</button>
    </div>
  );
}

// ============ SERVICE IMPRESSION (pour export) ============

export const printerService = {
  // Créer un job
  async enqueue(payload) {
    return window.electronAPI.printer.enqueueJob(payload);
  },

  // Récupérer les jobs en attente
  async getPending() {
    return window.electronAPI.printer.getPendingJobs();
  },

  // Marquer comme succès
  async markSuccess(jobId, result) {
    return window.electronAPI.printer.markJobOk(jobId, result);
  },

  // Marquer comme erreur
  async markError(jobId, error) {
    return window.electronAPI.printer.markJobErr(jobId, error);
  },
};

export const templateService = {
  // Lister les templates
  async list() {
    return window.electronAPI.template.list();
  },

  // Charger un template
  async load(name) {
    return window.electronAPI.template.load(name);
  },

  // Sauvegarder un template
  async save(name, content) {
    return window.electronAPI.template.save(name, content);
  },

  // Supprimer un template
  async delete(name) {
    return window.electronAPI.template.delete(name);
  },

  // Réinitialiser
  async reset() {
    return window.electronAPI.template.resetToDefaults();
  },
};
