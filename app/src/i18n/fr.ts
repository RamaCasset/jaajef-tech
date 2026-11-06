// All visible text lives here, so wording can be reviewed in one place.
export const fr = {
  appName: 'jaajef.tech',
  common: {
    back: 'Retour',
    loading: 'Chargement…',
    unknownError: 'Une erreur est survenue. Réessayez dans un instant.',
  },
  login: {
    eyebrow: 'Connexion / La Cité',
    title: 'Bon retour dans la Cité.',
    subtitle: 'Connectez-vous pour retrouver votre communauté.',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    forgot: 'Mot de passe oublié ?',
    submit: 'Se connecter',
    noAccount: 'Pas encore inscrit ?',
    signUp: "S'inscrire",
    forgotSoon: "La réinitialisation du mot de passe sera disponible bientôt.",
  },
  signup: {
    eyebrow: 'Création de personnage / Étape 1 sur 3',
    title: 'Crée ton identité',
    subtitle: 'Un compte pour entrer dans la Cité.',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    passwordHint: 'Au moins 8 caractères.',
    submit: 'Continuer',
    haveAccount: 'Déjà citoyen ?',
    signIn: 'Se connecter',
    checkEmail: 'Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.',
  },
  steps: { identity: 'Identité', clan: 'Choisis ton clan', enter: 'Entrer dans la Cité' },
  clan: {
    eyebrow: 'Création de personnage / Étape 2 sur 3',
    title: 'Choisis ton clan',
    subtitle: 'Chaque talent a sa place dans la Cité. Quel sera le vôtre ?',
    mastery: 'Niveau de maîtrise',
    masteryHint: 'Votre classe et votre niveau pourront évoluer avec vous.',
    previewLabel: 'Aperçu en direct',
    level: 'Niveau',
    xp: 'XP',
    kopeks: 'Kopeks',
    enter: 'Entrer dans la Cité',
    adventure: 'Votre aventure commence ici.',
    chooseFirst: 'Choisissez un clan et un niveau de maîtrise.',
  },
  clans: {
    griot_du_code: { name: 'Griot du Code', role: 'Software Engineer', tagline: 'Tisse les récits de demain, une ligne de code à la fois.' },
    forgeron: { name: 'Forgeron', role: 'UI/UX & 3D Designer', tagline: 'Façonne des univers et donne vie aux idées.' },
    saltigue: { name: 'Saltigué', role: 'Data & AI Scientist', tagline: 'Déchiffre les données et révèle les futurs possibles.' },
    buur_linguere: { name: 'Buur/Lingeer', role: 'Cybersecurity & DevOps', tagline: 'Protège la Cité et veille sur ses infrastructures.' },
  },
  masteries: {
    ndongo: { name: 'Ndongo', level: 'Junior' },
    bagne: { name: 'Bagne', level: 'Mid' },
    borom_xam_xam: { name: 'Borom Xam-Xam', level: 'Senior' },
  },
  home: {
    welcome: 'Bienvenue dans la Cité',
    soon: 'Les autres écrans arrivent bientôt.',
    signOut: 'Se déconnecter',
  },
  setup: {
    title: 'Configuration manquante',
    body: "L'application ne sait pas encore à quelle base de données se connecter. Copiez le fichier .env.example en .env.local et renseignez l'adresse du projet et la clé publique.",
  },
  errors: {
    invalidCredentials: 'Adresse e-mail ou mot de passe incorrect.',
    emailTaken: 'Cette adresse e-mail est déjà utilisée.',
    weakPassword: 'Le mot de passe est trop court (8 caractères au moins).',
    characterLocked: 'Ton personnage est déjà choisi et ne peut plus être changé.',
    notSignedIn: 'Connectez-vous pour continuer.',
  },
} as const

export type ClanKey = keyof typeof fr.clans
export type MasteryKey = keyof typeof fr.masteries
