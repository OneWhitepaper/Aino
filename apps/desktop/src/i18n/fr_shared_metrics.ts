export const frSharedMetrics = {
  consentTitle: 'Partager les statistiques d’utilisation ?',
  dialogTitle: 'Statistiques d’utilisation',
  consentBody:
    'Aino peut compter la façon dont vous l’utilisez : durée des sessions, modèles et outils utilisés, et moments où quelque chose échoue. Il n’enregistre jamais vos messages, fichiers, chemins ni textes d’erreur.',
  whatIsCollected: 'Ce qui est compté',
  collectedActivity: 'Sessions : durée, résultat, type d’erreur, temps actif par jour',
  collectedModels: 'Modèles : lesquels, totaux de tokens',
  collectedNames: 'Fonctionnalités : outils intégrés, commandes, zones de l’app et réglages utilisés ou désactivés',
  collectedMilestones:
    'Configuration : étapes terminées, connexions aux fournisseurs, nombre de skills, plugins et tâches',
  collectedReliability:
    'Santé de l’app : plantages, vitesse de démarrage et de réponse, mises à jour, connexions de messagerie',
  collectedUsage:
    'Qualité de l’agent : modifications manquées, appels d’outils défaillants, boucles bloquées, coût par tâche',
  collectedMachine:
    'Machine : système d’exploitation, plage de RAM, type de GPU, version de Aino, utilisation de modèles locaux',
  sending:
    'Aino envoie les compteurs agrégés chaque jour à api.agentera.com.cn avec un identifiant aléatoire du profil, sans jeton de compte. Les administrateurs Aino peuvent les lire. L’accès expire après 14 jours et les données en ligne sont effacées sous une heure ; les sauvegardes suivent la politique de conservation. Hormis une note d’installation, aucune donnée antérieure au nouveau consentement n’est envoyée. Désactivation possible dans les réglages.',
  readDocs: 'Lire tous les détails',
  share: 'Partager avec Aino',
  off: 'Non merci',
  saveFailed: 'Impossible d’enregistrer votre choix',
  sendLabel: 'Partager les statistiques d’utilisation avec Aino',
  sendDesc:
    'Uniquement des comptages, envoyés une fois par jour avec un identifiant aléatoire pour ce profil. Jamais vos messages, fichiers, chemins ni textes d’erreur.',
  unavailable: 'Mettez à jour le backend Aino pour modifier ce réglage.',
  stripBody: 'Uniquement des comptages. Jamais vos messages ni vos fichiers.',
  stripReaskBody:
    'Le destinataire est désormais Aino. Votre choix précédent ne vaut pas consentement pour Aino ; veuillez choisir à nouveau.',
  stripChoices: { share: 'Partager avec Aino', off: 'Non merci' },
  stripDetails: 'Détails'
}
